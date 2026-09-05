# La présence locale du client Riot — ce qui est réellement disponible

Relevé fait le 4 septembre 2026 sur la machine de fauxn9, client Riot ouvert,
Valorant fermé, version de partie `release-13.05-shipping-11-5350494`.

Ce document existe pour une raison : l'application desktop (brique 9) va être
écrite **contre ces noms de champs**. Les deux premières versions de la sonde
lisaient `sessionLoopState` et `partyState` à la racine — ces champs existent
bel et bien, mais **imbriqués dans des sous-objets**. Chercher au mauvais
endroit ne renvoyait pas d'erreur : ça renvoyait `undefined`, silencieusement.
D'où cette page, pour que personne n'ait à redécouvrir la structure.

## Où ça se lit

`GET https://127.0.0.1:<port>/chat/v4/presences`, authentification Basic
`riot:<mot de passe>`, les deux venant du lockfile :

```
%LOCALAPPDATA%\Riot Games\Riot Client\Config\lockfile
nom:pid:port:motdepasse:protocole
```

Le certificat est auto-signé — il n'existe aucune autorité capable de signer
pour 127.0.0.1. Il faut donc `node:https` avec `rejectUnauthorized: false`
**sur cette connexion uniquement** : le `fetch` global de Node ignore purement
et simplement l'option d'agent, il ne peut pas servir ici.

Un même compte a **plusieurs présences, une par produit**. Celle de
`riot_client` ne contient aucun état de partie. Il faut filtrer sur
`product === 'valorant'`.

Le contenu utile est dans `private`, du JSON encodé en base64.

## La structure réelle du champ `private`

Trois sous-objets, et c'est là que tout se joue :

```
matchPresenceData.sessionLoopState     MENUS | PREGAME | INGAME
matchPresenceData.queueId              competitive, unrated, skirmish2v2…
matchPresenceData.matchMap             (vide hors partie)
matchPresenceData.provisioningFlow     Invalid | Matchmaking | CustomGame
matchPresenceData.gameScoreType        Rounds

partyPresenceData.partyState           DEFAULT | MATCHMAKING | MATCHMADE…
partyPresenceData.partyId
partyPresenceData.partySize            (aussi à la racine : partySize)
partyPresenceData.partyAccessibility   OPEN | CLOSED
partyPresenceData.isPartyOwner
partyPresenceData.queueEntryTime        2026.09.04-20.27.30
partyPresenceData.partyOwnerSessionLoopState
partyPresenceData.partyOwnerMatchScoreAllyTeam / EnemyTeam

playerPresenceData.competitiveTier     17  (= Platine 3, cf. src/services/tiers.js)
playerPresenceData.accountLevel
playerPresenceData.leaderboardPosition
playerPresenceData.playerCardId / playerTitleId

premierPresenceData.rosterName / rosterTag / division / score
```

Quelques champs sont dupliqués à la racine (`queueId`, `partySize`,
`provisioningFlow`, `partyId`). **Ne pas s'y fier** : c'est probablement un
reliquat de l'ancienne structure plate, et c'est justement ce qui a rendu le
bug des v1/v2 difficile à voir — `queueId` sortait juste à la racine pendant
que `sessionLoopState`, lui, avait déménagé.

**Règle pour l'app desktop : ne jamais écrire un nom de champ en dur.**
La sonde repère l'état de partie par sa *valeur* (`MENUS` / `PREGAME` /
`INGAME`), pas par son nom. Une version du jeu peut redéplacer le champ
demain ; reconnaître la valeur survit à ça, et surtout, échoue bruyamment.

## Enveloppe de la présence (hors `private`)

`puuid`, `game_name`, `game_tag`, `region`, `patchline`, `platform`,
`activePlatform`, `state` (`chat` / `away` / `dnd`), `time` (epoch ms),
et `packedData` — **un second blob base64 de 832 caractères, non décodé
à ce jour**. À regarder si un besoin n'est pas couvert par `private`.

## Le cycle complet, observé

Relevé du 4 septembre 2026 au soir, en `--suivi`, du groupe qui se forme
jusqu'au retour au menu. Recopié dans `test/presence.test.js`, qui le rejoue
tel quel.

| Heure | Ce qui change | Ce que ça veut dire |
|---|---|---|
| 23:18:16 | `partySize` 2 → 3 | quelqu'un rejoint le groupe |
| 23:18:18 | `partyState` DEFAULT → **MATCHMAKING** | départ en recherche |
| 23:19:48 | `sessionLoopState` MENUS → **PREGAME**, `matchMap` → Juliett | partie trouvée, sélection d'agents |
| 23:20:08 | PREGAME → **MENUS**, `partyState` → MATCHMAKING | **quelqu'un a esquivé** |
| 23:20:20 | MENUS → PREGAME, `matchMap` → Triad | nouvelle partie trouvée |
| 23:22:11 | PREGAME → **INGAME** | la partie commence |
| 23:24:56 → 23:56:36 | `partyOwnerMatchScore*` monte round par round | 13-10 |
| 23:56:38 | score 13-10 → **0-0** | remise à zéro |
| 23:56:44 | INGAME → **MENUS**, `matchMap` effacée | fin de partie |

