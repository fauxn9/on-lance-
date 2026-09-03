/**
 * Enrobage des handlers Express asynchrones.
 *
 * Express 5 ne sait pas attraper le rejet d'une promesse : sans ca, la moindre
 * requete SQL qui echoue laisse la requete pendante jusqu'au timeout, sans
 * reponse et sans trace.
 *
 * Le troisieme argument compte autant que les deux premiers. Un handler final
 * n'a besoin que de (req, res), mais une BARRIERE — celle qui verifie qu'on est
 * membre d'un groupe, par exemple — doit appeler next() pour laisser passer.
 * Une premiere version n'en transmettait que deux : `next` valait undefined, et
 * toute page de groupe repondait « next is not a function ». C'est pour ca que
 * cette fonction vit dans son propre fichier avec son propre test.
 */
export const wrap = (fn) => (req, res, next) => {
  // Appeler fn dans l'executeur plutot que de passer son resultat a
  // Promise.resolve : une erreur levee AVANT le premier await (un handler non
  // async, une faute de frappe) s'echapperait sinon en synchrone, hors de
  // portee du .catch.
  new Promise((resolve) => resolve(fn(req, res, next))).catch((err) => {
    console.error(err);
    // Une erreur survenue apres l'envoi de la reponse ne doit pas en declencher
    // une seconde : Express leverait alors « headers already sent », qui masque
    // l'erreur d'origine.
    if (res.headersSent) return;
    res.status(500).json({ error: err.message });
  });
};
