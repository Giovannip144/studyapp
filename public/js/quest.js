/**
 * quest.js – StudyQuest spellogica
 *
 * Een volledig avonturenspel gebaseerd op studeersessies.
 * 5 levels met elk een eigen thema, levens, combo meter,
 * power-ups, eindbaas en leaderboard.
 */

vereisInlog();

// ─── LEVEL CONFIGURATIE ───────────────────────────────────

/**
 * Definitie van de 5 levels met thema, naam, emoji en tijdlimiet.
 * Elk level heeft een eigen visueel thema en moeilijkheidsgraad.
 */
const LEVELS = [
  { thema: 'woud',    naam: 'Het Betoverde Woud',    emoji: '🌲', tijd: 20, kleur: '#2ed573', baasBonus: 150 },
  { thema: 'kasteel', naam: 'Het Donkere Kasteel',   emoji: '🏰', tijd: 18, kleur: '#a29bfe', baasBonus: 200 },
  { thema: 'vulkaan', naam: 'De Brandende Vulkaan',  emoji: '🌋', tijd: 16, kleur: '#ff6b81', baasBonus: 250 },
  { thema: 'ruimte',  naam: 'De Diepe Ruimte',       emoji: '🚀', tijd: 14, kleur: '#686de0', baasBonus: 300 },
  { thema: 'baas',    naam: 'De Eindbaas',            emoji: '👹', tijd: 12, kleur: '#d946ef', baasBonus: 500 },
];

const VRAGEN_PER_LEVEL = 2; // Normale vragen per level
const RANK_NAMEN = ['', 'Beginner', 'Leerling', 'Avonturier', 'Ridder', 'Magiër', 'Held', 'Meester', 'Legende', 'Mythisch', 'Onsterfelijk'];
const XP_PER_RANK = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5800, 8000];

// ─── SPELSTATE ────────────────────────────────────────────

let staat = {
  sessieId: null,
  sessieNaam: '',
  vragen: [],          // Alle vragen geshuffled
  vraagIndex: 0,       // Huidige vraag index in de vragen array
  level: 0,            // Huidig level (0-4)
  levelVraagTeller: 0, // Vragen gedaan in huidig level
  levens: 3,
  score: 0,
  combo: 0,
  maxCombo: 0,
  munten: 0,
  heeftKans: false,    // Of de 2e kans power-up actief is
  tijdstopActief: false,
  tijdResterend: 20,
  timerInterval: null,
  beantwoord: false,
  spelActief: false,
  levelsGehaald: 0,
};

// ─── INITIALISATIE ────────────────────────────────────────

/**
 * Laad alle eigen sessies voor de keuzepagina.
 * Toont ook openbare sessies als de gebruiker er geen heeft.
 */
const laadSessies = async () => {
  try {
    const [eigenData, openbaarData] = await Promise.all([
      api('/api/sessies'),
      api('/api/sessies/openbaar')
    ]);

    let sessies = eigenData.sessies || [];
    const openbaar = (openbaarData.sessies || []).filter(s =>
      !sessies.find(e => e._id === s._id)
    );
    sessies = [...sessies, ...openbaar].filter(s => s.quiz?.length >= 5 || true);

    const grid = document.getElementById('sessie-keuze-grid');
    if (sessies.length === 0) {
      grid.innerHTML = `<div class="leeg"><div class="leeg-icon">📚</div><h3>Geen sessies</h3><p>Upload eerst een PDF om een Quest te spelen.</p><a href="/studeren" class="btn btn-primary" style="margin-top:16px">Ga naar Studeren</a></div>`;
      return;
    }

    grid.innerHTML = sessies.map(s => `
      <div class="sessie-keuze-kaart" onclick="startQuest('${s._id}', '${escHtml(s.titel || s.bestandsnaam)}')">
        <div class="sessie-keuze-naam">${escHtml(s.titel || s.bestandsnaam)}</div>
        <div class="sessie-keuze-info">
          <span>⚡ ${s.quiz?.length || 0} vragen</span>
          <span>🃏 ${s.flashcards?.length || 0} flashcards</span>
        </div>
        <button class="quest-start-knop">▶ START QUEST</button>
      </div>`).join('');

  } catch (err) {
    console.error('Sessies laden fout:', err.message);
    toonMelding('sessie-melding', err.message);
  }
};

/**
 * Start een nieuwe Quest voor een gekozen sessie.
 * Laadt de sessie, shufflet de vragen en begint level 1.
 * @param {string} id - Sessie ID
 * @param {string} naam - Sessienaam voor weergave
 */
