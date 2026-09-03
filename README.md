# On lance ? — Briques 1 & 2

Détection automatique des matchs Valorant joués ensemble par un groupe de potes,
notification de fin de partie avec un ton qui dépend du classement, et
leaderboard hebdomadaire basé sur le RR gagné.

## Ce qui est fait

**Brique 1 — détection & notif de fin de match**

| Élément | État |
|---|---|
| Schéma de base (Postgres/Supabase) | ✅ appliqué |
| Client HenrikDev (rate limit + cache + retry 429) | ✅ **vérifié sur l'API réelle** |
| Moteur de détection (match partagé, fenêtre, anti-doublon) | ✅ testé |
| Classement du groupe par ACS + attribution des tons | ✅ testé |
| Génération des 3 tons via l'API Anthropic + fallback | ✅ vérifié en réel |
| Variété des messages (angles + anti-répétition) | ✅ testé |
| Job cron | ✅ |
| API de gestion (users, groupes, liaison Riot) | ✅ |
| Envoi des notifs (Web Push + service worker) | ✅ écrit |

**Brique 2 — leaderboard hebdomadaire**

| Élément | État |
|---|---|
| Récupération du RR par match (`last_change`) | ✅ **vérifié sur l'API réelle** |
| Semaine calée sur le lundi, fuseau du groupe | ✅ testé |
| Agrégation + classement + départages | ✅ testé |
| Historique des vainqueurs figé à la clôture | ✅ |
| Job de sync RR + job de clôture hebdo | ✅ |
| Notifs de fin de semaine (`crown` / `recap`) | ✅ vérifié en réel |
| Routes API leaderboard + historique | ✅ |

**Brique 3 — coach positionnel**

| Élément | État |
|---|---|
| Données positionnelles (positions + `view_radians`) | ✅ **vérifiées sur l'API réelle** |
| Étage 1 : distances, surextension, trade, angles | ✅ testé (geométrie couverte) |
| Conversion en coordonnées minimap | ✅ vérifié sur 151 morts réelles |
| Stockage borné (morts des joueurs suivis) | ✅ |
| Étage 2 : mise en mots par l'IA | ✅ vérifié en réel sur 179 morts |
| Insight positionnel dans la notif `roast` | ✅ |
| Job d'analyse + routes coach/heatmap | ✅ |
| Dashboard coach + heatmap | ✅ `public/coach.html` |

**Reste à faire**

| Élément | État |
|---|---|
| Landing page | ✅ `public/landing.html` |
| Auth | ❌ à faire avant toute ouverture hors cercle de test |
| RLS Supabase | ❌ à activer avant d'exposer l'API Data de Supabase |
| Chat conversationnel « pourquoi je suis mort là » | ❌ repoussé (prévu par la spec) |

## Démarrage

```bash
npm install
cp .env.example .env      # puis remplir les 3 clés
npm run db:init           # applique db/schema.sql
npm run api               # API sur :3000
```

## Inviter les potes

Une fois l'app en ligne, chaque pote ouvre **`/join.html`** et remplit trois
champs : son pseudo, son Riot ID, le code du groupe. La page enchaîne toute
seule la création du profil, l'ajout au groupe, la liaison du compte Valorant
et l'abonnement aux notifications.

Le code peut être passé dans l'URL pour lui éviter de le recopier :

```
https://ton-app.onrender.com/join.html?code=ONLANCE
```

Le Riot ID est validé (`GET /accounts/resolve`) **avant** toute écriture en
base : un pseudo mal tapé n'a donc jamais laissé de profil orphelin derrière lui.

Le premier groupe se crée en revanche en ligne de commande, une seule fois :

```bash
curl -X POST localhost:3000/users  -H 'content-type: application/json' \
  -d '{"displayName":"Alex"}'

curl -X POST localhost:3000/groups -H 'content-type: application/json' \
  -d '{"name":"Les potes","userId":1}'          # renvoie le join_code à partager
```

⚠️ **Aucune authentification** : le code de groupe est le seul garde-fou.
Quiconque a l'URL peut créer un profil et rejoindre. Acceptable entre potes,
à corriger avant toute ouverture plus large.

## Étape 0 — vérifier l'API avant tout le reste

```bash
npm run verify -- TonPseudo EUW
```

Le script teste la clé, résout ton Riot ID, récupère un vrai match, affiche la
structure brute renvoyée par l'API, la passe dans `normalizeMatch()` et signale
chaque champ qui ne colle pas. C'est la seule chose qu'aucun test unitaire ne
peut faire à ma place : confronter le code à la vraie réponse.

