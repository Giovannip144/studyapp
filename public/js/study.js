/**
 * study.js – Studypagina logica
 * Verwerkt PDF uploads, toont resultaten en slaat sessies op.
 */

vereisInlog();

// ─── STATE ────────────────────────────────────────────────
let huidigeSessie = {
  bestandsnaam: '',
  titel: '',
  samenvatting: '',
  flashcards: [],
  quiz: []
};
let fcIndex = 0;
let fcOmgedraaid = false;
let quizIndex = 0;
let quizScore = 0;
let quizBeantwoord = false;
let quizKlaar = false;

// ─── UPLOAD ───────────────────────────────────────────────

const dropZone = document.getElementById('drop-zone');
const bestandInvoer = document.getElementById('bestand-invoer');

/** Stel drag-and-drop in op de uploadszone */
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('over');
  const bestand = e.dataTransfer.files[0];
  if (bestand?.type === 'application/pdf') verwerkBestand(bestand);
  else toonMelding('upload-melding', 'Alleen PDF-bestanden worden ondersteund.');
});

bestandInvoer.addEventListener('change', (e) => {
  if (e.target.files[0]) verwerkBestand(e.target.files[0]);
});

/**
 * Verwerk een gekozen PDF bestand.
 * Converteert naar base64 en stuurt naar de analyse API.
 * @param {File} bestand - Het gekozen PDF bestand
 */
const verwerkBestand = async (bestand) => {
  toonSectie('laden');
  updateLaadStap('PDF inlezen…');

  try {
    // Converteer PDF naar base64
    const base64 = await naarBase64(bestand);

    updateLaadStap('AI analyseert je document…');

    // Stuur naar de backend voor analyse
    const data = await api('/api/studeren/analyseer', {
      method: 'POST',
      body: JSON.stringify({
        base64,
        bestandsnaam: bestand.name
      })
    });

    updateLaadStap('Resultaten verwerken…');

    // Sla resultaten op in state
    huidigeSessie = {
      bestandsnaam: bestand.name,
      titel: data.resultaat.titel || bestand.name,
      samenvatting: data.resultaat.samenvatting || '',
      flashcards: data.resultaat.flashcards || [],
      quiz: data.resultaat.quiz || []
    };

    toonResultaten();

  } catch (err) {
    console.error('Verwerking fout:', err.message);
    toonSectie('upload');
    toonMelding('upload-melding', `Fout: ${err.message}`);
  }
};

/**
 * Converteer een bestand naar een base64 string.
 * @param {File} bestand - Het te converteren bestand
 * @returns {Promise<string>} - Base64 encoded string (zonder data: prefix)
 */
const naarBase64 = (bestand) => {
  return new Promise((resolve, reject) => {
    const lezer = new FileReader();
    lezer.onload = () => resolve(lezer.result.split(',')[1]);
    lezer.onerror = () => reject(new Error('Kon bestand niet lezen'));
    lezer.readAsDataURL(bestand);
  });
};

// ─── WEERGAVE ─────────────────────────────────────────────

/**
 * Toon de juiste sectie (upload, laden of resultaten).
 * @param {'upload'|'laden'|'resultaten'} sectie
 */
const toonSectie = (sectie) => {
  document.getElementById('upload-sectie').style.display = sectie === 'upload' ? 'block' : 'none';
  document.getElementById('laden-sectie').style.display = sectie === 'laden' ? 'block' : 'none';
  document.getElementById('resultaten-sectie').style.display = sectie === 'resultaten' ? 'block' : 'none';
};

/** Update de laadstap tekst */
const updateLaadStap = (tekst) => {
  document.getElementById('laden-stap').textContent = tekst;
};

/**
 * Vul alle resultaatpanelen in en toon de resultaten.
 */
const toonResultaten = () => {
  document.getElementById('bestand-naam').textContent = huidigeSessie.bestandsnaam;

  // Notities
  document.getElementById('notities-inhoud').textContent = huidigeSessie.samenvatting;

  // Flashcards
  fcIndex = 0;
  fcOmgedraaid = false;
  updateFlashcard();

  // Quiz
  startQuiz();

  toonSectie('resultaten');
};

/** Reset de app terug naar de uploadstaat */
const resetApp = () => {
  toonSectie('upload');
  bestandInvoer.value = '';
  verbergMelding('upload-melding');
  verbergMelding('opslaan-melding');
};

// ─── TABS ─────────────────────────────────────────────────

