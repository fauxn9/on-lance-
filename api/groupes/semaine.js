// Classement de la semaine entre potes (brique 8).
//
// Repris du projet Valorant (brique 2) : la semaine commence le lundi à
// minuit DANS LE FUSEAU DU GROUPE (une game du dimanche 23 h compte encore),
// les semaines terminées sont figées avec leur vainqueur.
//
// La mesure : les LP gagnés ou perdus sur la semaine, Solo/Duo et Flex
// additionnées, tous les comptes d'une même personne réunis. On lit l'écart
// sur l'échelle continue des rangs (`ladder`) : une montée de division ou de
// palier compte juste, sans saut de 100 LP.

import { ladder } from '../rangs.js';

const JOUR = 86_400_000;
export const FUSEAU = 'Europe/Paris';

function dateCivile(date, timeZone) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date).split('-').map(Number);
  return { y, m, d };
}

// Lundi de la semaine contenant `date`, au format AAAA-MM-JJ.
export function debutDeSemaine(date, timeZone = FUSEAU) {
  const { y, m, d } = dateCivile(date, timeZone);
  const civil = Date.UTC(y, m - 1, d);
  const decalage = (new Date(civil).getUTCDay() + 6) % 7; // lundi → 0
  return new Date(civil - decalage * JOUR).toISOString().slice(0, 10);
}

export const decalerSemaine = (semaine, n) => new Date(Date.parse(`${semaine}T00:00:00Z`) + n * 7 * JOUR).toISOString().slice(0, 10);

// Décalage du fuseau à un instant donné, lu champ par champ (jamais en
// reparsant une date sans fuseau : le résultat dépendrait de la machine).
function decalageMs(instant, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant).map((x) => [x.type, x.value]),
  );
  const civil = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return civil - instant.getTime();
}

// Minuit local d'une date, en deux passes (la seconde corrige le week-end du
// changement d'heure).
function minuitLocal(date, timeZone) {
  const minuit = Date.parse(`${date}T00:00:00Z`);
  const premiere = minuit - decalageMs(new Date(minuit), timeZone);
  return new Date(minuit - decalageMs(new Date(premiere), timeZone));
}

export function bornes(semaine, timeZone = FUSEAU) {
  return { debut: minuitLocal(semaine, timeZone), fin: minuitLocal(decalerSemaine(semaine, 1), timeZone) };
}

export function nomSemaine(semaine) {
  return `semaine du ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${semaine}T00:00:00Z`))}`;
}

// LP gagnés sur la fenêtre pour une file d'un compte : dernière photo avant le
// début (sinon la première de la semaine) contre la dernière avant la fin.
export function ecartFile(avant, pendant) {
  const depart = avant ?? pendant[0];
  const arrivee = pendant.length ? pendant[pendant.length - 1] : avant;
  if (!depart || !arrivee) return 0;
  const a = ladder(depart.tier, depart.division, depart.lp);
  const b = ladder(arrivee.tier, arrivee.division, arrivee.lp);
  return a == null || b == null ? 0 : b - a;
}

// Le classement. `membres` : [{ profil, pseudo, comptes: [puuid] }] ;
// `photos` : { avant: Map(`puuid:file` → photo), pendant: Map(`puuid:file` → [photos]) } ;
// `parties` : Map(puuid → { parties, victoires }).
// Ceux qui n'ont pas joué restent affichés, à 0 : voir « 0 partie » donne
// justement envie d'en lancer une.
export function classer(membres, photos, parties) {
  const lignes = membres.map((m) => {
    let lp = 0, n = 0, v = 0;
    for (const puuid of m.comptes) {
      for (const file of ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR']) {
        const k = `${puuid}:${file}`;
        lp += ecartFile(photos.avant.get(k), photos.pendant.get(k) ?? []);
      }
      n += parties.get(puuid)?.parties ?? 0;
      v += parties.get(puuid)?.victoires ?? 0;
    }
    return { profil: m.profil, pseudo: m.pseudo, lp, parties: n, victoires: v };
  });
  lignes.sort((a, b) => b.lp - a.lp || a.parties - b.parties || a.pseudo.localeCompare(b.pseudo, 'fr'));
  return lignes.map((l, i) => ({ ...l, place: i + 1 }));
}

// Vainqueur d'une semaine terminée, ou null si personne n'a joué.
export function vainqueur(classement) {
  if (!classement.some((l) => l.parties > 0)) return null;
  const [a, b] = classement;
  return { ...a, egalite: Boolean(b && b.lp === a.lp && b.parties === a.parties) };
}