const startQuest = async (id, naam) => {
  try {
    const data = await api(`/api/sessies/${id}`);
    const sessie = data.sessie;

    if (!sessie.quiz || sessie.quiz.length < 3) {
      toonMelding('sessie-melding', 'Deze sessie heeft te weinig vragen voor een Quest (minimaal 3 nodig).');
      return;
    }

    // Initialiseer spelstate
    staat.sessieId = id;
    staat.sessieNaam = naam;
    staat.vragen = shuffleArray([...sessie.quiz.map(q => ({
      vraag: q.vraag || q.question,
      opties: q.opties || q.options,
      correct: q.correct,
      uitleg: q.uitleg || q.explanation || ''
    }))]);
    staat.vraagIndex = 0;
    staat.level = 0;
    staat.levelVraagTeller = 0;
    staat.levens = 3;
    staat.score = 0;
    staat.combo = 0;
    staat.maxCombo = 0;
    staat.munten = 0;
    staat.heeftKans = false;
    staat.tijdstopActief = false;
    staat.beantwoord = false;
    staat.spelActief = true;
    staat.levelsGehaald = 0;

    // Genereer sterren voor ruimte thema
    maakSterren();

    // Verduister → toon spelscherm
    schakelOvergang(() => {
      document.getElementById('keuze-scherm').style.display = 'none';
      document.getElementById('spel-wrap').classList.add('actief');
      wisselThema(LEVELS[0].thema);
      maakDungeonStappen();
      updateHUD();
      toonVraag();
    });

  } catch (err) {
    console.error('Quest starten fout:', err.message);
    toonMelding('sessie-melding', 'Kon sessie niet laden: ' + err.message);
  }
};

// ─── VRAAG LOGICA ─────────────────────────────────────────

/**
 * Toon de huidige vraag op het scherm.
 * Bepaalt ook of het een eindbaas vraag is.
 */
const toonVraag = () => {
  if (!staat.spelActief) return;

  staat.beantwoord = false;
  staat.heeftKans = false;

  const vraagIdx = staat.vraagIndex % staat.vragen.length;
  const vraag = staat.vragen[vraagIdx];
  const level = LEVELS[staat.level];
  const isBaas = staat.levelVraagTeller === VRAGEN_PER_LEVEL; // Laatste vraag = eindbaas

  // Update vraagkaart
  document.getElementById('baas-indicator').style.display = isBaas ? 'flex' : 'none';
  document.getElementById('vraag-nummer').textContent = `VRAAG ${staat.levelVraagTeller + 1}`;
  document.getElementById('vraag-tekst').textContent = vraag.vraag;

  // Genereer opties
  const letters = ['A', 'B', 'C', 'D'];
  document.getElementById('opties-grid').innerHTML = vraag.opties.map((opt, i) => `
    <button class="optie-knop" id="opt-${i}" onclick="kiesAntwoord(${i})">
      <span class="optie-letter">${letters[i]}</span>
      ${escHtml(opt)}
    </button>`).join('');

  // Start timer
  startTimer(isBaas ? Math.max(level.tijd - 4, 8) : level.tijd);

  // Update dungeon voortgang
  const progress = (staat.levelVraagTeller / (VRAGEN_PER_LEVEL + 1)) * 100;
  document.getElementById('dungeon-vulling').style.width = `${progress}%`;
  document.getElementById('dungeon-label').textContent = `LEVEL ${staat.level + 1}`;
};

/**
 * Verwerk een gekozen antwoord.
 * Berekent punten, combo en lives.
 * @param {number} index - Index van het gekozen antwoord (0-3)
 */
