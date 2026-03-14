/**
 * ontdek.js – Ontdek pagina logica
 * Laadt openbare sessies, filtert op zoekterm/niveau/opleiding,
 * toont een preview modal met flashcards en beheert reacties.
 */

vereisInlog();

/** Alle opgehaalde sessies (ongefilterd) */
let alleSessies = [];

/** Ingelogde gebruiker */
const ikzelf = getGebruiker();

/**
 * Laad alle openbare sessies van de API.
 * Vult ook het opleiding-filter dynamisch in op basis van beschikbare data.
 */
const laadOpenbareSessies = async () => {
  try {
    const data = await api('/api/sessies/openbaar');
    alleSessies = data.sessies || [];

    // Vul opleiding filter dynamisch in met unieke waarden
    const opleidingen = [...new Set(
      alleSessies.map(s => s.gebruiker?.opleiding).filter(Boolean)
    )].sort();

    const opleidingSelect = document.getElementById('filter-opleiding');
    opleidingen.forEach(opleiding => {
      const optie = document.createElement('option');
      optie.value = opleiding;
      optie.textContent = opleiding;
      opleidingSelect.appendChild(optie);
    });

    filterSessies();

  } catch (err) {
    console.error('Openbare sessies laden fout:', err.message);
    document.getElementById('sessies-container').innerHTML = `
      <div class="leeg">
        <div class="leeg-icon">⚠️</div>
        <h3>Kon sessies niet laden</h3>
        <p>${err.message}</p>
        <button class="btn btn-secondary" onclick="laadOpenbareSessies()" style="margin-top:16px">Opnieuw proberen</button>
      </div>`;
    document.getElementById('resultaten-teller').textContent = '';
  }
};

/**
 * Filter de sessies op basis van zoekterm, niveau en opleiding.
 */
const filterSessies = () => {
  const zoekterm = document.getElementById('zoek-invoer').value.toLowerCase().trim();
  const niveau = document.getElementById('filter-niveau').value;
  const opleiding = document.getElementById('filter-opleiding').value;

  const gefilterd = alleSessies.filter(sessie => {
    const g = sessie.gebruiker || {};
    const zoekMatch = !zoekterm || [sessie.titel, sessie.bestandsnaam, g.school, g.opleiding, g.naam]
      .some(v => v?.toLowerCase().includes(zoekterm));
    const niveauMatch = !niveau || g.niveau === niveau;
    const opleidingMatch = !opleiding || g.opleiding === opleiding;
    return zoekMatch && niveauMatch && opleidingMatch;
  });

  renderSessies(gefilterd);
};

/** Reset alle filters */
const resetFilters = () => {
  document.getElementById('zoek-invoer').value = '';
  document.getElementById('filter-niveau').value = '';
  document.getElementById('filter-opleiding').value = '';
  filterSessies();
};

/**
 * Render de gefilterde sessies als kaarten.
 * @param {Array} sessies
 */