/**
 * Wissel tussen samenvatting, flashcards en quiz tabs.
 * @param {string} tab - 'notities', 'flashcards' of 'quiz'
 */
const wisselTab = (tab) => {
  ['notities', 'flashcards', 'quiz'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('actief', t === tab);
    document.getElementById(`inhoud-${t}`).classList.toggle('actief', t === tab);
  });
};

// ─── FLASHCARDS ───────────────────────────────────────────

/** Update de weergave van de huidige flashcard */
const updateFlashcard = () => {
  const fc = huidigeSessie.flashcards[fcIndex];
  if (!fc) return;

  const kaart = document.getElementById('fc-kaart');
  kaart.classList.toggle('omgedraaid', fcOmgedraaid);
  document.getElementById('fc-label').textContent = fcOmgedraaid ? 'Antwoord' : 'Vraag';
  document.getElementById('fc-tekst').textContent = fcOmgedraaid ? (fc.back || fc.achterkant) : (fc.front || fc.voorkant);
  document.getElementById('fc-hint').textContent = fcOmgedraaid ? 'klik om terug te draaien' : 'klik om te onthullen →';
  document.getElementById('fc-paginering').textContent = `${fcIndex + 1} / ${huidigeSessie.flashcards.length}`;
};

/** Draai de huidige flashcard om */
const fcOmdraaien = () => {
  fcOmgedraaid = !fcOmgedraaid;
  updateFlashcard();
};

/**
 * Navigeer naar de vorige of volgende flashcard.
 * @param {number} richting - -1 voor vorige, 1 voor volgende
 */
const fcNavigeer = (richting) => {
  fcIndex = (fcIndex + richting + huidigeSessie.flashcards.length) % huidigeSessie.flashcards.length;
  fcOmgedraaid = false;
  updateFlashcard();
};

// ─── QUIZ ─────────────────────────────────────────────────

/** Start of herstart de quiz */
const startQuiz = () => {
  quizIndex = 0;
  quizScore = 0;
  quizBeantwoord = false;
  quizKlaar = false;
  document.getElementById('score-kaart').style.display = 'none';
  document.getElementById('quiz-container').style.display = 'block';
  renderVraag();
};