const kiesAntwoord = (index) => {
  if (staat.beantwoord) return;
  staat.beantwoord = true;
  stopTimer();

  const vraagIdx = staat.vraagIndex % staat.vragen.length;
  const vraag = staat.vragen[vraagIdx];
  const isBaas = staat.levelVraagTeller === VRAGEN_PER_LEVEL;
  const level = LEVELS[staat.level];
  const isGoed = index === vraag.correct;

  // Markeer knoppen
  const knoppen = document.querySelectorAll('.optie-knop');
  knoppen.forEach((k, i) => {
    k.disabled = true;
    if (i === vraag.correct) k.classList.add('goed');
    else if (i === index && !isGoed) k.classList.add('fout');
  });

  if (isGoed) {
    // Bereken punten
    staat.combo++;
    if (staat.combo > staat.maxCombo) staat.maxCombo = staat.combo;
    const comboMultiplier = Math.min(staat.combo, 5);
    const tijdBonus = Math.floor(staat.tijdResterend * 5);
    const basisPunten = isBaas ? level.baasBonus : 100;
    const totaalPunten = Math.floor(basisPunten * comboMultiplier + tijdBonus);

    staat.score += totaalPunten;
    staat.munten += isBaas ? 15 : 8;

    // Toon zwevende score
    toonScoreFloat(`+${totaalPunten}`, '#f5c842');

    // Feedback
    toonFeedback(true, isBaas, totaalPunten, staat.combo, vraag.uitleg);

  } else {
    // 2e kans power-up?
    if (staat.heeftKans) {
      staat.heeftKans = false;
      // Herstel de foute optie en laat speler opnieuw kiezen
      knoppen[index].classList.remove('fout');
      knoppen[index].disabled = true;
      knoppen[index].classList.add('verborgen');
      staat.beantwoord = false;
      toonScoreFloat('2e kans!', '#2ed573');
      startTimer(8);
      return;
    }

    staat.combo = 0;
    staat.levens--;
    toonScoreFloat('FOUT!', '#ff4757');
    toonFeedback(false, isBaas, 0, 0, vraag.uitleg);
    updateHartjes();

    if (staat.levens <= 0) {
      setTimeout(() => gameOver(), 1800);
      return;
    }
  }

  updateHUD();

  // Na 2 seconden: volgende vraag of level voltooid
  setTimeout(() => {
    verbergFeedback();
    staat.vraagIndex++;
    staat.levelVraagTeller++;

    if (staat.levelVraagTeller > VRAGEN_PER_LEVEL) {
      // Level voltooid (VRAGEN_PER_LEVEL normale + 1 eindbaas)
      levelVoltooid();
    } else {
      toonVraag();
    }
  }, 1800);
};

// ─── TIMER ────────────────────────────────────────────────

/**
 * Start de afteltimer voor de huidige vraag.
 * Bij verlopen = automatisch fout antwoord.
 * @param {number} seconden - Tijdlimiet in seconden
 */
const startTimer = (seconden) => {
  stopTimer();
  if (staat.tijdstopActief) return;

  staat.tijdResterend = seconden;
  const vulling = document.getElementById('timer-vulling');

  staat.timerInterval = setInterval(() => {
    staat.tijdResterend -= 0.1;
    const pct = Math.max(0, (staat.tijdResterend / seconden) * 100);
    vulling.style.width = `${pct}%`;

    // Kleur op basis van resterende tijd
    vulling.className = 'timer-vulling';
    if (pct < 25) vulling.classList.add('rood');
    else if (pct < 50) vulling.classList.add('oranje');

    if (staat.tijdResterend <= 0) {
      stopTimer();
      // Tijd op = automatisch fout
      if (!staat.beantwoord) {
        const vraagIdx = staat.vraagIndex % staat.vragen.length;
        kiesAntwoord(-1); // -1 = geen goed antwoord
      }
    }
  }, 100);
};

/** Stop de huidige timer */
const stopTimer = () => {
  if (staat.timerInterval) {
    clearInterval(staat.timerInterval);
    staat.timerInterval = null;
  }
};

// ─── POWER-UPS ────────────────────────────────────────────

/** 50/50: verberg twee foute opties */
const powerup5050 = () => {
  if (staat.munten < 15 || staat.beantwoord) return;
  staat.munten -= 15;
  updateHUD();

  const vraagIdx = staat.vraagIndex % staat.vragen.length;
  const correct = staat.vragen[vraagIdx].correct;
  const fout = [0, 1, 2, 3].filter(i => i !== correct);
  // Verberg 2 willekeurige foute opties
  shuffleArray(fout).slice(0, 2).forEach(i => {
    const k = document.getElementById(`opt-${i}`);
    if (k) k.classList.add('verborgen');
  });

  document.getElementById('pu-5050').disabled = true;
  toonScoreFloat('50/50!', '#ffa502');
};