const renderSessies = (sessies) => {
  document.getElementById('resultaten-teller').textContent =
    `${sessies.length} sessie${sessies.length !== 1 ? 's' : ''} gevonden`;

  const container = document.getElementById('sessies-container');

  if (sessies.length === 0) {
    container.innerHTML = `
      <div class="leeg">
        <div class="leeg-icon">🔍</div>
        <h3>Geen sessies gevonden</h3>
        <p>Probeer andere zoektermen of filters.</p>
        <button class="btn btn-secondary" onclick="resetFilters()" style="margin-top:16px">Wis filters</button>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="sessie-grid">${sessies.map(renderSessieKaart).join('')}</div>`;
};

/**
 * Genereer HTML voor een sessiekaart.
 * @param {object} sessie
 * @returns {string}
 */
const renderSessieKaart = (sessie) => {
  const g = sessie.gebruiker || {};
  const initiaal = g.naam?.charAt(0).toUpperCase() || '?';
  const datum = formateerDatum(sessie.aangemaaktOp);
  const niveauKleur = { middelbaar: 'badge-roze', bachelor: 'badge-blauw', master: 'badge-groen' }[g.niveau] || 'badge-grijs';

  return `
    <div class="sessie-kaart">
      <div class="sessie-titel">${escHtml(sessie.titel || sessie.bestandsnaam)}</div>
      <div class="auteur-rij">
        <div class="auteur-avatar">${initiaal}</div>
        <div class="auteur-info">
          <span class="auteur-naam">${escHtml(g.naam || 'Onbekend')}</span>
          <span class="auteur-school">${escHtml(g.school || '')}</span>
        </div>
      </div>
      <div class="sessie-badges">
        ${g.niveau ? `<span class="badge ${niveauKleur}">${g.niveau.charAt(0).toUpperCase() + g.niveau.slice(1)}</span>` : ''}
        ${g.opleiding ? `<span class="badge badge-grijs">${escHtml(g.opleiding)}</span>` : ''}
        <span class="badge badge-grijs">${datum}</span>
      </div>
      <div class="sessie-stats">
        <span class="stat-item">🃏 ${sessie.flashcards?.length || 0} flashcards</span>
        <span class="stat-item">⚡ ${sessie.quiz?.length || 0} vragen</span>
        <span class="stat-item">🏆 ${sessie.statistieken?.quizGespeeld || 0}× gespeeld</span>
      </div>
      <div class="sessie-acties">
        <button class="btn btn-secondary" onclick="openPreview('${sessie._id}')">👁 Bekijk</button>
        <button class="btn btn-primary" onclick="oefenSessie('${sessie._id}')">Oefenen →</button>
      </div>
    </div>`;
};

// ─── MODAL ────────────────────────────────────────────────

let modalSessieId = null;

/**
 * Open preview modal voor een sessie inclusief reacties.
 * @param {string} id - Sessie ID
 */
const openPreview = async (id) => {
  modalSessieId = id;
  document.getElementById('modal-titel').textContent = 'Laden…';
  document.getElementById('modal-body').innerHTML = `
    <div style="text-align:center;padding:40px">
      <div class="spinner" style="width:32px;height:32px;border-width:3px;margin:0 auto"></div>
    </div>`;
  document.getElementById('modal').style.display = 'flex';

  try {
    // Laad sessie en reacties parallel
    const [sessieData, reactiesData] = await Promise.all([
      api(`/api/sessies/${id}`),
      api(`/api/reacties/${id}`)
    ]);

    const s = sessieData.sessie;
    const g = s.gebruiker || {};
    const reacties = reactiesData.reacties || [];

    document.getElementById('modal-titel').textContent = s.titel || s.bestandsnaam;
    document.getElementById('modal-studeren-knop').onclick = () => oefenSessie(id);

    const previewFc = (s.flashcards || []).slice(0, 3);

    document.getElementById('modal-body').innerHTML = `
      <!-- Auteur -->
      <div class="auteur-rij" style="margin-bottom:20px">
        <div class="auteur-avatar" style="width:40px;height:40px;font-size:16px">${g.naam?.charAt(0).toUpperCase() || '?'}</div>
        <div class="auteur-info">
          <span class="auteur-naam" style="font-size:14px">${escHtml(g.naam || 'Onbekend')}</span>
          <span class="auteur-school">${escHtml(g.opleiding || '')} · ${escHtml(g.school || '')} · ${g.niveau || ''}</span>
        </div>
      </div>

      <!-- Samenvatting preview -->
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Samenvatting</div>
      <div style="font-size:14px;line-height:1.7;color:#d0d0e0;margin-bottom:24px;max-height:120px;overflow-y:auto;white-space:pre-wrap;padding-right:4px">
        ${escHtml((s.samenvatting || '').substring(0, 500))}${s.samenvatting?.length > 500 ? '…' : ''}
      </div>

      <!-- Flashcard preview -->
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:8px">
        Voorbeeld flashcards (${previewFc.length} van ${s.flashcards?.length || 0})
      </div>
      ${previewFc.map(fc => `
        <div class="preview-fc">
          <div class="preview-fc-vraag">Vraag</div>
          <div>${escHtml(fc.voorkant)}</div>
        </div>`).join('')}
      ${s.flashcards?.length > 3 ? `<div style="font-size:12px;color:var(--muted);text-align:center;margin-top:6px;margin-bottom:4px">+${s.flashcards.length - 3} meer flashcards</div>` : ''}

      <!-- Reacties sectie -->
      <div style="margin-top:28px">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:14px">
          💬 Reacties (${reacties.length})
        </div>

        <!-- Reactie invoer -->
        <div class="reactie-invoer-wrap">
          <div class="reactie-avatar-klein">${ikzelf?.naam?.charAt(0).toUpperCase() || '?'}</div>
          <div style="flex:1">
            <textarea
              id="reactie-tekst"
              class="reactie-textarea"
              placeholder="Deel een tip of reactie bij deze sessie…"
              maxlength="500"
              oninput="updateTeller(this)"
            ></textarea>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
              <span id="reactie-teller" style="font-size:11px;color:var(--muted)">0 / 500</span>
              <button class="btn btn-primary btn-sm" id="reactie-knop" onclick="plaatsReactie('${id}')">
                Plaatsen
              </button>
            </div>
          </div>
        </div>

        <!-- Foutmelding -->
        <div id="reactie-melding" class="melding fout" style="margin-top:8px"></div>

        <!-- Reactielijst -->
        <div id="reacties-lijst" style="margin-top:16px">
          ${reacties.length === 0
            ? `<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">Nog geen reacties. Wees de eerste!</div>`
            : reacties.map(renderReactie).join('')}
        </div>
      </div>`;

  } catch (err) {
    console.error('Preview laden fout:', err.message);
    document.getElementById('modal-body').innerHTML = `
      <div class="leeg">
        <div class="leeg-icon">⚠️</div>
        <h3>Kon sessie niet laden</h3>
        <p>${err.message}</p>
      </div>`;
  }
};

/**
 * Genereer HTML voor een enkele reactie.
 * @param {object} reactie - Reactieobject met gebruikersgegevens
 * @returns {string}
 */
const renderReactie = (reactie) => {
  const g = reactie.gebruiker || {};
  const initiaal = g.naam?.charAt(0).toUpperCase() || '?';
  const datum = formateerDatum(reactie.aangemaaktOp);
  const isEigenReactie = ikzelf?.id === reactie.gebruiker?._id || ikzelf?.id === reactie.gebruiker;

  return `
    <div class="reactie-item" id="reactie-${reactie._id}">
      <div class="reactie-avatar-klein">${initiaal}</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div>
            <span style="font-size:13px;font-weight:500">${escHtml(g.naam || 'Onbekend')}</span>
            <span style="font-size:11px;color:var(--muted);margin-left:8px">${escHtml(g.opleiding || '')} · ${datum}</span>
          </div>
          ${isEigenReactie ? `
            <button onclick="verwijderReactie('${reactie._id}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px;transition:color 0.2s" title="Verwijderen" onmouseover="this.style.color='var(--accent3)'" onmouseout="this.style.color='var(--muted)'">🗑</button>
          ` : ''}
        </div>
        <div style="font-size:14px;line-height:1.6;color:#d0d0e0">${escHtml(reactie.tekst)}</div>
      </div>
    </div>`;
};

/**
 * Update de tekenteller bij het typen van een reactie.
 * @param {HTMLTextAreaElement} el
 */
const updateTeller = (el) => {
  const teller = document.getElementById('reactie-teller');
  if (teller) teller.textContent = `${el.value.length} / 500`;
};

/**
 * Plaats een nieuwe reactie bij een sessie.
 * @param {string} sessieId - Sessie ID
 */
const plaatsReactie = async (sessieId) => {
  const textarea = document.getElementById('reactie-tekst');
  const knop = document.getElementById('reactie-knop');
  const tekst = textarea?.value?.trim();

  verbergMelding('reactie-melding');

  if (!tekst) {
    toonMelding('reactie-melding', 'Schrijf eerst een reactie.');
    return;
  }

  knop.disabled = true;
  knop.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span>';

  try {
    const data = await api(`/api/reacties/${sessieId}`, {
      method: 'POST',
      body: JSON.stringify({ tekst })
    });

    // Voeg nieuwe reactie bovenaan toe
    const lijst = document.getElementById('reacties-lijst');
    const leegBericht = lijst.querySelector('div[style*="Nog geen reacties"]');
    if (leegBericht) leegBericht.remove();

    lijst.insertAdjacentHTML('afterbegin', renderReactie(data.reactie));

    // Reset invoerveld
    textarea.value = '';
    updateTeller(textarea);

    // Update reactieteller in de header
    const titelEl = document.getElementById('modal-body').querySelector('[style*="Reacties ("]');
    if (titelEl) {
      const huidigAantal = parseInt(titelEl.textContent.match(/\d+/)?.[0] || 0);
      titelEl.textContent = `💬 Reacties (${huidigAantal + 1})`;
    }

  } catch (err) {
    console.error('Reactie plaatsen fout:', err.message);
    toonMelding('reactie-melding', err.message);
  } finally {
    knop.disabled = false;
    knop.innerHTML = 'Plaatsen';
  }
};

/**
 * Verwijder een reactie na bevestiging.
 * @param {string} reactieId - Reactie ID
 */
const verwijderReactie = async (reactieId) => {
  if (!confirm('Reactie verwijderen?')) return;

  try {
    await api(`/api/reacties/${reactieId}`, { method: 'DELETE' });

    // Verwijder reactie uit de DOM
    const el = document.getElementById(`reactie-${reactieId}`);
    if (el) el.remove();

    // Toon leeg bericht als er geen reacties meer zijn
    const lijst = document.getElementById('reacties-lijst');
    if (lijst && !lijst.querySelector('.reactie-item')) {
      lijst.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">Nog geen reacties. Wees de eerste!</div>`;
    }

  } catch (err) {
    console.error('Reactie verwijderen fout:', err.message);
    alert('Kon reactie niet verwijderen: ' + err.message);
  }
};

/** Sluit modal bij klik buiten */
const sluitModal = (event) => {
  if (event.target === document.getElementById('modal')) sluitModalDirect();
};

/** Sluit modal direct */
const sluitModalDirect = () => {
  document.getElementById('modal').style.display = 'none';
  modalSessieId = null;
};

/**
 * Navigeer naar de studypagina.
 * @param {string} id - Sessie ID
 */
const oefenSessie = (id) => {
  window.location.href = `/studeren?sessie=${id}`;
};

/**
 * Escape HTML om XSS te voorkomen.
 * @param {string} tekst
 * @returns {string}
 */
const escHtml = (tekst) => String(tekst || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

// Sluit modal met Escape toets
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') sluitModalDirect();
});

// Initialiseer
laadOpenbareSessies();