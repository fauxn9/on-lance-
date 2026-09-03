/**
 * Garde-fou contre la redirection ouverte.
 *
 * Le parametre `next` du flux OAuth existe pour ramener la personne sur la page
 * d'ou elle venait. S'il etait recopie tel quel dans une redirection, le site
 * servirait de tremplin : un lien vers
 * /auth/discord?next=https://faux-site.example enverrait la victime ailleurs
 * avec la caution de notre domaine — de quoi rendre credible une fausse page de
 * connexion.
 *
 * On n'accepte donc qu'un chemin interne. Les cas refuses ne sont pas evidents :
 *
 *   //evil.example        un navigateur y voit un lien protocol-relative, donc
 *                         un autre site, alors que ca commence bien par "/"
 *   /\evil.example        certains navigateurs traitent "\" comme "/"
 *   https://evil.example  le cas nominal
 *
 * A la moindre hesitation on retombe sur le chemin par defaut : perdre la page
 * d'origine est sans consequence, se faire rediriger ailleurs non.
 */
export function safeNext(value, fallback = '/dashboard.html') {
  if (typeof value !== 'string' || value === '') return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // Un saut de ligne dans une valeur reinjectee dans un en-tete permettrait
  // d'en fabriquer un second.
  if (/[\r\n]/.test(value)) return fallback;
  return value;
}