/** Render de huidige quizvraag */
const renderVraag = () => {
  if (quizIndex >= huidigeSessie.quiz.length) {
    toonScore();
    return;
  }

  quizBeantwoord = false;
  const q = huidigeSessie.quiz[quizIndex];
  const voortgang = (quizIndex / huidigeSessie.quiz.length) * 100;
  const letters = ['A', 'B', 'C', 'D'];

  document.getElementById('quiz-container').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
      <span style="font-size:12px;color:var(--muted)">${quizIndex + 1}/${huidigeSessie.quiz.length}</span>
      <div class="quiz-voortgang-balk"><div class="quiz-voortgang-vulling" style="width:${voortgang}%"></div></div>
    </div>
    <div class="vraag-kaart">
      <div class="vraag-nummer">Vraag ${quizIndex + 1}</div>
      <div class="vraag-tekst">${escHtml(q.question || q.vraag)}</div>
    </div>
    <div class="opties-grid">
      ${(q.options || q.opties || []).map((opt, i) => `
        <button class="optie-knop" onclick="kiesAntwoord(${i})">
          <span class="optie-letter">${letters[i]}</span>
          ${escHtml(opt)}
        </button>`).join('')}
    </div>
    <div class="uitleg-kaart" id="uitleg-kaart">
      <strong style="color:var(--accent2)">💡 Uitleg:</strong> ${escHtml(q.explanation || q.uitleg || '')}
    </div>
    <button class="btn btn-primary" id="volgende-knop" onclick="volgendeVraag()" style="display:none;margin-top:16px">
      ${quizIndex + 1 < huidigeSessie.quiz.length ? 'Volgende vraag →' : 'Resultaat zien →'}
    </button>`;
};

/**
 * Verwerk een gekozen antwoord.
 * @param {number} index - Index van het gekozen antwoord
 */
const kiesAntwoord = (index) => {
  if (quizBeantwoord) return;
  quizBeantwoord = true;

  const q = huidigeSessie.quiz[quizIndex];
  const correct = q.correct;
  const knoppen = document.querySelectorAll('.optie-knop');

  knoppen.forEach((knop, i) => {
    knop.disabled = true;
    if (i === correct) knop.classList.add('goed');
    else if (i === index) knop.classList.add('fout');
  });

  if (index === correct) quizScore++;

  document.getElementById('uitleg-kaart').classList.add('zichtbaar');
  document.getElementById('volgende-knop').style.display = 'inline-flex';

  // Sla statistieken op als dit de laatste vraag is
  if (quizIndex + 1 >= huidigeSessie.quiz.length && huidigeSessie._id) {
    slaStatistiekenOp();
  }
};

/** Ga naar de volgende vraag */
const volgendeVraag = () => {
  quizIndex++;
  renderVraag();
};

/** Toon het eindresultaat van de quiz */
const toonScore = () => {
  document.getElementById('quiz-container').style.display = 'none';
  document.getElementById('score-kaart').style.display = 'block';
  document.getElementById('score-getal').textContent = `${quizScore}/${huidigeSessie.quiz.length}`;
};

/**
 * Sla quizstatistieken op in de database.
 * Stille fout: statistieken zijn niet kritiek.
 */
const slaStatistiekenOp = async () => {
  try {
    if (!huidigeSessie._id) return;
    await api(`/api/sessies/${huidigeSessie._id}/statistieken`, {
      method: 'PUT',
      body: JSON.stringify({ score: quizScore, totaal: huidigeSessie.quiz.length })
    });
  } catch (err) {
    console.warn('Statistieken opslaan mislukt (niet kritiek):', err.message);
  }
};

// ─── SESSIE OPSLAAN ───────────────────────────────────────

/**
 * Sla de huidige studeersessie op in de database.
 * Toont succes- of foutmelding na afloop.
 */
const sessieopslaan = async () => {
  const knop = document.getElementById('opslaan-knop');
  verbergMelding('opslaan-melding');

  knop.disabled = true;
  knop.innerHTML = '<span class="spinner"></span> Opslaan…';

  try {
    const data = await api('/api/sessies', {
      method: 'POST',
      body: JSON.stringify({
        bestandsnaam: huidigeSessie.bestandsnaam,
        titel: huidigeSessie.titel,
        samenvatting: huidigeSessie.samenvatting,
        flashcards: huidigeSessie.flashcards,
        quiz: huidigeSessie.quiz
      })
    });

    huidigeSessie._id = data.sessie._id;
    toonMelding('opslaan-melding', '✅ Sessie opgeslagen! Je kunt hem terugvinden in je dashboard.', 'succes');
    knop.textContent = '✅ Opgeslagen';
    knop.disabled = true;

  } catch (err) {
    console.error('Opslaan fout:', err.message);
    toonMelding('opslaan-melding', `Opslaan mislukt: ${err.message}`);
    knop.disabled = false;
    knop.textContent = '💾 Opslaan';
  }
};

// ─── HELPERS ─────────────────────────────────────────────

/**
 * Escape HTML speciale tekens om XSS te voorkomen.
 * @param {string} tekst - Te escapen tekst
 * @returns {string} - Veilige HTML string
 */
const escHtml = (tekst) => String(tekst || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

// ─── BESTAANDE SESSIE LADEN ───────────────────────────────

/**
 * Controleer of er een sessie-ID in de URL staat.
 * Als dat zo is, laad dan de bestaande sessie uit de database.
 */
const controleerUrlSessie = async () => {
  const params = new URLSearchParams(window.location.search);
  const sessieId = params.get('sessie');
  if (!sessieId) return;

  toonSectie('laden');
  updateLaadStap('Sessie ophalen…');

  try {
    const data = await api(`/api/sessies/${sessieId}`);
    const s = data.sessie;

    huidigeSessie = {
      _id: s._id,
      bestandsnaam: s.bestandsnaam,
      titel: s.titel,
      samenvatting: s.samenvatting,
      flashcards: s.flashcards.map(fc => ({ front: fc.voorkant, back: fc.achterkant })),
      quiz: s.quiz.map(q => ({
        question: q.vraag,
        options: q.opties,
        correct: q.correct,
        explanation: q.uitleg
      }))
    };

    // Verberg opslaan knop want sessie bestaat al
    document.getElementById('opslaan-knop').style.display = 'none';
    toonResultaten();

  } catch (err) {
    console.error('Sessie laden fout:', err.message);
    toonSectie('upload');
    toonMelding('upload-melding', `Kon sessie niet laden: ${err.message}`);
  }
};

// Initialiseer
controleerUrlSessie();
