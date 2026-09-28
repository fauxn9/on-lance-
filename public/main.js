// On lance ? — interactions de la page. Aucune dépendance.
(() => {
  const root = document.documentElement;
  root.classList.remove('no-js');

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const desktop = matchMedia('(min-width: 900px)');
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  /* ---------------------------------------------------------- Titre découpé en mots */
  let wordIndex = 0;
  $$('[data-split]').forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.setAttribute('aria-label', el.textContent.trim());
    el.textContent = '';
    words.forEach((word, i) => {
      const w = document.createElement('span');
      w.className = 'w';
      w.setAttribute('aria-hidden', 'true');
      const wi = document.createElement('span');
      wi.className = 'wi';
      wi.textContent = word;
      wi.style.setProperty('--d', `${0.12 + wordIndex++ * 0.07}s`);
      w.append(wi);
      el.append(w);
      if (i < words.length - 1) el.append(' ');
    });
  });
  const ready = () => requestAnimationFrame(() => root.classList.add('is-ready'));
  (document.fonts?.ready ?? Promise.resolve()).then(ready);
  setTimeout(ready, 900);

  /* ---------------------------------------------------------- Mise à l'échelle des maquettes */
  // Les maquettes sont dessinées à une largeur fixe puis zoomées pour tenir
  // dans leur colonne : elles restent nettes et ne se réorganisent jamais.
  const fits = [];
  const fit = (el, width, extra = 0) => fits.push({ el, width, extra });
  const applyFits = () => {
    for (const f of fits) {
      const p = f.el.parentElement;
      const cs = getComputedStyle(p);
      const avail = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const z = Math.min(1, avail / (f.width + (desktop.matches ? f.extra : 0)));
      f.el.style.zoom = z.toFixed(4);
    }
  };

  /* ---------------------------------------------------------- Hero */
  const hero = $('[data-hero]');
  const stage = $('.stage');
  fit(stage, 1000, 140);
  $$('.chip').forEach((c) => c.style.setProperty('--dp', c.dataset.depth || 1));

  if (fine && !reduce) {
    let mx = 0, my = 0, raf = 0;
    hero.addEventListener('pointermove', (e) => {
      mx = e.clientX; my = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = hero.getBoundingClientRect();
        hero.style.setProperty('--sx', `${mx - r.left}px`);
        hero.style.setProperty('--sy', `${my - r.top}px`);
        stage.style.setProperty('--px', ((mx / innerWidth) * 2 - 1).toFixed(3));
        stage.style.setProperty('--py', ((my / innerHeight) * 2 - 1).toFixed(3));
      });
    });
  }

  /* ---------------------------------------------------------- Boutons aimantés */
  if (fine && !reduce) {
    $$('.btn-lg, .btn-xl').forEach((b) => {
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect();
        b.style.setProperty('--mx-b', `${((e.clientX - r.left) / r.width - 0.5) * 10}px`);
        b.style.setProperty('--my-b', `${((e.clientY - r.top) / r.height - 0.5) * 8}px`);
      });
      b.addEventListener('pointerleave', () => { b.style.setProperty('--mx-b', '0px'); b.style.setProperty('--my-b', '0px'); });
    });
  }

  /* ---------------------------------------------------------- Ticket de caisse */
  const ticket = $('[data-ticket]');
  const printer = $('[data-printer]');
  const paper = $('[data-paper]');
  const stickerTicket = $('.sticker-ticket');
  const saving = $('[data-saving]');
  let pinned = false;

  // Code-barres : dessiné depuis le mot ONLANCE, toujours le même.
  const bc = $('[data-barcode]');
  if (bc) {
    const seed = [...'ONLANCEXYZ'].map((c) => c.charCodeAt(0));
    let x = 0, i = 0;
    const ns = 'http://www.w3.org/2000/svg';
    while (x < 196) {
      const n = seed[i % seed.length] + i * 7;
      const w = 1 + (n % 3);
      const gap = 1 + ((n >> 2) % 3);
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', x); rect.setAttribute('y', 0);
      rect.setAttribute('width', Math.min(w, 200 - x)); rect.setAttribute('height', 44);
      bc.append(rect);
      x += w + gap; i++;
    }
  }

  // Le ticket se réduit pour tenir en hauteur (mode épinglé) et en largeur.
  const ticketGrid = $('.ticket-grid');
  const fitReceipt = () => {
    printer.style.setProperty('--rs', 1);
    const h = paper.offsetHeight;
    const byHeight = pinned ? (innerHeight - 170) / h : 1;
    const col = desktop.matches ? (ticketGrid.clientWidth - 64) / 2 : ticketGrid.clientWidth;
    const byWidth = (col - 44) / 372;
    printer.style.setProperty('--rs', clamp(Math.min(byHeight, byWidth), 0.55, 1).toFixed(3));
  };

  const setPrint = (e) => {
    paper.style.setProperty('--e', e.toFixed(4));
    printer.classList.toggle('printing', e > 0.01 && e < 0.995);
    const done = e >= 0.995;
    stickerTicket.classList.toggle('on', done);
    saving.classList.toggle('done', done);
  };

  const updateTicket = () => {
    if (!pinned) return;
    const r = ticket.getBoundingClientRect();
    const total = ticket.offsetHeight - innerHeight;
    const p = clamp(-r.top / total);
    setPrint(easeOut(clamp(p / 0.78)));
  };

  const setPinMode = () => {
    pinned = desktop.matches && !reduce;
    root.classList.toggle('pinned', pinned);
    fitReceipt();
    if (pinned) updateTicket();
  };

  // Hors mode épinglé : le ticket s'imprime d'un coup quand il arrive à l'écran.
  let printedOnce = false;
  new IntersectionObserver((entries, io) => {
    for (const en of entries) {
      if (!en.isIntersecting || pinned || printedOnce) continue;
      printedOnce = true;
      if (reduce) { setPrint(1); continue; }
      const t0 = performance.now();
      const step = (t) => {
        const k = clamp((t - t0) / 1800);
        setPrint(easeOut(k));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }, { threshold: 0.25 }).observe(printer);

  /* ---------------------------------------------------------- L'app en 4 moments */
  const storyApp = $('.app-story');
  const scenes = $$('.app-story .scene');
  const tabs = $$('.story-tabs [data-tab]');
  const steps = $$('.step');
  fit(storyApp, 720);

  // Version mobile : chaque étape reçoit sa propre copie de la scène.
  $$('[data-slot]').forEach((slot) => {
    const i = Number(slot.dataset.slot);
    const clone = storyApp.cloneNode(true);
    clone.classList.replace('app-story', 'app-mini');
    $$('.scene', clone).forEach((s, k) => { if (k !== i) s.remove(); else s.classList.add('on'); });
    $$('[data-tab]', clone).forEach((t, k) => t.classList.toggle('on', k === i));
    // Identifiants SVG uniques, sinon les dégradés pointent vers la copie cachée.
    $$('[id]', clone).forEach((node) => {
      const old = node.id;
      const neu = `${old}-m${i}`;
      node.id = neu;
      $$('*', clone).forEach((n) => {
        for (const a of ['fill', 'stroke', 'clip-path']) {
          const v = n.getAttribute(a);
          if (v && v.includes(`url(#${old})`)) n.setAttribute(a, v.replace(`url(#${old})`, `url(#${neu})`));
        }
      });
    });
    clone.setAttribute('aria-hidden', 'true');
    slot.append(clone);
    const note = document.createElement('p');
    note.className = 'stage-note';
    note.textContent = "Maquette : l'app est en construction.";
    slot.append(note);
    fit(clone, 720);
  });

  const setScene = (i) => {
    scenes.forEach((s, k) => s.classList.toggle('on', k === i));
    tabs.forEach((t, k) => t.classList.toggle('on', k === i));
    steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
  };
  setScene(0);
  const stepIO = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) setScene(Number(en.target.dataset.step));
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => stepIO.observe(s));

  /* ---------------------------------------------------------- Cartes : halo qui suit la souris */
  if (fine) {
    $$('.tile').forEach((t) => t.addEventListener('pointermove', (e) => {
      const r = t.getBoundingClientRect();
      t.style.setProperty('--x', `${e.clientX - r.left}px`);
      t.style.setProperty('--y', `${e.clientY - r.top}px`);
    }));
  }

  /* ---------------------------------------------------------- RAM */
  const cellsBox = $('[data-cells]');
  const cells = Array.from({ length: 64 }, () => {
    const c = document.createElement('span');
    c.className = 'cell';
    cellsBox.append(c);
    return c;
  });
  const fmt = (n) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const oursLabel = { 8: 'moins de 2 %', 16: 'moins de 1 %', 32: 'moins de 0,5 %' };
  const setRam = (gb) => {
    const heavy = Math.round(128 / gb);          // 2 Go sur 64 cases
    const oursFrac = Math.min(1, 9.375 / gb);    // 150 Mo sur 64 cases
    cells.forEach((c, i) => {
      c.style.setProperty('--dl', `${i * 12}ms`);
      c.classList.toggle('h', i < heavy);
      c.classList.toggle('o', i === heavy);
      if (i === heavy) c.style.setProperty('--f', oursFrac.toFixed(3));
    });
    $('[data-heavy]').textContent = `${fmt(200 / gb)} %`;
    $('[data-ours]').textContent = oursLabel[gb];
    $('[data-cap]').textContent = `Chaque case vaut ${gb * 16} Mo.`;
    $$('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.gb) === gb)));
  };
  $$('.seg button').forEach((b) => b.addEventListener('click', () => setRam(Number(b.dataset.gb))));
  setRam(16);

  /* ---------------------------------------------------------- Apparitions */
  const revealIO = new IntersectionObserver((entries, io) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      en.target.classList.add('in');
      io.unobserve(en.target);
    }
  }, { threshold: 0.2, rootMargin: '0px 0px -8% 0px' });
  $$('[data-reveal], [data-bars], [data-final]').forEach((el) => revealIO.observe(el));
  $$('.plist li').forEach((li, i) => li.style.setProperty('transition-delay', `${i * 60}ms`));

  /* ---------------------------------------------------------- Défilement */
  const nav = $('[data-nav]');
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const y = scrollY;
    nav.toggleAttribute('data-scrolled', y > 12);
    if (!reduce) {
      const p = clamp(y / (innerHeight * 0.75));
      stage.style.setProperty('--rx', `${(20 * (1 - p)).toFixed(2)}deg`);
      stage.style.setProperty('--sc', (0.93 + 0.07 * p).toFixed(4));
    }
    updateTicket();
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });

  const onResize = () => { applyFits(); setPinMode(); onScroll(); };
  addEventListener('resize', onResize);
  desktop.addEventListener('change', onResize);
  applyFits();
  setPinMode();
  onScroll();
  // Le ticket épinglé allonge la page après le calcul de l'ancre : on y retourne.
  const target = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: 'instant' }));
  (document.fonts?.ready ?? Promise.resolve()).then(() => { applyFits(); fitReceipt(); updateTicket(); });

  /* ---------------------------------------------------------- Discord */
  fetch('/api/discord')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || !d.members || d.members < 30) return;
      $('[data-members]').textContent = `${d.members.toLocaleString('fr-FR')} joueurs nous attendent déjà · discord.gg/BA6JcwFP8a`;
    })
    .catch(() => {});

  /* ---------------------------------------------------------- Poids réel de la page */
  addEventListener('load', () => setTimeout(() => {
    const nav0 = performance.getEntriesByType('navigation')[0];
    const bytes = [nav0, ...performance.getEntriesByType('resource')]
      .filter(Boolean)
      .reduce((s, e) => s + (e.encodedBodySize || e.transferSize || 0), 0);
    if (bytes > 0) {
      $('[data-weight]').textContent = `Cette page pèse ${Math.round(bytes / 1024)} Ko, polices et images comprises.`;
    }
  }, 1200));
})();
