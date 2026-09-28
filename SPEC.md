# On lance ? — Plan de construction de l'app

Tracker League of Legends **gratuit** (toutes les fonctions, pour tout le monde)
et **ultra léger** (objectif : moins de 150 Mo de RAM en partie). Tauri + Rust,
sans Overwolf, sans pub. Les promesses de onlance.xyz sont le cahier des charges :
chaque brique est vérifiée contre elles.

## Règles qui ne se négocient pas

- **Rien de ce que Riot interdit.** Pas d'injection, pas de lecture de la mémoire
  du jeu, pas de timers d'ultimes adverses, pas de pseudos révélés en sélection
  classée, pas de pub dans le jeu, l'écran de chargement ou le client. Chaque
  nouvelle fonction passe l'audit Riot avant d'être publiée.
- **Le code mesure, l'IA raconte.** Tout conseil repose sur un calcul
  déterministe et testé. L'IA ne fait que mettre en mots, jamais d'analyse sur
  des données brutes (leçon du coach Valorant).
- **La RAM est un test, pas une intention.** Chaque brique qui touche l'app
  mesure sa RAM et publie le chiffre.
- **Aucun paywall, jamais.** Si une fonction coûte trop cher à faire tourner,
  on la limite pour tout le monde (quota), on ne la vend pas.

## Architecture

```
app/        Tauri 2 (Rust) + Svelte 5 — l'app Windows
  core      connexion client LoL (LCU), données de partie en direct, overlay
server.js   + api/ — le backend (Express, Render) : proxy de l'API Riot, cache
public/     le site onlance.xyz
crawler/    collecte des parties classées → statistiques agrégées (builds, matchups)
```

Trois sources de données, aucune ne touche au jeu lui-même :

| Source | Où | Ce qu'on y lit |
|---|---|---|
| **LCU** (API locale du client) | sur le PC, via le lockfile | phase de jeu, sélection des champions, runes, sorts, sets d'items, compte connecté, replays |
| **Live Client Data** (`127.0.0.1:2999`) | sur le PC, pendant la partie | joueurs, items, niveaux, scores, événements (dragons, Nashor…) |
| **API Riot** (clé sur le serveur, jamais dans l'app) | backend | rangs, historiques, parties + timelines, partie en cours |

---

## Brique 0 — Fondations

- Enregistrer le produit sur le portail développeur Riot → clé **personnelle**
  (suffit pour développer et pour une bêta **fermée** sur le Discord).
- Repo : dossier `app/` (Tauri 2 + Svelte 5), CI GitHub Actions qui compile
  l'installeur, mise à jour automatique signée (reprendre ce qui marchait sur
  l'app Valorant, dont le nom d'installeur sans espace).
- Icône dans la zone de notification, une seule instance, lancement au
  démarrage de Windows en option.
- **Banc de mesure RAM** : script qui additionne la mémoire de tous les
  processus de l'app (Rust + WebView2). Budgets : moins de 80 Mo au repos,
  moins de 150 Mo en partie.
- Site : passer la landing sur un hébergement qui ne s'endort pas (le plan
  gratuit de Render met le service en veille après 15 min sans visite, et la
  première visite attend alors une minute environ).

**Livrable** : un installeur qui s'installe, se met à jour tout seul, et dont la
RAM est mesurée.

## Brique 1 — Connexion au client LoL

- Détection du client, lecture du lockfile, HTTPS local avec le certificat Riot,
  WebSocket pour recevoir les événements en direct.
- Machine à états de la phase de jeu : menus → file → sélection → chargement →
  en jeu → fin de partie.
- Compte connecté : Riot ID, rang, icône.
- **Propriété vérifiée du compte** : le puuid lu en local prouve que le compte
  est à toi (même principe que le champ `verified` du projet Valorant). Ça
  débloque les comptes multiples sans mot de passe.

**Livrable** : l'app affiche « Client détecté · Pseudo#TAG · Émeraude II » et
suit chaque phase en direct.

## Brique 2 — Backend et historique

- Proxy de l'API Riot : limiteur de débit, cache, nouvelle tentative sur les
  réponses 429 (le client HenrikDev du projet Valorant fait déjà tout ça).
- Stockage Supabase : comptes, parties, rangs. L'app s'authentifie par un jeton
  d'appareil, lié au puuid vérifié.
