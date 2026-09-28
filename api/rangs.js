// Les rangs de League, du Fer IV au Challenger.

export const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
export const DIVS = { IV: 0, III: 1, II: 2, I: 3 };

// Position absolue sur l'échelle, pour tracer une courbe qui traverse les
// divisions sans sauts : Fer IV 0 PL = 0, chaque division vaut 100.
export function ladder(tier, division, lp) {
  const t = TIERS.indexOf(tier);
  if (t < 0) return null;
  if (t >= 7) return 7 * 400 + lp;
  return t * 400 + (DIVS[division] ?? 0) * 100 + lp;
}
