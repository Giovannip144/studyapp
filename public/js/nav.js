/**
 * nav.js – Gedeelde navigatie logica
 * Beheert het mobiele fullscreen hamburger menu.
 * Wordt geladen op alle pagina's.
 */

/**
 * Wissel het mobiele menu open/dicht.
 */
const wisselMenu = () => {
  const menu = document.getElementById('mobiel-menu');
  const hamburger = document.getElementById('hamburger');
  const isOpen = menu.classList.contains('open');

  menu.classList.toggle('open', !isOpen);
  hamburger.classList.toggle('open', !isOpen);
  document.body.classList.toggle('menu-open', !isOpen);
};

/** Sluit het menu */
const sluitMenu = () => {
  document.getElementById('mobiel-menu')?.classList.remove('open');
  document.getElementById('hamburger')?.classList.remove('open');
  document.body.classList.remove('menu-open');
};

// Sluit menu bij Escape toets
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') sluitMenu();
});

// Sluit menu bij navigatie (link klik)
document.querySelectorAll('.mobiel-nav-link').forEach(link => {
  link.addEventListener('click', sluitMenu);
});