- Onglet **Parties** : historique complet (jusqu'à la limite de conservation de
  Riot, puis tout ce qui est joué depuis l'installation), profil classé,
  courbe de PL.

**Livrable** : l'accueil de la maquette, avec de vraies données.

## Brique 3 — Le moteur de statistiques

C'est ce qui remplace les données qu'on trouve derrière les paywalls ailleurs.

- **Collecteur** : parties classées Émeraude+ (EUW d'abord), parties +
  timelines, patch par patch.
- On ne garde que des **agrégats** : par champion, rôle et patch → runes, sorts,
  items de base, bottes, ordre d'achat, ordre des compétences, taux de victoire
  par matchup. Seuil d'échantillon minimum avant d'afficher quoi que ce soit.
- Données statiques : Data Dragon et CommunityDragon (items, runes, augments).
- Page champion sur onlance.xyz (tier list, builds) : trafic et référencement
  naturel pour le site.

**Livrable** : un build fiable pour chaque champion et rôle du patch en cours.

## Brique 4 — Sélection des champions

- Lecture de la session : ton rôle, bans, picks adverses visibles, ton pick.
- **Suggestions** : ton pool (maîtrise + ton winrate) croisé avec les matchups
  de la brique 3 contre les picks visibles.
- **Import en un clic** (ou automatique) : page de runes, sorts, set d'items.
- Analyse des deux compos (dégâts physiques/magiques, engage…).
- ARAM : builds dédiés. **ARAM Mayhem** : tier list des augments. À
  vérifier : comment lire les augments proposés sans rien d'interdit ;
  sinon, recherche rapide dans la liste.
- Jamais de pseudo, rang ou historique des alliés en classée à ce stade.

**Livrable** : le parcours draft de la maquette, de bout en bout.
→ **Bêta fermée 1** sur le Discord (clé personnelle). C'est la fonction la plus
utilisée de tous les trackers : autant la sortir en premier.

## Brique 5 — Écran de chargement

- Dès que la partie charge : les 10 joueurs via l'API de partie en cours, puis
  pour chacun rang, winrate, expérience sur le champion, série en cours, OTP,
  duos repérés (parties récentes jouées ensemble).
- Cache agressif : 10 joueurs × plusieurs appels, en moins de 10 secondes.

**Livrable** : les 10 fiches affichées avant la fin du chargement.

> Fait (`api/live.js`, onglet « En direct ») : sur une vraie partie, rangs en
> 0,5 s, maîtrises et duos en 2,6 s. La forme (jusqu'à 50 parties à lire)
> suit le débit de la clé : ~1 min avec la clé personnelle, quelques
> secondes avec la clé de production.

## Brique 6 — Overlay en jeu

- **Une seule** fenêtre transparente qui laisse passer les clics, avec tous les
  widgets dedans (chaque fenêtre de plus = de la RAM en plus). La fenêtre
  principale est fermée pendant la partie.
- Le jeu doit être en mode **fenêtré sans bordure** : c'est le prix de zéro
  injection, comme chez tous les autres.
- Widgets : écart de gold (estimé par la valeur des items), timers
  d'objectifs à partir des événements de la partie, rappel de montée de
  compétence, prochain achat selon la compo adverse.
- Raccourci pour afficher/masquer, et mode édition pour placer les widgets.

**Livrable** : l'overlay tient une partie entière, sous 150 Mo mesurés.

> Fait : ~105 Mo mesurés (overlay seul, fenêtre principale fermée), sur une
> fausse API de jeu. Règles Riot respectées : rien sur les temps de recharge
> adverses, pas d'alerte de « power spike », aucune pub. Reste la partie
> entière en vrai.
→ **Demande de clé de production** : on a un prototype complet à montrer.

## Brique 7 — Après la partie

- Partie + timeline : écart de gold, d'XP et de CS avec l'adversaire direct
  minute par minute, fenêtres où tu perds des CS, morts (position, vision
  autour, isolement), participation aux objectifs.
- **Barème relatif au rang** : même méthode que le coach Valorant, on compare
  aux joueurs de ton rang sur ton rôle et ton champion (données brique 3).
- « 3 choses à retenir » : règles d'abord, mise en mots par l'IA ensuite, avec
  un quota pour tenir les coûts.

**Livrable** : le debrief de la maquette à la fin de chaque partie.

## Brique 8 — Entre potes

- Comptes multiples reliés (vérifiés par la brique 1).
- Groupes d'amis et **classement de la semaine** : on reprend la brique 2 du
  projet Valorant (semaine du lundi, fuseau, historique des vainqueurs).
- **Discord** : classement hebdo posté sur ton serveur, et en option le message
  de fin de partie qui chambre selon ta place (le ton variable du projet
  Valorant). Fort potentiel de bouche-à-oreille.

**Livrable** : `/classement` sur le serveur Discord de la commu.

## Brique 9 — Lancement public

- Bêta ouverte dès que la clé de production est accordée.
- Signature du code Windows (sinon SmartScreen affiche « Windows a protégé
  votre ordinateur » au premier lancement).
- Page de téléchargement sur onlance.xyz, journal des versions, **mesures de RAM
  publiées** (promesse 02).
- Rapport de plantage facultatif et léger.
- Audit Riot de l'ensemble des fonctions.

**Livrable** : la v1.0, téléchargeable par tout le monde.

## Brique 10 — Replays et clips (V2)

- **Replays** : le client sait déjà télécharger et lancer ses replays officiels
  via la LCU, donc c'est peu coûteux à ajouter. Limite : ils ne marchent que
  sur le patch en cours.
- **Clips automatiques** : capture Windows et encodage par la carte graphique,
  tampon des dernières secondes, déclenché par les événements de la partie
  (multi-kills, objectifs volés). À valider brique par brique contre le budget
  RAM et FPS.

---

## Jalons

| Jalon | Briques | Clé Riot |
|---|---|---|
| Bêta fermée 1 : draft + import | 0 → 4 | personnelle |
| Bêta fermée 2 : + chargement + overlay | 5 → 6 | demande de production envoyée |
| Bêta ouverte | 7 → 8 | production |
| v1.0 | 9 | production |
| v1.x | 10 | production |

## Coûts à prévoir

- **Render** : le plan gratuit s'endort, donc l'API de l'app devra passer sur
  un plan payant, et le collecteur tournera sur un worker à part.
- **Supabase** : le plan gratuit suffit tant qu'on ne stocke que des agrégats.
- **IA du coach** : un modèle léger, avec quota par personne.
- **Signature du code** : un certificat, ou le service de signature de Microsoft.

À financer par les dons, facultatifs, qui ne débloquent jamais rien (promesse 01).
