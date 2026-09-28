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
