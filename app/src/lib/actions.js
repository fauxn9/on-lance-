// Petites interactions réutilisables, en actions Svelte (`use:onde`).
// Tout passe par transform et opacity : c'est ce qui reste fluide même avec
// le rendu logiciel de WebView2 (on coupe le GPU pour économiser la RAM).

const calme = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Onde de clic : un cercle qui part du doigt et s'efface. L'élément doit être
// en position relative avec overflow hidden (classe .ondulable).
export function onde(node) {
  const down = (e) => {
    if (e.button !== 0 || node.disabled || calme()) return;
    const r = node.getBoundingClientRect();
    const taille = Math.max(r.width, r.height) * 2.4;
    const s = document.createElement('span');
    s.className = 'onde';
    s.style.width = s.style.height = `${taille}px`;
    s.style.left = `${e.clientX - r.left - taille / 2}px`;
    s.style.top = `${e.clientY - r.top - taille / 2}px`;
    node.append(s);
    s.addEventListener('animationend', () => s.remove(), { once: true });
  };
  node.classList.add('ondulable');
  node.addEventListener('pointerdown', down);
  return { destroy: () => node.removeEventListener('pointerdown', down) };
}

// Inclinaison 3D qui suit la souris (cartes de rang, emblèmes).
export function inclinaison(node, force = 10) {
  if (calme()) return {};
  let raf = 0;
  const move = (e) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const r = node.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      node.style.setProperty('--ry', `${(x * force).toFixed(2)}deg`);
      node.style.setProperty('--rx', `${(-y * force).toFixed(2)}deg`);
      node.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
      node.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`);
    });
  };
  const leave = () => {
    cancelAnimationFrame(raf);
    node.style.setProperty('--rx', '0deg');
    node.style.setProperty('--ry', '0deg');
  };
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerleave', leave);
  return {
    destroy() {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
    },
  };
}
