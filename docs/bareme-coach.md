# Barème du coach — les trois pires constats, relatifs au rang

État au 04/09/2026 : **branché et en service**. Le moteur vit dans
`src/services/analysis.js` et `src/services/tiers.js` (23 tests), les mesures
des dix joueurs sont stockées par le job d'analyse dans `match_players`, et
`buildCoachReport()` s'en sert à la place des seuils fixes.

Repli automatique : sans mesures de pairs (base neuve, joueur non classé, moins
de 20 pairs), le coach retombe sur `detectPatterns()` et ses seuils fixes. La
page le dit alors explicitement.

## Le problème qu'il fallait résoudre d'abord

« Un barème selon le rang » suppose de savoir ce que vaut un joueur de ce rang.
Cette donnée n'existe nulle part publiquement. L'inventer aurait été pire que de
ne rien dire : ce n'aurait pas été une vanne ratée comme les « 34 % de clutch »,
mais un chiffre faux **au fondement de tout le coach**.

La solution était dans les parties elles-mêmes. Chaque match contient les **dix**
joueurs, avec leur rang (`player.tier.id`, un entier donné par Riot) et leurs
statistiques, **et** les positions de tout le monde à chaque kill. Les mêmes
calculs s'appliquent donc aux neuf autres qu'au joueur suivi.

Sur 5 matchs : **42 joueurs mesurés**, dont 33 à ±2 divisions du rang du joueur.
Le groupe de comparaison n'est pas une moyenne trouvée sur internet : c'est
l'adversaire d'hier soir, sur les mêmes maps, la même semaine.

## L'échelle de rang

`player.tier.id` est vérifié contre de vraies parties : ids contigus,
12 = Or 1 … 19 = Diamant 2, donc Fer 1 = 3 et Radiant = 27.
`src/services/tiers.js` ne fait que traduire cet entier.

Le groupe se resserre d'abord à **±2 divisions**, puis s'élargit à ±4 puis ±8
seulement si moins de 20 pairs sont disponibles. L'élargissement est renvoyé
dans le rapport (`groupe.ecartDeRang`) : un constat comparé à « Or 1 à Diamant 2 »
n'a pas le même poids qu'un constat comparé à son propre palier.

## Le barème

| Grandeur | Définition |
|---|---|
| `position` | où se situe le joueur dans son groupe, orientée « mauvais » : 0 = meilleur, 1 = pire. Un rang relatif, pas un écart brut — robuste aux valeurs extrêmes. Les égalités comptent pour moitié. |
| `confiance` | `min(1, n / minimum)`. Un écart énorme sur 4 événements ne doit pas battre un écart net sur 80. |
| `severite` | `position × confiance` |

Gravité affichée : **fort** ≥ 0,80 · **net** ≥ 0,60 · **info** en dessous.

Trois filtres avant qu'un constat existe :

1. échantillon d'au moins 60 % du minimum de l'axe, sinon l'axe se tait ;
2. groupe d'au moins 20 pairs, sinon aucun constat n'est produit du tout ;
3. `position > 0,5` — être meilleur que la médiane de son rang n'est pas un
   reproche, c'est du bruit.

Seuls les **trois** de plus forte sévérité sortent. Les autres sont conservés
dans `ecartes` pour le journal : savoir ce qui a été calculé puis écarté aide à
comprendre pourquoi le coach dit ce qu'il dit.

## Les huit axes

| Clé | Ce qui est mesuré | Mauvais quand | Minimum |
|---|---|---|---|
| `isolement` | % de morts à plus de 15 m du coéquipier le plus proche | haut | 15 morts |
| `trade` | % de morts non vengeables (aucun coéquipier à moins de 8 m) | haut | 15 morts |
| `entree` | % de morts dans les 20 premières secondes du round | haut | 15 morts |
| `ouverture` | % de rounds où il est le premier mort | haut | 12 rounds |
| `degats_recus` | dégâts encaissés par round | haut | 8 rounds |
| `degats_infliges` | dégâts infligés par round | bas | 8 rounds |
| `precision` | % de tirs à la tête | bas | 60 tirs |
| `apres_plant` | % de morts après la pose du spike | haut | 12 morts |

Ajouter un axe = ajouter une entrée dans `AXES` et le champ correspondant dans
`agreger()`. Rien d'autre à toucher.

## Ce que ça donne sur les vraies parties (04/09/2026)

Rang Platine 1, groupe de 33 joueurs à ±2 divisions :

```
[FORT] sev 1.00 · 100e centile   58 % de tes morts tombent dans les 20 premières
                                 secondes du round, contre 30 % à ton rang (90 morts)
[FORT] sev 1.00 · 100e centile   tu es le premier mort dans 28 % des rounds,
                                 contre 5 % à ton rang (104 rounds)
[NET ] sev 0.76 ·  76e centile   tu encaisses 161 dégâts par round,
                                 contre 145 à ton rang (104 rounds)
écartés : precision 0.54
```

**L'isolement et le trade ne sortent plus.** Ils restent vrais dans l'absolu
(52 % de morts isolées), mais une fois comparés au rang ils deviennent
ordinaires : tout le monde meurt isolé à ce niveau. Le vrai problème est
ailleurs, et il est massif — être le premier mort dans plus d'un round sur
quatre, quand la médiane du rang est à un round sur vingt.

C'est exactement ce que le barème relatif devait révéler et que des seuils fixes
auraient caché.

## Rattrapage

Le job d'analyse saute les matchs déjà traités : les parties d'avant le barème
n'auraient donc jamais de feuille de match. D'où :

```bash
npm run backfill:players
```

Portée limitée à ce que l'API sert encore (les dernières parties par joueur) —
rien de plus n'est récupérable. Rejouable sans risque, les écritures sont des
upserts.
