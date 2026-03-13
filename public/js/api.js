/**
 * api.js – Gedeelde hulpfuncties voor alle pagina's
 * Bevat: API calls, token beheer, navigatie helpers
 */

/**
 * Haal het opgeslagen JWT-token op uit localStorage.
 * @returns {string|null} - Het token of null als niet ingelogd
 */
const getToken = () => localStorage.getItem('sf_token');

/**
 * Haal de opgeslagen gebruikersgegevens op.
 * @returns {object|null} - Gebruikersobject of null
 */
const getGebruiker = () => {
  try {
    const data = localStorage.getItem('sf_gebruiker');
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
};

/**
 * Sla token en gebruikersgegevens op na login/registratie.
 * @param {string} token - JWT token
 * @param {object} gebruiker - Gebruikersgegevens
 */
const slaInlogOp = (token, gebruiker) => {
  localStorage.setItem('sf_token', token);
  localStorage.setItem('sf_gebruiker', JSON.stringify(gebruiker));
};

/**
 * Verwijder alle logingegevens en ga naar de loginpagina.
 */
const uitloggen = () => {
  localStorage.removeItem('sf_token');
  localStorage.removeItem('sf_gebruiker');
  window.location.href = '/';
};

/**
 * Controleer of de gebruiker ingelogd is.
 * Stuurt niet-ingelogde gebruikers door naar de loginpagina.
 */
const vereisInlog = () => {
  if (!getToken()) {
    window.location.href = '/';
  }
};

/**
 * Universele API helper met automatische authenticatie headers.
 * Handelt 401 errors af door de gebruiker uit te loggen.
 *
 * @param {string} url - API endpoint
 * @param {object} opties - Fetch opties (method, body, etc.)
 * @returns {Promise<object>} - JSON response
 * @throws {Error} - Bij netwerk- of serverfouten
 */
const api = async (url, opties = {}) => {
  const token = getToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(opties.headers || {})
  };

  try {
    const response = await fetch(url, { ...opties, headers });
    const data = await response.json();

    // Sessie verlopen of ongeldig token
    if (response.status === 401) {
      uitloggen();
      throw new Error('Sessie verlopen. Log opnieuw in.');
    }

    if (!response.ok) {
      throw new Error(data.fout || `Serverfout (${response.status})`);
    }

    return data;

  } catch (err) {
    // Netwerkfout (server niet bereikbaar)
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error('Kan de server niet bereiken. Controleer je internetverbinding.');
    }
    throw err;
  }
};

/**
 * Toon een melding in een element.
 * @param {string} id - Element ID
 * @param {string} tekst - Meldingstekst
 * @param {'fout'|'succes'} type - Type melding
 */
const toonMelding = (id, tekst, type = 'fout') => {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = tekst;
  el.className = `melding ${type} zichtbaar`;
};

/**
 * Verberg een melding.
 * @param {string} id - Element ID
 */
const verbergMelding = (id) => {
  const el = document.getElementById(id);
  if (el) el.className = 'melding';
};

/**
 * Formatteer een datum naar leesbare Nederlandse tekst.
 * @param {string|Date} datum - Datum om te formatteren
 * @returns {string} - Geformatteerde datum
 */
const formateerDatum = (datum) => {
  return new Date(datum).toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
};
