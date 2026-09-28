# On lance ? — l'app PC

Tauri 2 (Rust) + Svelte 5. Voir `../SPEC.md` pour le plan en briques.

## Ce qui est fait

| Brique | Élément | État |
|---|---|---|
| 1 | Détection du client (lockfile, dossier d'install lu dans les réglages Riot) | ✅ |
| 1 | HTTPS local + WebSocket du client, reconnexion, repli en interrogation | ✅ |
| 1 | Six étapes : menus, file, sélection, chargement, en jeu, fin | ✅ |
| 1 | « En jeu » détecté par l'API officielle de partie en direct (port 2999) | ✅ |
| 1 | Compte, niveau, plateforme, rang Solo/Flex en direct | ✅ |
| 1 | Variation exacte de PL à la fin de chaque partie classée | ✅ |
| 2 | Enregistrement du compte, jeton d'appareil (empreinte seule côté serveur) | ✅ |
| 2 | Historique : 20 dernières parties tout de suite, le reste en fond | ✅ |
| 2 | Accueil : rang, courbe de PL, dernières parties | ✅ |
| 2 | Parties : filtres par file, défilement infini | ✅ |
| 3 | Moteur de stats (serveur, `api/stats/`) : collecte, agrégats, builds par Wilson | ✅ en ligne |
| 4 | Sélection lue en direct (postes, picks, bans, banc ARAM, chrono), sans aucun pseudo | ✅ |
| 4 | Suggestions : pool (maîtrises), matchup contre l'adversaire probable, historique perso | ✅ |
| 4 | Import runes (page « On lance ? »), sorts (Flash gardé sur sa touche), set d'items | ✅ à tester en vraie sélection |
| 4 | Import auto au verrouillage (réglage), analyse physique/magique des compos | ✅ |
| 4 | Hors sélection : explorer le build de n'importe quel champion | ✅ |
| 5 | Écran de chargement (`api/live.js`) : les 10 joueurs via l'API spectateur, analysés par étapes | ✅ |
| 5 | Rang et winrate de la saison, maîtrise du champion (OTP, 1re fois, peu joué), forme sur 5 parties, séries | ✅ |
| 5 | Duos et groupes repérés (2 parties communes sur les 20 dernières), postes déduits (Châtiment + stats) | ✅ |
| 5 | Onglet « En direct » ouvert tout seul au chargement ; la dernière partie reste affichée | ✅ à voir en vraie partie |

## Développer

Prérequis Windows : Rust (rustup), Visual Studio Build Tools (C++), WebView2.

```
cd app
npm install
npm run dev           # l'app, branchée sur https://onlance.xyz
```

Contre un serveur local (`npm run api` à la racine du dépôt) :

```
set ONLANCE_URL=http://localhost:3000
npm run dev
```

Sans Tauri, `npm run vite` ouvre l'interface dans un navigateur en **mode démo**
(données inventées). `?etape=en_jeu`, `?etape=hors`… pour voir chaque état.

Tests de la logique, sans Tauri ni WebView2 :

```
cargo test -p lcu
cargo run -p lcu --example sonde   # affiche en direct ce que l'app voit du client
```

## Règles

- Lecture seule : lockfile, serveur local du client, API de partie en direct.
  Aucune injection, aucune lecture de mémoire.
- Le jeton d'appareil ne quitte jamais le Rust.
- Chaque fenêtre coûte de la RAM : on en ajoute une seulement si c'est
  indispensable.
- **Aucune animation infinie au repos.** WebView2 tourne sans GPU (−25 Mo) :
  chaque image est dessinée en logiciel, et une animation en boucle fait
  grimper la RAM de ~1,5 Mo/s jusqu'à +70 Mo. Les pulsations se jouent 3 fois
  au changement d'état puis s'arrêtent ; seuls les indicateurs de chargement
  tournent, et seulement pendant le chargement.
- Mesurer avant de livrer :
  `powershell -File scripts/mesure-ram.ps1 -Lancer target\release\onlance.exe -Attente 40`