/** Tijdstop: bevriest de timer voor 8 seconden */
const powerupTijdstop = () => {
  if (staat.munten < 20 || staat.beantwoord || staat.tijdstopActief) return;
  staat.munten -= 20;
  staat.tijdstopActief = true;
  updateHUD();

  stopTimer();
  document.getElementById('tijdstop-overlay').classList.add('actief');
  document.getElementById('pu-tijdstop').disabled = true;
  toonScoreFloat('⏱ TIJDSTOP!', '#4fc3f7');

  setTimeout(() => {
    staat.tijdstopActief = false;
    document.getElementById('tijdstop-overlay').classList.remove('actief');
    if (!staat.beantwoord) startTimer(staat.tijdResterend);
  }, 8000);
};

/** Tweede kans: als je fout antwoordt, mag je opnieuw */
const powerupKans = () => {
  if (staat.munten < 25 || staat.beantwoord || staat.heeftKans) return;
  staat.munten -= 25;
  staat.heeftKans = true;
  updateHUD();
  document.getElementById('pu-kans').disabled = true;
  toonScoreFloat('🍀 2e kans actief!', '#2ed573');
};

// ─── LEVEL VOORTGANG ──────────────────────────────────────

/**
 * Toon het level voltooid scherm met bonus en ga daarna verder.
 */
const levelVoltooid = () => {
  stopTimer();
  staat.levelsGehaald++;

  const level = LEVELS[staat.level];
  const bonus = level.baasBonus;

  document.getElementById('lv-titel').textContent = `${level.emoji} LEVEL ${staat.level + 1} VOLTOOID!`;
  document.getElementById('lv-emoji').textContent = staat.level === 4 ? '🏆' : level.emoji;
  document.getElementById('lv-score').textContent = `+${bonus} LEVEL BONUS`;
  document.getElementById('lv-sub').textContent =
    staat.level < 4 ? `Volgende: ${LEVELS[staat.level + 1].naam}` : 'Je hebt alle levels verslagen!';

  staat.score += bonus;
  confetti();
  document.getElementById('level-voltooid').classList.add('toon');
};

/**
 * Ga naar het volgende level of eindscherm als alle levels voltooid zijn.
 */
const volgendLevel = () => {
  document.getElementById('level-voltooid').classList.remove('toon');
  staat.level++;

  if (staat.level >= LEVELS.length) {
    // Alle levels voltooid
    toonEindscherm();
    return;
  }

  staat.levelVraagTeller = 0;
  schakelOvergang(() => {
    wisselThema(LEVELS[staat.level].thema);
    updateHUD();
    toonVraag();
  });
};

// ─── GAME OVER ────────────────────────────────────────────

/** Toon het game over scherm */
const gameOver = () => {
  staat.spelActief = false;
  stopTimer();
  document.getElementById('go-score').textContent = `Score: ${staat.score.toLocaleString()} PTS`;
  document.getElementById('game-over').classList.add('toon');
  slaScoreOp();
};

/** Herstart de quest met dezelfde sessie */
const herstart = () => {
  document.getElementById('game-over').classList.remove('toon');
  document.getElementById('eindscherm').classList.remove('toon');
  startQuest(staat.sessieId, staat.sessieNaam);
};

/** Ga terug naar de sessiekeuzepagina */
const naarKeuze = () => {
  document.getElementById('game-over').classList.remove('toon');
  document.getElementById('eindscherm').classList.remove('toon');
  stopTimer();
  staat.spelActief = false;
  schakelOvergang(() => {
    document.getElementById('spel-wrap').classList.remove('actief');
    document.getElementById('keuze-scherm').style.display = 'block';
  });
};

// ─── EINDSCHERM ───────────────────────────────────────────

/**
 * Toon het eindscherm met score, rank, XP en leaderboard.
 */
const toonEindscherm = async () => {
  staat.spelActief = false;
  stopTimer();

  document.getElementById('eind-score').textContent = staat.score.toLocaleString();
  document.getElementById('eind-levels').textContent = `${staat.levelsGehaald}/5`;
  document.getElementById('eind-combo').textContent = `×${staat.maxCombo}`;
  document.getElementById('eindscherm').classList.add('toon');

  confetti();

  try {
    // Sla score op en haal XP info op
    const scoreData = await slaScoreOp();
    if (scoreData) {
      const { verdiendXP, totaalXP, rankInfo } = scoreData;
      const rankNaam = RANK_NAMEN[rankInfo.rank] || 'Legende';

      document.getElementById('eind-xp').textContent = `+${verdiendXP} XP`;
      document.getElementById('eind-rank').textContent = `RANK ${rankInfo.rank} — ${rankNaam.toUpperCase()}`;
      document.getElementById('xp-rank-label').textContent = `Rank ${rankInfo.rank}`;
      document.getElementById('xp-progress-label').textContent = `${rankInfo.huidigXP} / ${rankInfo.volgendXP} XP`;

      // Animeer XP balk
      setTimeout(() => {
        const pct = Math.min((rankInfo.huidigXP / rankInfo.volgendXP) * 100, 100);
        document.getElementById('xp-vulling').style.width = `${pct}%`;
      }, 100);
    }

    // Laad leaderboard
    const lbData = await api(`/api/scores/leaderboard/${staat.sessieId}`);
    renderLeaderboard(lbData.scores || []);

  } catch (err) {
    console.error('Eindscherm data fout:', err.message);
  }
};

