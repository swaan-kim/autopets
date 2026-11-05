// Temporary appearance: a plain gradient circle. No character assets.
// Contract: mountAppearance(host) renders the pet inside `host`
// (88x88 CSS px) and must not handle input; pet.js owns behaviour.
// applyTheme(host, theme) recolours it; `null` restores the default look.
export function mountAppearance(host) {
  host.classList.add('appearance-circle');
  const core = document.createElement('span');
  core.className = 'circle-core';
  host.append(core);
}

const THEME_VARS = { light: '--pet-light', mid: '--pet-mid', dark: '--pet-dark', shade: '--pet-shade' };

export function applyTheme(host, theme) {
  const previous = host.dataset.theme ?? '';
  const next = theme?.id ?? '';
  for (const [key, cssVar] of Object.entries(THEME_VARS)) {
    if (theme?.[key]) host.style.setProperty(cssVar, theme[key]);
    else host.style.removeProperty(cssVar);
  }
  if (next) host.dataset.theme = next;
  else delete host.dataset.theme;
  if (previous !== next) {
    host.classList.remove('theme-changed');
    void host.offsetWidth; // restart the pop animation
    host.classList.add('theme-changed');
  }
}
