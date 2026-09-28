# On lance ?

Le tracker League of Legends gratuit et ultra léger. Tout ce que les autres font
payer (aide au draft, overlay en jeu, analyse d'après-partie, historique
complet), gratuit, dans une app Tauri. Sans abonnement, sans Overwolf, sans pub.

Ce dépôt contient pour l'instant la **page de pré-lancement** de
[onlance.xyz](https://onlance.xyz). L'app se construit derrière.

## Lancer en local

```bash
npm install
npm run api   # http://localhost:3000
```

## Ce qu'il y a dedans

| Fichier | Rôle |
|---|---|
| `server.js` | Express : fichiers statiques, `/health`, `/api/discord` (membres du serveur, en cache 10 min), redirection des anciennes URL vers l'accueil |
| `public/index.html` | La page |
| `public/style.css` | Tout le style, sans framework |
| `public/main.js` | Animations et interactions, sans dépendance |
| `public/img/` | Icônes Data Dragon converties en WebP (~41 Ko au total) |
| `public/fonts/` | Archivo (variable, largeur + graisse) et JetBrains Mono, hébergées ici |

La page doit rester légère, comme l'app : pas de framework, pas de CDN, pas de
traqueur. Son poids réel est affiché en bas de page.

## Déploiement

Render redéploie à chaque push sur `main` (service `on-lance-api`, voir
`render.yaml`). Le domaine est chez OVH et pointe déjà sur ce service.

## L'ancien projet

Le tracker Valorant « On lance ? » (détection des games entre potes, coach
positionnel, app PC) est abandonné : Riot propose maintenant la même chose dans
le jeu. Son code est conservé sous l'étiquette `archive-valorant`.

---

On lance ? n'est pas approuvé par Riot Games et ne reflète pas les opinions de
Riot Games ni de quiconque officiellement impliqué dans la production ou la
gestion des propriétés de Riot Games. Riot Games, League of Legends et toutes les
propriétés associées sont des marques commerciales ou des marques déposées de
Riot Games, Inc.