/**
 * Render het leaderboard in het eindscherm.
 * @param {Array} scores - Array van scoreobjecten
 */
const renderLeaderboard = (scores) => {
  const ikzelf = getGebruiker();
  const container = document.getElementById('lb-container');

  if (scores.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:13px;padding:16px">Nog geen scores voor deze sessie.</div>`;
    return;
  }

  const posKlassen = ['goud', 'zilver', 'brons'];
  container.innerHTML = scores.map((s, i) => {
    const isEigen = s.gebruiker?._id === ikzelf?.id;
    const g = s.gebruiker || {};
    return `
      <div class="lb-rij ${isEigen ? 'eigen' : ''}">
        <span class="lb-positie ${posKlassen[i] || ''}">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
        <div style="flex:1;text-align:left">
          <div class="lb-naam">${escHtml(g.naam || 'Onbekend')} ${isEigen ? '← jij' : ''}</div>
          <div class="lb-school">${escHtml(g.school || '')} · ${escHtml(g.opleiding || '')}</div>
        </div>
        <span class="lb-score">${s.score.toLocaleString()}</span>
      </div>`;
  }).join('');
};

/**
 * Sla de huidige score op via de API.
 * @returns {Promise<object|null>} - Score response data of null bij fout
 */
const slaScoreOp = async () => {
  try {
    const data = await api('/api/scores', {
      method: 'POST',
      body: JSON.stringify({
        sessieId: staat.sessieId,
        score: staat.score,
        levelsGehaald: staat.levelsGehaald,
        maxCombo: staat.maxCombo
      })
    });
    return data;
  } catch (err) {
    console.error('Score opslaan fout:', err.message);
    return null;
  }
};

// ─── VISUELE EFFECTEN ─────────────────────────────────────

/**
 * Toon een feedback popup (goed/fout) met uitleg.
 */
const toonFeedback = (goed, isBaas, punten, combo, uitleg) => {
  const popup = document.getElementById('feedback-popup');
  document.getElementById('feedback-emoji').textContent = goed
    ? (isBaas ? '🏆' : combo >= 3 ? '🔥' : '✅')
    : '❌';
  document.getElementById('feedback-titel').textContent = goed
    ? (combo >= 5 ? `COMBO ×${combo}!!!` : combo >= 3 ? `COMBO ×${combo}!` : 'CORRECT!')
    : 'FOUT!';
  document.getElementById('feedback-punten').textContent = goed ? `+${punten} PTS` : 'Geen punten';
  document.getElementById('feedback-uitleg').textContent = uitleg || '';

  popup.style.borderColor = goed ? '#2ed573' : '#ff4757';
  popup.classList.remove('verberg');
  popup.classList.add('toon');
};

/** Verberg de feedback popup */
const verbergFeedback = () => {
  const popup = document.getElementById('feedback-popup');
  popup.classList.remove('toon');
  popup.classList.add('verberg');
  setTimeout(() => popup.classList.remove('verberg'), 300);
};

/**
 * Toon een zwevend punten getal op de schermlocatie.
 * @param {string} tekst - Te tonen tekst
 * @param {string} kleur - CSS kleur
 */
const toonScoreFloat = (tekst, kleur) => {
  const el = document.createElement('div');
  el.className = 'score-float';
  el.textContent = tekst;
  el.style.color = kleur;
  el.style.left = `${40 + Math.random() * 30}%`;
  el.style.top = `${30 + Math.random() * 20}%`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
};

/**
 * Gooi confetti over het scherm.
 * Wordt gebruikt bij level voltooid en eindscherm.
 */
