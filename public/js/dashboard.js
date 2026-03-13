/**
 * dashboard.js – Dashboard logica
 * Laadt en toont studeersessies, statistieken en gebruikersgegevens.
 */

// Controleer of gebruiker ingelogd is
vereisInlog();

/** Haal gebruikersgegevens op en vul de welkomstbalk in */
const laadGebruiker = () => {
  const gebruiker = getGebruiker();
  if (!gebruiker) return;

  document.getElementById('gebruiker-naam').textContent = gebruiker.naam.split(' ')[0];
  document.getElementById('gebruiker-info').textContent =
    `${gebruiker.opleiding} · ${gebruiker.school} · ${gebruiker.niveau.charAt(0).toUpperCase() + gebruiker.niveau.slice(1)}`;
};

/**
 * Laad alle sessies van de ingelogde gebruiker en bereken statistieken.
 * Toont laadanimatie tijdens ophalen en foutmelding bij mislukken.
 */
const laadSessies = async () => {
  try {
    const data = await api('/api/sessies');
    const sessies = data.sessies || [];

    // Bereken statistieken
    const totaalFlashcards = sessies.reduce((som, s) => som + (s.flashcards?.length || 0), 0);
    const totaalQuizzen = sessies.reduce((som, s) => som + (s.statistieken?.quizGespeeld || 0), 0);
    const besteScore = sessies.reduce((best, s) => Math.max(best, s.statistieken?.besteScore || 0), 0);

    document.getElementById('stat-sessies').textContent = sessies.length;
    document.getElementById('stat-flashcards').textContent = totaalFlashcards;
    document.getElementById('stat-quizzen').textContent = totaalQuizzen;
    document.getElementById('stat-score').textContent = besteScore > 0 ? `${besteScore}/8` : '–';

    // Render sessies
    const container = document.getElementById('sessies-container');
    if (sessies.length === 0) {
      container.innerHTML = `
        <div class="leeg">
          <div class="leeg-icon">📚</div>
          <h3>Nog geen sessies</h3>
          <p>Upload een PDF om je eerste studeersessie te starten.</p>
          <a href="/studeren" class="btn btn-primary" style="margin-top:16px">Starten</a>
        </div>`;
      return;
    }

    container.innerHTML = `<div class="sessie-grid">${sessies.map(renderSessieKaart).join('')}</div>`;

  } catch (err) {
    console.error('Sessies laden fout:', err.message);
    document.getElementById('sessies-container').innerHTML = `
      <div class="leeg">
        <div class="leeg-icon">⚠️</div>
        <h3>Kon sessies niet laden</h3>
        <p>${err.message}</p>
        <button class="btn btn-secondary" onclick="laadSessies()" style="margin-top:16px">Opnieuw proberen</button>
      </div>`;
  }
};

/**
 * Genereer de HTML voor een sessiekaart in het dashboard.
 * @param {object} sessie - Sessieobject uit de database
 * @returns {string} - HTML string
 */
const renderSessieKaart = (sessie) => {
  const datum = formateerDatum(sessie.aangemaaktOp);
  const isOpenbaar = sessie.isOpenbaar;

  return `
    <div class="sessie-kaart">
      <div>
        <div class="sessie-naam" title="${sessie.titel}">${sessie.titel}</div>
        <div class="sessie-meta" style="margin-top:8px">
          <span class="badge badge-grijs">${datum}</span>
          ${isOpenbaar ? '<span class="badge badge-blauw">Openbaar</span>' : ''}
        </div>
      </div>
      <div class="sessie-acties">
        <button class="btn btn-secondary btn-sm" onclick="openSessie('${sessie._id}')">
          Openen
        </button>
        <button class="btn btn-secondary btn-sm" onclick="wisselDelen('${sessie._id}', ${!isOpenbaar})">
          ${isOpenbaar ? '🔒 Privé' : '🔗 Delen'}
        </button>
        <button class="delete-knop" onclick="verwijderSessie('${sessie._id}')" title="Verwijderen">🗑</button>
      </div>
    </div>`;
};

/**
 * Navigeer naar de studypagina met een bestaande sessie.
 * @param {string} id - Sessie ID
 */
const openSessie = (id) => {
  window.location.href = `/studeren?sessie=${id}`;
};

/**
 * Schakel de openbaar/privé status van een sessie om.
 * @param {string} id - Sessie ID
 * @param {boolean} isOpenbaar - Nieuwe deelstatus
 */
const wisselDelen = async (id, isOpenbaar) => {
  try {
    await api(`/api/sessies/${id}/delen`, {
      method: 'PUT',
      body: JSON.stringify({ isOpenbaar })
    });
    await laadSessies(); // Herlaad om bijgewerkte status te tonen
  } catch (err) {
    console.error('Delen wijzigen fout:', err.message);
    alert('Kon deelstatus niet wijzigen: ' + err.message);
  }
};

/**
 * Verwijder een sessie na bevestiging.
 * @param {string} id - Sessie ID
 */
const verwijderSessie = async (id) => {
  if (!confirm('Weet je zeker dat je deze sessie wilt verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;

  try {
    await api(`/api/sessies/${id}`, { method: 'DELETE' });
    await laadSessies();
  } catch (err) {
    console.error('Verwijderen fout:', err.message);
    alert('Kon sessie niet verwijderen: ' + err.message);
  }
};

// Initialiseer dashboard
laadGebruiker();
laadSessies();