Si un champ est signalé KO, il n'y a qu'un endroit à corriger —
`normalizeMatch()` dans `src/services/henrikdev.js` — en comparant avec la
structure brute affichée à l'étape 4 du script.

## Notifications

```bash
npm run vapid    # une seule fois, coller le résultat dans .env
npm run api      # puis ouvrir http://localhost:3000/subscribe.html
```

La page `subscribe.html` fait tout : enregistrement du service worker, demande
d'autorisation, récupération de la clé publique, abonnement côté serveur, et un
bouton de test. Chaque étape s'affiche, donc en cas d'échec on voit laquelle a
lâché.

À faire **une fois par appareil**. Une fois l'abonnement enregistré, le serveur
peut être éteint : le Web Push est délivré au navigateur par le service de push
de Google/Mozilla, pas par nous.

Le service worker doit être servi depuis la racine (`/sw.js`) — un service
worker ne contrôle que les pages à son niveau ou en dessous. C'est pour ça que
`server.js` sert `public/` en statique.

Le Web Push marche sur `http://localhost` sans certificat, mais exige HTTPS en
production — pas de contournement.

## Lancer la détection

```bash
npm run detect:dry   # calcule et affiche tout, n'écrit rien, n'envoie rien
npm run detect       # pour de vrai
```

**Toujours commencer par `detect:dry`** après avoir lié les comptes : ça affiche
le classement et les 3 messages générés dans le terminal sans rien enregistrer.
C'est là qu'on calibre le ton avant que les potes reçoivent quoi que ce soit.

## Leaderboard hebdomadaire (Brique 2)

Le classement de la semaine = **somme du RR gagné/perdu**, remise à zéro chaque
lundi. La frontière du lundi est calculée dans le fuseau du groupe
(`LEADERBOARD_TZ`, `Europe/Paris` par défaut) et pas en UTC : sinon une game du
dimanche soir à 23h tomberait dans la semaine suivante.

```bash
npm run rr:sync:dry     # affiche le RR par joueur, n'écrit rien
npm run rr:sync         # remplit match_rr (cron ~1x/heure)

npm run week:close:dry  # calcule le classement de la semaine passée + les messages
npm run week:close      # fige le classement et met les notifs en file
npm run week:close 2026-08-31   # cloture une semaine précise
```

Deux garanties contre les doublons, du même type que la Brique 1 :

- `UNIQUE (puuid, match_id)` sur `match_rr` → repasser sur les mêmes matchs
  n'ajoute jamais de RR en double, le job est rejouable sans risque.
- `UNIQUE (group_id, week_start)` sur `weekly_winners` → une semaine ne se
  clôture qu'une fois, donc pas de notif de fin de semaine en double.

Le classement d'une semaine clôturée est **figé** en base : on ne le recalcule
jamais à l'affichage, sinon un membre qui quitte le groupe réécrirait le passé.

Consultation :

```bash
curl localhost:3000/groups/1/leaderboard              # semaine en cours (base)
curl localhost:3000/groups/1/leaderboard?week=2026-08-31
curl localhost:3000/groups/1/leaderboard/history      # vainqueurs passés
curl -X POST localhost:3000/groups/1/leaderboard/refresh   # va rechercher le RR maintenant
```

### Classement en direct

La page `/leaderboard.html` affiche d'abord le classement stocké — instantané —
puis déclenche un rafraîchissement qui va rechercher le RR auprès de l'API et
met la vue à jour. Quelqu'un qui vient d'enchaîner trois victoires voit son
classement bouger sans attendre le prochain passage du cron horaire.

Une ligne qui gagne du RR s'illumine, et un joueur qui remonte affiche le nombre
de places gagnées. Le bandeau du haut décompte le temps restant avant la clôture.

`POST /leaderboard/refresh` est limité à **un appel par minute et par groupe**,
en mémoire du serveur. Sans ce garde-fou, un onglet laissé ouvert ou quelques
rechargements suffiraient à épuiser le quota de l'API HenrikDev.

## Coach positionnel (Brique 3)

```bash
npm run pos:analyze:dry   # analyse et affiche, n'écrit rien
npm run pos:analyze       # remplit player_deaths (cron ~30 min)

curl localhost:3000/users/1/coach                 # faits + coaching généré
curl "localhost:3000/users/1/heatmap?map=Ascent"  # points de heatmap
```