const confetti = () => {
  const kleuren = ['#f5c842', '#2ed573', '#ff4757', '#a855f7', '#4fc3f7', '#ff6b35'];
  for (let i = 0; i < 80; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-stuk';
    el.style.setProperty('--d', `${1.5 + Math.random() * 2}s`);
    el.style.setProperty('--del', `${Math.random() * 0.8}s`);
    el.style.left = `${Math.random() * 100}vw`;
    el.style.top = '-10px';
    el.style.background = kleuren[Math.floor(Math.random() * kleuren.length)];
    el.style.transform = `rotate(${Math.random() * 360}deg)`;
    el.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
};

/**
 * Schermovergang effect (verduisteren en verlichten).
 * @param {Function} tussenIn - Functie die wordt uitgevoerd tijdens verduistering
 */
const schakelOvergang = (tussenIn) => {
  const el = document.getElementById('scherm-overgang');
  el.classList.add('verduister');
  setTimeout(() => {
    tussenIn();
    el.classList.remove('verduister');
    el.classList.add('verlicht');
    setTimeout(() => el.classList.remove('verlicht'), 400);
  }, 400);
};

/**
 * Wissel het visuele thema van het spelscherm.
 * @param {string} thema - Naam van het thema
 */
const wisselThema = (thema) => {
  const wrap = document.getElementById('spel-wrap');
  wrap.className = `spel-wrap actief thema-${thema}`;

  const level = LEVELS.find(l => l.thema === thema);
  document.getElementById('level-thema-naam').textContent = thema.toUpperCase();
  document.getElementById('level-naam').textContent = level?.naam || '';
};

/**
 * Maak de dungeon voortgangsstappen onderaan de balk.
 */
const maakDungeonStappen = () => {
  const container = document.getElementById('dungeon-stappen');
  container.innerHTML = LEVELS.map((l, i) => `
    <div class="dungeon-stap ${i === 0 ? 'huidig' : ''}" id="stap-${i}" title="${l.naam}">
      ${l.emoji}
    </div>`).join('');
};

/**
 * Update de hartjes weergave op basis van resterende levens.
 */
const updateHartjes = () => {
  for (let i = 1; i <= 3; i++) {
    const hart = document.getElementById(`hart-${i}`);
    if (i > staat.levens) {
      hart.classList.add('leeg');
      hart.classList.add('verloren');
    }
  }
};

/**
 * Update alle HUD elementen (score, combo, munten, power-up knoppen).
 */
const updateHUD = () => {
  document.getElementById('hud-score').textContent = `${staat.score.toLocaleString()} PTS`;

  const comboEl = document.getElementById('hud-combo');
  comboEl.textContent = staat.combo >= 2 ? `🔥 COMBO ×${staat.combo}` : 'COMBO ×1';
  comboEl.classList.toggle('actief', staat.combo >= 2);

  document.getElementById('hud-munten').textContent = staat.munten;

  // Update dungeon stappen
  LEVELS.forEach((_, i) => {
    const stap = document.getElementById(`stap-${i}`);
    if (!stap) return;
    stap.className = 'dungeon-stap';
    if (i < staat.level) stap.classList.add('gedaan');
    else if (i === staat.level) stap.classList.add('huidig');
  });

  // Power-up knoppen
  document.getElementById('pu-5050').disabled = staat.munten < 15 || staat.beantwoord;
  document.getElementById('pu-tijdstop').disabled = staat.munten < 20 || staat.beantwoord || staat.tijdstopActief;
  document.getElementById('pu-kans').disabled = staat.munten < 25 || staat.beantwoord || staat.heeftKans;
};

/**
 * Genereer sterren voor het ruimte thema achtergrond.
 */
const maakSterren = () => {
  const container = document.getElementById('sterren');
  container.innerHTML = Array.from({ length: 100 }, () => {
    const ster = document.createElement('div');
    ster.className = 'ster';
    ster.style.left = `${Math.random() * 100}%`;
    ster.style.top = `${Math.random() * 100}%`;
    ster.style.setProperty('--d', `${1 + Math.random() * 3}s`);
    ster.style.opacity = Math.random();
    return ster.outerHTML;
  }).join('');
};

// ─── HELPERS ─────────────────────────────────────────────

/**
 * Schudde een array willekeurig door elkaar (Fisher-Yates).
 * @param {Array} arr - Te schudden array
 * @returns {Array} - Nieuwe geshuffelde array
 */
const shuffleArray = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Escape HTML speciale tekens om XSS te voorkomen.
 * @param {string} tekst
 * @returns {string}
 */
const escHtml = (tekst) => String(tekst || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

// ─── START ────────────────────────────────────────────────

laadSessies();