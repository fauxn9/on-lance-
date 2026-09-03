# On lance ? — Briques 1 à 6

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
| Dashboard coach + heatmap | ✅ `public/coach.html` (en direct depuis la brique 5) |

**Brique 5 — le coach en direct**

| Élément | État |
|---|---|
| Heatmap branchée sur `/me/heatmap` (minimap réelle + points cliquables) | ✅ |
| Onglets par map, alimentés par le découpage réel de `/me/coach` | ✅ |
| Sélecteur de période (7 / 14 / 30 jours) sur toute la page | ✅ |
| Refus de conclure sous 8 morts mesurables, par map | ✅ |
| Map sans minimap calibrée : les distances restent, le placement est annoncé absent | ✅ |
| Texte de l'IA uniquement sur demande explicite (donc facturé une fois) | ✅ |

**Briques 4 & 6 — authentification et groupes**

| Élément | État |
|---|---|
| Connexion Discord (OAuth2, scope `identify`) | ✅ |
| Session par cookie signé HMAC, sans table de sessions | ✅ testé |
| Anti-CSRF sur le retour OAuth (`state`) + anti-redirection ouverte | ✅ testé |
| Reprise d'un compte Riot orphelin (adoption de l'historique) | ✅ |
| Refus si le Riot ID appartient à un compte Discord existant | ✅ |
| Création de groupe et invitation par lien privé | ✅ |
| Toute donnée de groupe réservée aux membres | ✅ |
| Pages : connexion, invitation, groupes, tableau de bord, classement | ✅ |

**Reste à faire**

| Élément | État |
|---|---|
| Landing page | ✅ `public/landing.html` |
| Brique 7 — RLS Supabase | ❌ à activer avant d'exposer l'API Data de Supabase |
| Brique 8 — chat « pourquoi je suis mort là » | ❌ repoussé (prévu par la spec) |
| Brique 9 — app desktop Tauri + overlay (lockfile) | ❌ |
| Propriété vérifiée d'un Riot ID (`verified`) | ❌ dépend de la brique 9 |

## Démarrage

```bash
npm install
cp .env.example .env      # puis remplir les 3 clés
npm run db:init           # applique db/schema.sql
npm run api               # API sur :3000
```

## Inviter les potes (Briques 4 & 6)

Plus de code de groupe à recopier, et plus de profil créé par n'importe qui :

1. tu ouvres **`/groupes.html`**, tu te connectes avec Discord, tu crées ton
   groupe ;
2. tu copies son **lien d'invitation** et tu l'envoies ;
3. le pote ouvre le lien, voit le nom du groupe et qui l'invite, se connecte
   avec Discord, renseigne son Riot ID, et c'est fini.

Un groupe ne se rejoint **que** par son lien : il n'y a pas d'annuaire, et
`GET /groups/:id/...` refuse quiconque n'est pas membre.

### Configurer Discord

Sur <https://discord.com/developers/applications> → ton app → OAuth2 :

- **Redirects** : ajouter `<BASE_URL>/auth/discord/callback` pour chaque
  adresse utilisée — `https://onlance.xyz/auth/discord/callback` en production
  **et** `http://localhost:3000/auth/discord/callback` pour le développement ;
- copier le **Client ID** et le **Client Secret** dans `.env`.

Seul le scope `identify` est demandé : pseudo et avatar, rien d'autre — ni
serveurs, ni messages, ni liste d'amis.

### Riot ID déjà connu : l'adoption

Le cas est fréquent ici, parce que les profils d'avant l'authentification
existent encore avec tout leur historique. `claimRiotAccount()` distingue
quatre situations :

| Situation | Ce qui se passe |
|---|---|
| Personne n'a ce Riot ID | il est lié, normalement |
| C'est déjà le tien | le pseudo est rafraîchi, rien d'autre |
| Un profil **sans compte Discord** le détient | **adoption** : RR, parties, morts, notifs et appartenances sont transférés sur ton compte, puis l'orphelin est supprimé |
| Un profil **avec compte Discord** le détient | refus (`409`) — sans cette barrière, taper le Riot ID d'un autre absorberait ses données |

Le Riot ID est validé auprès de Riot (`GET /accounts/resolve`) **avant** toute
écriture : un pseudo mal tapé ne laisse rien derrière lui.

