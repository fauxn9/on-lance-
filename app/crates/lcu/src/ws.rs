//! Le WebSocket du client League (protocole WAMP simplifié).
//!
//! On s'abonne à quelques routes ; le client pousse ensuite chaque changement
//! sous la forme `[8, "OnJsonApiEvent_…", { uri, eventType, data }]`. Plus
//! besoin d'interroger le client en boucle : on sait à la milliseconde quand la
//! phase change.

use crate::client::Erreur;
use crate::lockfile::Lockfile;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::Connector;

#[derive(Debug, Clone, PartialEq)]
pub struct EvenementLcu {
    pub uri: String,
    /// `Create`, `Update` ou `Delete`.
    pub type_evenement: String,
    pub data: Value,
}

/// Nom d'abonnement pour une route : `/lol-gameflow/v1/gameflow-phase` →
/// `OnJsonApiEvent_lol-gameflow_v1_gameflow-phase`.
pub fn abonnement(route: &str) -> String {
    format!("OnJsonApiEvent{}", route.replace('/', "_"))
}

pub fn parser_message(texte: &str) -> Option<EvenementLcu> {
    let v: Value = serde_json::from_str(texte).ok()?;
    let tab = v.as_array()?;
    if tab.first()?.as_u64()? != 8 {
        return None;
    }
    let charge = tab.get(2)?;
    Some(EvenementLcu {
        uri: charge.get("uri")?.as_str()?.to_string(),
        type_evenement: charge.get("eventType").and_then(Value::as_str).unwrap_or("Update").to_string(),
        data: charge.get("data").cloned().unwrap_or(Value::Null),
    })
}

/// Se connecte, s'abonne aux routes demandées et transmet chaque événement.
/// Rend la main quand le client ferme la connexion (client quitté, redémarré).
pub async fn ecouter(lock: &Lockfile, routes: &[&str], tx: mpsc::Sender<EvenementLcu>) -> Result<(), Erreur> {
    let mut requete = lock.ws_url().into_client_request().map_err(|e| Erreur::Ws(e.to_string()))?;
    requete.headers_mut().insert(
        "Authorization",
        HeaderValue::from_str(&lock.autorisation()).map_err(|e| Erreur::Ws(e.to_string()))?,
    );
    // Même dérogation que pour le HTTP local : certificat auto-signé sur 127.0.0.1.
    let tls = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| Erreur::Ws(e.to_string()))?;
    let (mut ws, _) = tokio_tungstenite::connect_async_tls_with_config(requete, None, false, Some(Connector::NativeTls(tls)))
        .await
        .map_err(|e| Erreur::Ws(e.to_string()))?;

    for route in routes {
        let msg = serde_json::json!([5, abonnement(route)]).to_string();
        ws.send(Message::Text(msg.into())).await.map_err(|e| Erreur::Ws(e.to_string()))?;
    }

    while let Some(msg) = ws.next().await {
        match msg {
            Ok(Message::Text(t)) => {
                if let Some(ev) = parser_message(t.as_str()) {
                    if tx.send(ev).await.is_err() {
                        return Ok(()); // plus personne n'écoute
                    }
                }
            }
            Ok(Message::Close(_)) => return Ok(()),
            Ok(_) => {}
            Err(e) => return Err(Erreur::Ws(e.to_string())),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nom_dabonnement() {
        assert_eq!(abonnement("/lol-gameflow/v1/gameflow-phase"), "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase");
    }

    #[test]
    fn lit_un_evenement() {
        let t = r#"[8,"OnJsonApiEvent_lol-gameflow_v1_gameflow-phase",{"data":"ChampSelect","eventType":"Update","uri":"/lol-gameflow/v1/gameflow-phase"}]"#;
        let ev = parser_message(t).unwrap();
        assert_eq!(ev.uri, "/lol-gameflow/v1/gameflow-phase");
        assert_eq!(ev.data, Value::String("ChampSelect".into()));
    }

    #[test]
    fn ignore_le_reste() {
        assert!(parser_message("[0,\"session\",1,\"x\"]").is_none());
        assert!(parser_message("pas du json").is_none());
        assert!(parser_message("[]").is_none());
    }
}