### Ce que contiennent vraiment les données (vérifié le 02/09/2026)

Chaque événement de kill donne la position exacte de la victime, **plus** la
position et la direction du regard de chaque joueur **encore en vie**. Deux
conséquences, qui ont façonné toute la brique :

- **Le tueur y est toujours** (151/151 sur le match de contrôle). Sa position au
  moment du kill est donc exacte — vérifié en comparant son `view_radians` à la
  direction vers sa victime : écart médian de **0,4°**.
- **La victime n'y est jamais** (0/151) : elle vient de mourir. On a sa position,
  mais **pas son angle de vue au moment de sa mort** — contrairement à ce que
  supposait la spec.

La reconstitution depuis un kill antérieur du même round couvre 87 % des morts,
mais avec un écart médian de **3,4 s** — largement de quoi faire un 180°.
Affirmer « tu regardais le mauvais angle » sur cette base reviendrait à inventer
un fait. Le code ne retient donc cette reconstitution qu'en dessous de 2 s
(~27 % des morts), ne l'affirme jamais sur une mort isolée, et ne la remonte
qu'en agrégat en citant la taille d'échantillon.

**Ce qui reste exact à 100 %** : heatmap des morts, distance au coéquipier le
plus proche, surextension, possibilité de trade, distance et direction du duel.

### Les deux étages, et pourquoi ils sont séparés

- `src/services/positional.js` — **étage 1**, aucune IA. Que de la géométrie sur
  les données brutes. Résultat : des faits chiffrés, exacts, reproductibles.
- `src/services/coach.js` — **étage 2**. Ne reçoit **jamais** de coordonnées ni de
  JSON de match, uniquement les faits déjà calculés. L'IA reformule, elle
  n'analyse pas. C'est la protection contre l'hallucination : sans coordonnées en
  entrée, elle ne peut pas inventer de distance.

Les morts en dernier survivant sont exclues des ratios de placement : être seul
quand toute l'équipe est morte n'est pas une erreur de positionnement.

### Volume

Un match génère ~150 événements de kill. On ne stocke que les morts des joueurs
suivis, soit ~20 lignes par joueur et par match — quelques centaines de lignes
par semaine et par joueur, là où tout stocker aurait explosé.

## Tests

```bash
npm test
```

47 tests sur la logique métier, sans réseau ni base : classement par ACS,
attribution des tons (dont le cas à 2 joueurs), anti-doublon, fenêtre de
lookback, délai de stabilisation, variété des messages, et pour la Brique 2 —
normalisation du RR, découpage des semaines sur le bon fuseau, agrégation,
départages, semaine vide et égalité parfaite. Pour la Brique 3 — conversion des
distances, convention d'angle vérifiée contre l'API, bouclage des angles autour
de 0, inversion des axes de la minimap, seuil de reconstitution du regard,
exclusion du dernier survivant, et refus de conclure sur un échantillon trop
petit.

## Déploiement (tier gratuit)

### Le plus léger : GitHub Actions (`.github/workflows/crons.yml`)

Rien dans ce projet n'a besoin d'un serveur allumé en permanence. Les jobs
s'exécutent puis s'arrêtent, et surtout **le Web Push est délivré au navigateur
par le service de push de Google/Mozilla, pas par notre serveur** : les potes
reçoivent leurs notifs même quand aucune machine à nous ne tourne.

