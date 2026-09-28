<script>
  // Un nombre qui défile jusqu'à sa valeur, et qui repart de l'ancienne quand
  // elle change (après une partie, les PL glissent de 64 à 85).
  import { untrack } from 'svelte';
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';

  let { valeur = 0, format = (n) => String(Math.round(n)), duree = 1100, classe = '' } = $props();
  const calme = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // La durée est fixée à la création : la changer en cours de route n'a pas de sens.
  const t = new Tween(0, { duration: untrack(() => (calme ? 0 : duree)), easing: cubicOut });
  $effect(() => {
    t.target = Number(valeur) || 0;
  });
</script>

<span class={classe}>{format(t.current)}</span>