⚠️ Ce que l'authentification ne prouve **pas** : que le Riot ID saisi
t'appartienne vraiment. Discord établit qui tu es, pas ce que tu possèdes. Le
champ `verified` reste donc à `false` partout, en attendant que l'app desktop
lise le lockfile du client Valorant (brique 9).

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
npm run api      # puis se connecter et ouvrir /dashboard.html
```

Le bandeau « Activer les notifications » du tableau de bord fait tout :
enregistrement du service worker, demande d'autorisation, récupération de la
clé publique, abonnement côté serveur. Il apparaît aussi à la fin du parcours
d'invitation, juste après la saisie du Riot ID.

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

70 tests sur la logique métier, sans réseau ni base : classement par ACS,
attribution des tons (dont le cas à 2 joueurs), anti-doublon, fenêtre de
lookback, délai de stabilisation, variété des messages, et pour la Brique 2 —
normalisation du RR, découpage des semaines sur le bon fuseau, agrégation,
départages, semaine vide et égalité parfaite. Pour la Brique 3 — conversion des
distances, convention d'angle vérifiée contre l'API, bouclage des angles autour
de 0, inversion des axes de la minimap, seuil de reconstitution du regard,
exclusion du dernier survivant, et refus de conclure sur un échantillon trop
petit. Pour les Briques 4 & 6 — aller-retour du cookie de session, rejet d'une
charge modifiée, d'une signature forgée, d'un autre secret et d'un cookie
expiré, lecture d'un cookie parmi d'autres sans confusion de nom, en-tête
`HttpOnly`/`SameSite`, refus des redirections hors du site, et scope Discord
limité à `identify`.

Le parcours des pages (lien d'invitation → Discord → Riot ID → notifs →
classement → coach → déconnexion, 17 étapes) se rejoue dans un vrai navigateur,
avec un faux serveur, hors de `npm test` parce qu'il demande Playwright :

```bash
npm i -D playwright && npx playwright install chromium
node test/manuel/parcours-brique4.mjs
```

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

   Les crons n'ont pas besoin des variables Discord : personne ne se connecte
   pendant un cron. Elles ne servent qu'au web service.
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
- **API** : Render Web Service. Depuis la brique 4, c'est lui qui porte la
  connexion et les pages : il doit rester joignable. Variables à ajouter en
  plus des précédentes :

  | Variable | Valeur |
  |---|---|
  | `DISCORD_CLIENT_ID` | l'ID de l'application Discord |
  | `DISCORD_CLIENT_SECRET` | son secret client |
  | `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
  | `BASE_URL` | `https://onlance.xyz` |
  | `NODE_ENV` | `production` (active le drapeau `Secure` du cookie) |

  `BASE_URL` doit correspondre **exactement** à une Redirect déclarée côté
  Discord, sinon le retour de connexion échoue. Et sans `SESSION_SECRET`, un
  secret aléatoire est tiré au démarrage : ça marche, mais chaque redéploiement
  (ou chaque réveil après mise en veille) déconnecte tout le monde.

## Points à vérifier / trancher

1. **Forme des réponses HenrikDev** — tout est centralisé dans `normalizeMatch()`
   et `normalizeRrEntry()` (`src/services/henrikdev.js`). Les deux ont été
   vérifiés contre la vraie API le 02/09/2026 et correspondent. Si HenrikDev
   change son schéma, relancer `npm run verify` : le script dit quel champ a
   bougé, et ces deux fonctions sont les seules à corriger.
2. **Ton à 2 joueurs** — par défaut le 2e reçoit le `roast` (il est le dernier).
   Bascule sur `push` via l'option `twoPlayerSecondTone` dans `assignTones()` si
   c'est trop dur à l'usage.
3. **Maps sans calibration** — `getCalibration()` interroge valorant-api.com.
   Si une map n'y est pas encore (une nouvelle sortie, par exemple), la page
   coach l'annonce et affiche quand même les chiffres : seules les distances
   comptent pour l'analyse, la minimap n'est qu'un support visuel.
4. **Calibrage des messages** — les briefs de ton sont dans `TONE_BRIEFS`
   (`src/services/messages.js`). C'est le fichier à itérer après avoir vu les
   premiers messages en dry-run.
5. **Propriété d'un Riot ID** — Discord établit qui tu es, pas ce que tu
   possèdes. Rien n'empêche donc de saisir le Riot ID de quelqu'un qui ne s'est
   jamais inscrit : c'est exactement le mécanisme d'adoption, et c'est
   volontaire. Ce qui est verrouillé, c'est de reprendre un Riot ID déjà
   rattaché à un compte Discord. La vraie preuve viendra du lockfile (brique 9),
   via le champ `verified` — aujourd'hui à `false` partout.
6. **Révocation d'une session** — les sessions ne sont pas stockées, donc on ne
   peut pas en révoquer une en particulier avant ses 30 jours. Changer
   `SESSION_SECRET` les invalide toutes d'un coup. Assumé à cette échelle.
7. **RLS Supabase (brique 7)** — l'API applique bien ses barrières, mais la clé
   Postgres reste toute-puissante. À activer avant d'exposer quoi que ce soit
   d'autre que ce serveur.

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
src/services/session.js    cookie de session signé (HMAC) — pur, testable
src/services/discord.js    OAuth2 Discord (scope identify)
src/services/urls.js       garde-fou anti-redirection ouverte — pur, testable
public/ui.css              socle visuel commun à toutes les pages
public/app.js              socle JS commun (session, en-tête, notifs, échappement)
public/landing.html        landing page
public/login.html          connexion Discord
public/rejoindre.html      parcours d'invitation (Discord → Riot ID → notifs)
public/groupes.html        création de groupe + lien d'invitation
public/dashboard.html      tableau de bord joueur (historique + coach)
public/leaderboard.html    classement du groupe en direct + tableau d'honneur
public/coach.html          coach en direct : heatmap, onglets par map, comparatif
public/join.html           ancienne inscription — ne sert plus qu'à rediriger
src/api/server.js          API : auth, groupes, leaderboard, coach
test/logic.test.js         tests Brique 1
test/leaderboard.test.js   tests Brique 2
test/positional.test.js    tests Brique 3
test/session.test.js       tests Brique 4 — sessions
test/auth.test.js          tests Brique 4 — OAuth et redirections
test/manuel/parcours-brique4.mjs  parcours navigateur (Playwright, hors npm test)
```