Recoupé avec HenrikDev : la partie existe — `06550c61-…`, **Haven**,
23 rounds, début `2026-09-04T21:20:17Z`. Le score et la map concordent.

## Trois pièges, et ils sont tous silencieux

**1. Le score est remis à zéro huit secondes AVANT le retour au menu.**
Lire le score au moment où l'état repasse à `MENUS` — le geste le plus
naturel du monde — donne **0-0 à toutes les parties**, sans jamais lever
d'erreur. Il faut garder le dernier score connu.

Et la règle « garder le dernier score non nul » ne suffit pas : une défaite
0-13 laisse légitimement notre score à zéro du début à la fin. La bonne
règle est **refuser toute baisse** — un score de partie ne fait que monter,
donc toute baisse est une remise à zéro. La map subit le même sort : elle est
effacée dans le même mouvement, il faut celle de l'instantané précédent.

**2. `PREGAME → MENUS` sans passer par `INGAME`, c'est une esquive.**
Vu à 23:20:08. Traiter tout retour au menu comme une fin de partie
annoncerait aux potes une partie qui n'a jamais eu lieu.

**3. Les champs `partyOwner*` décrivent le chef de groupe, pas soi.**
Ici `isPartyOwner: true`, donc les deux coïncidaient parfaitement — l'erreur
serait restée invisible pendant tous les tests, et serait apparue le jour où
quelqu'un d'autre crée le groupe. L'état personnel se lit dans
`matchPresenceData`, jamais dans le miroir du chef.

À noter : le score n'existe **que** sous la forme `partyOwner*`. Il n'y a pas
de champ « mon score ». Ce n'est pas gênant — les membres d'un groupe sont
dans la même partie — mais c'est à savoir.

## Ce que ça débloque

| Ce qu'on veut | Ce qui le donne | Statut |
|---|---|---|
| Prouver qu'un Riot ID appartient bien à l'utilisateur | `/entitlements/v1/token` → `subject` | **Vérifié** — correspond exactement au puuid de `fauxn9` en base |
| Détecter la fin d'une partie à la seconde | `matchPresenceData.sessionLoopState` | **Vérifié** — `INGAME → MENUS` observé à 23:56:44 |
| Le score final | `partyOwnerMatchScore*`, dernier connu | **Vérifié** — 13-10, concorde avec HenrikDev |
| La map | `matchPresenceData.matchMap` + `mapUrl` de valorant-api.com | **Vérifié** — Triad = Haven |
| Savoir qui est en train de jouer, sans API externe | présences des amis | **Vérifié** — `hayann` remontée avec son état |
| Savoir qu'un groupe se forme | `partySize` + `partyState` | **Vérifié** — 90 s d'avance sur la partie |
| Le rang, sans passer par HenrikDev | `playerPresenceData.competitiveTier` | **Vérifié** — 17 = Platine 3 |
| Le score en direct pendant la partie | `partyOwnerMatchScore*` | **Vérifié** — un changement par round |

## Où c'est implémenté

`src/services/presence.js` — module pur, sans réseau : il transforme une
charge utile en instantané, puis une suite d'instantanés en événements
(`groupe`, `file`, `selection`, `esquive`, `debut`, `fin`, `ferme`). Les trois
pièges ci-dessus y sont encodés, et `test/presence.test.js` rejoue le relevé
réel de la soirée pour les tenir. Chacune des trois règles a été vérifiée en
la cassant exprès : les tests tombent bien à chaque fois.

La traduction du nom interne de map se fait par `nomDeMap()` dans
`src/services/maps.js`, depuis valorant-api.com — aucune table écrite à la
main.

## Reproduire

```
cd "chemin/vers/le/projet"
node scripts/sonde-lockfile.mjs          # rapport complet, tous les champs
node scripts/sonde-lockfile.mjs --suivi  # n'affiche que ce qui change
```

Le mode suivi compare l'objet entier à son état précédent et nomme les champs
qui bougent. Il n'a besoin de connaître aucun nom à l'avance.

## Limites

Ces routes locales ne sont pas documentées par Riot et ne font l'objet
d'aucun engagement de leur part : elles peuvent changer ou disparaître à
n'importe quelle mise à jour. L'application doit donc traiter leur absence
comme un cas normal et retomber sur HenrikDev, jamais planter.

La sonde est en **lecture seule** : elle lit un fichier que le client écrit
lui-même et interroge son serveur HTTP local. Elle n'injecte rien, ne
s'accroche à aucun processus, ne modifie aucun fichier du jeu.
