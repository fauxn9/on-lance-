# Application PC — brique 9

## L'idée en une phrase

Le PC sait qu'une partie vient de finir **à la seconde**, alors que le serveur
doit attendre le prochain passage d'un cron GitHub, toutes les dix minutes.
Cette application fait remonter l'information tout de suite, et prouve au
passage à quel compte Valorant appartient ce PC.

## Ce qui est fait

| Élément | État |
|---|---|
| `presence-core` — lecture de la présence, machine à états | ✅ 19 tests |
| `agent-core` — lockfile, client Riot local, client serveur, boucle | ✅ 15 tests |
| `src-tauri` — fenêtre, barre des tâches, appairage, boucle 2 s | ✅ 4 tests |
| Réception des événements côté serveur | ❌ |

## Lancer l'application

Prérequis Windows, une seule fois :

- **Rust** — l'installateur de [rustup.rs](https://rustup.rs)
- **Visual Studio Build Tools**, charge de travail « Développement Desktop en
  C++ » (le compilateur MSVC ; Rust s'en sert pour lier le binaire)
- **WebView2** — déjà présent sur toute machine Windows 11 à jour

Ensuite :

```
cd desktop
npm install
npm run dev      # fenêtre de développement, journaux dans la console
npm run build    # installateur .exe dans src-tauri/target/release/bundle/nsis/
```

La première compilation prend plusieurs minutes (Tauri compile son moteur) ;
les suivantes sont quasi instantanées.

Pour tester contre un serveur local plutôt que la production :

```
set ONLANCE_URL=http://localhost:3000
npm run dev
```

## Ce que fait la coquille, et ce qu'elle ne fait pas

Une fenêtre de 400 × 560, une icône dans la barre des tâches, une boucle qui bat
toutes les deux secondes. C'est tout, et c'est délibéré : **fermer la fenêtre la
cache** au lieu de quitter — sinon la première croix cliquée arrête la détection
de fin de partie sans que personne ne comprenne pourquoi les notifications se
sont taries. On quitte par la barre des tâches.

L'interface n'a **aucun état à elle** : elle reçoit une vue complète à chaque
battement et se redessine. Rien à resynchroniser, donc rien à désynchroniser —
une fenêtre affichant « en partie » alors que la partie est finie serait le pire
défaut possible ici.

L'`Agent` n'est pas partagé : il appartient à la boucle de fond. La raison est
bête mais coûteuse à découvrir tard — `Agent::battre` est asynchrone, et un
mutex ordinaire tenu à travers un `await` figerait toute la fenêtre pendant cinq
secondes le jour où le client Riot cesse de répondre.

Le jeton d'appairage est écrit dans le dossier de configuration de
**l'utilisateur courant**, jamais à côté de l'exécutable : il vaut accès au
compte, et une installation lisible par toutes les sessions Windows le
donnerait à tout le monde.

Les polices ne sont pas chargées depuis le web. Une application de bureau qui
attend Google Fonts affiche une fenêtre vide quand la connexion tombe.

## Pourquoi deux crates avant la moindre fenêtre

Ni `presence-core` ni `agent-core` ne dépendent de Tauri, de WebView2 ou de
Windows. Tout ce qui **décide** se teste donc en une seconde sur n'importe
quelle machine, sans Valorant et sans client Riot : `agent-core` monte un faux
client Riot sur un port libre, écrit un lockfile qui pointe dessus, et déroule
la boucle complète.

Ce n'est pas de la coquetterie d'architecture. La logique de cette brique a
déjà produit trois bugs silencieux (voir plus bas) ; les enfermer derrière une
interface graphique qui ne se lance que sur Windows aurait rendu chacun d'eux
invisible jusqu'à la production.

```
cd desktop
cargo test --workspace
```

## Les trois pièges, et pourquoi ils sont encodés

Ils viennent tous d'un relevé réel — la soirée du 4 septembre 2026, du groupe
qui se forme jusqu'au retour au menu (`docs/presence-locale.md`). Les tests
rejouent ce relevé ligne par ligne, dans les deux implémentations.

1. **Le score est remis à zéro huit secondes avant le retour au menu.** Lire le
   score au moment de la fin — le geste le plus naturel du monde — donne 0-0 à
   toutes les parties, sans jamais lever d'erreur. On garde le dernier score
   connu et on refuse toute **baisse** (« dernier score non nul » ne marcherait
   pas : une défaite 0-13 laisse légitimement zéro).
2. **`PREGAME → MENUS` sans passer par `INGAME`, c'est une esquive.** Traiter
   tout retour au menu comme une fin annoncerait une partie fantôme.
3. **Les champs `partyOwner*` décrivent le chef de groupe, pas soi.** Ils
   coïncident tant qu'on est chef — donc l'erreur reste invisible pendant tous
   les tests de celui qui l'a écrite.

Et une règle qui les surplombe : **l'état de partie n'est cherché par aucun nom
de champ**, il est reconnu à sa valeur (`MENUS` / `PREGAME` / `INGAME`). Deux
versions de la sonde ont échoué parce que Riot avait déplacé
`sessionLoopState` dans un sous-objet — et ont échoué en silence, en renvoyant
`undefined`.

## Deux implémentations, un seul jeu de faits

La machine à états existe en JavaScript (`src/services/presence.js`, côté
serveur) et en Rust (`desktop/presence-core`). Les deux rejouent le même relevé
et doivent produire **exactement la même suite d'événements**, ordre compris.
Le jour où elles divergent, un test tombe.

## Ce que l'application ne fait pas

Aucune injection, aucun hook dans le processus du jeu, aucun fichier du jeu
touché, aucune requête aux serveurs de Riot. On lit le lockfile que le client
écrit lui-même et on interroge son serveur HTTP local, en lecture seule.
L'overlay, quand il viendra, sera une fenêtre transparente **à côté** du jeu —
pas dedans.

Ces routes locales ne sont pas documentées par Riot et peuvent disparaître à
n'importe quelle mise à jour. L'application traite donc leur absence comme un
cas **normal** : client fermé, lockfile absent, champ déplacé — rien de tout ça
ne doit l'arrêter, et chacun se raconte dans `EtatAffiche.souci`.

## Le certificat auto-signé

Le serveur local du client Riot présente un certificat auto-signé — aucune
autorité au monde ne peut signer pour `127.0.0.1`. La vérification est donc
levée, **uniquement sur le client HTTP qui joint la boucle locale**. Celui qui
parle à onlance.xyz est un autre objet, avec la vérification intacte.

## Reste à faire

- Côté serveur : `/devices/heartbeat` accepte déjà l'appel mais **ignore encore
  les événements**. Un `fin` devra déclencher la détection tout de suite, au
  lieu d'attendre le cron de dix minutes.
- Vérifier que HenrikDev publie bien le match assez vite après le `fin` — sinon
  il faudra attendre un court délai avant d'aller le chercher.