1. Pousser le projet sur un dépôt GitHub (privé, à cause des clés)
2. Settings → Secrets and variables → Actions, créer : `DATABASE_URL`,
   `HENRIK_API_KEY`, `ANTHROPIC_API_KEY`, `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
3. Les 4 crons tournent tout seuls. L'onglet Actions permet aussi de les lancer
   à la main (« Run workflow ») pour tester.

Deux limites à connaître : GitHub met les workflows planifiés en pause après
60 jours sans commit (un commit les relance), et une exécution peut être
décalée de quelques minutes sous charge — sans importance ici.

L'API (`npm run api`) n'est utile que ponctuellement, pour lier un compte ou
s'abonner aux notifs. La lancer en local le temps de le faire suffit.

### Si tu veux aussi l'API en ligne : Render (`render.yaml`)

Blueprint prêt à l'emploi, avec les 4 cron jobs et le web service. Vérifier la
tarification des Cron Jobs Render au moment de créer le blueprint, elle a changé
plusieurs fois.

- **Base** : Supabase, coller l'URI dans `DATABASE_URL`

  ⚠️ Sur les projets Supabase récents, l'hôte direct `db.xxxx.supabase.co` est
  **IPv6 uniquement**. Depuis un réseau sans IPv6, utiliser la chaîne du
  **pooler**, donnée par le bouton *Connect* du dashboard → section *Session
  pooler*. Ne pas deviner le nom d'hôte : le préfixe (`aws-0`, `aws-1`…) dépend
  du cluster qui héberge le projet, pas de sa région. Un mauvais préfixe donne
  l'erreur `tenant/user ... not found`, qui ressemble à un problème
  d'identifiants alors que c'en est un d'adresse.

- **Détection** : Render → **Cron Job** (pas un Web Service), commande `npm run detect`,
  planning `*/10 * * * *`. Un cron job s'exécute puis s'arrête, donc pas de mise
  en veille après 15 min comme sur un serveur web gratuit.
- **Sync RR** : Render → Cron Job, `npm run rr:sync`, planning `0 * * * *`.
  Le leaderboard est hebdomadaire, inutile de le rafraîchir plus souvent.
- **Clôture hebdo** : Render → Cron Job, `npm run week:close`, planning
  `0 2 * * 1` (lundi 04h00 Paris en heure d'été — le planning Render est en UTC).
- **Analyse positionnelle** : Render → Cron Job, `npm run pos:analyze`, planning
  `*/30 * * * *`. Alimente un dashboard, rien qui doive être à la minute.
- **API** : Render Web Service (la mise en veille n'est pas gênante ici, l'API
  n'est appelée que ponctuellement)

## Points à vérifier / trancher

1. **Forme des réponses HenrikDev** — tout est centralisé dans `normalizeMatch()`
   et `normalizeRrEntry()` (`src/services/henrikdev.js`). Les deux ont été
   vérifiés contre la vraie API le 02/09/2026 et correspondent. Si HenrikDev
   change son schéma, relancer `npm run verify` : le script dit quel champ a
   bougé, et ces deux fonctions sont les seules à corriger.
2. **Ton à 2 joueurs** — par défaut le 2e reçoit le `roast` (il est le dernier).
   Bascule sur `push` via l'option `twoPlayerSecondTone` dans `assignTones()` si
   c'est trop dur à l'usage.
3. **Calibrage des messages** — les briefs de ton sont dans `TONE_BRIEFS`
   (`src/services/messages.js`). C'est le fichier à itérer après avoir vu les
   premiers messages en dry-run.
4. **Auth** — l'API n'en a aucune. Suffisant tant que ça tourne en local ou
   entre potes de confiance, à ajouter avant toute ouverture.

## Structure

```
db/schema.sql              schéma Postgres
src/config.js              toute la configuration
src/db/index.js            pool + requêtes + transaction de sauvegarde
src/services/henrikdev.js  client API (rate limit, cache, normalisation)
src/services/detection.js  moteur de détection — pur, testable
src/services/ranking.js    ACS, classement, attribution des tons — pur, testable
src/services/leaderboard.js  semaines, agrégation RR, vainqueur — pur, testable
src/services/positional.js géométrie des morts (étage 1, sans IA) — pur, testable
src/services/coach.js      mise en mots des faits calculés (étage 2)
src/services/maps.js       calibration des minimaps (cache 24 h)
src/services/messages.js   génération IA des messages (match + hebdo) + fallback
src/services/notifications.js  envoi Web Push + file d'attente
src/jobs/detect-matches.js point d'entrée du cron de détection
src/jobs/sync-rr.js        cron de synchronisation du RR (Brique 2)
src/jobs/close-week.js     cron de clôture hebdomadaire (Brique 2)
src/jobs/analyze-positions.js  cron d'analyse positionnelle (Brique 3)
scripts/verify-henrik.js   diagnostic de l'API — à lancer en premier
scripts/gen-vapid.js       génération des clés Web Push
public/sw.js               service worker (réception des notifs)
public/landing.html        landing page
public/join.html           inscription des potes (Riot ID + groupe + notifs)
public/dashboard.html      tableau de bord joueur (historique + coach)
public/leaderboard.html    classement du groupe en direct + tableau d'honneur
public/coach.html          dashboard coach + heatmap
src/api/server.js          API de gestion + leaderboard + coach
test/logic.test.js         tests Brique 1
test/leaderboard.test.js   tests Brique 2
test/positional.test.js    tests Brique 3
```
