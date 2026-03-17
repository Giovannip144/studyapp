const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Lees de blokkadepagina HTML eenmalig in bij opstarten
const BLOKKADE_HTML_PAD = path.join(__dirname, '..', 'public', 'geblokkeerd.html');
let blokkadeHTML = '';
try {
  blokkadeHTML = fs.readFileSync(BLOKKADE_HTML_PAD, 'utf8');
} catch (e) {
  blokkadeHTML = `<!DOCTYPE html><html><body style="background:#0e0f14;color:#ff4757;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h1>🛡️ Toegang geblokkeerd</h1></body></html>`;
}

/**
 * bewaker.js – Automatische beveiligingsbewaker
 *
 * Bewaakt alle inkomende requests en beschermt tegen:
 * - Brute force aanvallen (te veel mislukte logins)
 * - DDoS aanvallen (te veel requests per seconde)
 * - Verdachte patronen (snelle opeenvolgende requests)
 *
 * Werking:
 * 1. Elke request wordt gecontroleerd tegen de blokkadelijst
 * 2. Request frequentie wordt bijgehouden per IP
 * 3. Bij overschrijding van drempelwaarden → automatische blokkade
 * 4. Blokkades worden opgeslagen in logs/geblokkeerd.json
 * 5. Elke blokkade wordt gelogd met reden en tijdstip
 */

// ─── CONFIGURATIE ─────────────────────────────────────────

const CONFIG = {
  // Rate limiting — algemeen
  MAX_REQUESTS_PER_MINUUT: 120,        // Max requests per minuut per IP
  MAX_REQUESTS_PER_SECONDE: 20,        // Max requests per seconde (DDoS detectie)

  // Brute force beveiliging — login
  MAX_MISLUKTE_LOGINS: 5,              // Max mislukte logins voor blokkade
  LOGIN_WINDOW_MS: 10 * 60 * 1000,    // Tijdvenster: 10 minuten

  // Blokkade duur
  BLOKKADE_DUUR_BRUTE: 30 * 60 * 1000,   // 30 minuten bij brute force
  BLOKKADE_DUUR_DDOS: 60 * 60 * 1000,    // 1 uur bij DDoS
  BLOKKADE_DUUR_VERDACHT: 15 * 60 * 1000, // 15 minuten bij verdacht gedrag

  // Whitelist — deze IPs worden nooit geblokkeerd
  WHITELIST: [],
};

// ─── OPSLAG ───────────────────────────────────────────────

const LOG_MAP = path.join(__dirname, '..', 'logs');
const BLOKKADE_BESTAND = path.join(LOG_MAP, 'geblokkeerd.json');

if (!fs.existsSync(LOG_MAP)) fs.mkdirSync(LOG_MAP, { recursive: true });

/**
 * In-memory opslag voor request tracking.
 * Wordt elke minuut opgeschoond om geheugen te besparen.
 *
 * Structuur:
 * requestTeller: { ip: { teller, eersteRequest, secondeTeller, secondeStart } }
 * misluktLogins: { ip: { pogingen: [], }  }
 * geblokkeerdeIPs: { ip: { reden, tot, geblokkerdOp } }
 */
const requestTeller = new Map();
const misluktLogins = new Map();
let geblokkeerdeIPs = new Map();

// ─── PERSISTENTE BLOKKADE OPSLAG ─────────────────────────

/**
 * Laad eerder opgeslagen blokkades bij opstarten.
 * Zodat geblokkeerde IPs ook na een herstart geblokkeerd blijven.
 */
const laadBlokkades = () => {
  try {
    if (fs.existsSync(BLOKKADE_BESTAND)) {
      const data = JSON.parse(fs.readFileSync(BLOKKADE_BESTAND, 'utf8'));
      const nu = Date.now();
      let geladen = 0;

      Object.entries(data).forEach(([ip, info]) => {
        // Laad alleen nog actieve blokkades
        if (info.tot > nu) {
          geblokkeerdeIPs.set(ip, info);
          geladen++;
        }
      });

      if (geladen > 0) {
        logger.info('BEWAKER', `${geladen} actieve blokkade(s) geladen uit bestand`);
      }
    }
  } catch (err) {
    logger.warn('BEWAKER', 'Kon blokkades niet laden', { fout: err.message });
  }
};

/**
 * Sla de huidige blokkadelijst op in het JSON bestand.
 * Wordt aangeroepen na elke nieuwe blokkade.
 */
const slaBlokkadesOp = () => {
  try {
    const data = {};
    geblokkeerdeIPs.forEach((info, ip) => { data[ip] = info; });
    fs.writeFileSync(BLOKKADE_BESTAND, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    logger.warn('BEWAKER', 'Kon blokkades niet opslaan', { fout: err.message });
  }
};

// ─── BLOKKADE BEHEER ──────────────────────────────────────

/**
 * Blokkeer een IP-adres voor een opgegeven duur.
 * @param {string} ip     - Te blokkeren IP-adres
 * @param {string} reden  - Reden voor de blokkade
 * @param {number} duurMs - Blokkadeduur in milliseconden
 */
const blokkeerIP = (ip, reden, duurMs) => {
  const tot = Date.now() + duurMs;
  const minuten = Math.round(duurMs / 60000);

  geblokkeerdeIPs.set(ip, {
    reden,
    tot,
    geblokkerdOp: new Date().toISOString(),
    duurMinuten: minuten
  });

  slaBlokkadesOp();
  logger.warn('BEWAKER', `🚫 IP geblokkeerd voor ${minuten} minuten`, { ip, reden });
};

/**
 * Controleer of een IP geblokkeerd is.
 * Verwijdert automatisch verlopen blokkades.
 * @param {string} ip - Te controleren IP-adres
 * @returns {{ geblokkeerd: boolean, info?: object }}
 */
const isGeblokkeerd = (ip) => {
  const info = geblokkeerdeIPs.get(ip);
  if (!info) return { geblokkeerd: false };

  if (Date.now() > info.tot) {
    // Blokkade verlopen — verwijderen
    geblokkeerdeIPs.delete(ip);
    slaBlokkadesOp();
    logger.info('BEWAKER', 'Blokkade verlopen en opgeheven', { ip });
    return { geblokkeerd: false };
  }

  return { geblokkeerd: true, info };
};

/**
 * Hef een blokkade handmatig op (via admin endpoint).
 * @param {string} ip - IP-adres om te deblokkeren
 * @returns {boolean} - True als er een blokkade was om op te heffen
 */
const deblokkeerIP = (ip) => {
  const had = geblokkeerdeIPs.has(ip);
  geblokkeerdeIPs.delete(ip);
  if (had) {
    slaBlokkadesOp();
    logger.info('BEWAKER', 'Blokkade handmatig opgeheven', { ip });
  }
  return had;
};

// ─── RATE LIMITING ────────────────────────────────────────

/**
 * Controleer of een IP de request limieten overschrijdt.
 * @param {string} ip - Te controleren IP-adres
 * @returns {{ geblokkeerd: boolean, reden?: string }}
 */
const controleerRateLimit = (ip) => {
  const nu = Date.now();

  if (!requestTeller.has(ip)) {
    requestTeller.set(ip, {
      minuutTeller: 0,
      minuutStart: nu,
      secondeTeller: 0,
      secondeStart: nu
    });
  }

  const data = requestTeller.get(ip);

  // Reset minuutteller na 1 minuut
  if (nu - data.minuutStart > 60000) {
    data.minuutTeller = 0;
    data.minuutStart = nu;
  }

  // Reset secondeteller na 1 seconde
  if (nu - data.secondeStart > 1000) {
    data.secondeTeller = 0;
    data.secondeStart = nu;
  }

  data.minuutTeller++;
  data.secondeTeller++;

  // DDoS detectie — te veel requests per seconde
  if (data.secondeTeller > CONFIG.MAX_REQUESTS_PER_SECONDE) {
    return { overschreden: true, reden: `DDoS vermoeden: ${data.secondeTeller} requests/seconde` };
  }

  // Algemene rate limit — te veel requests per minuut
  if (data.minuutTeller > CONFIG.MAX_REQUESTS_PER_MINUUT) {
    return { overschreden: true, reden: `Rate limit: ${data.minuutTeller} requests/minuut` };
  }

  return { overschreden: false };
};

// ─── MISLUKTE LOGIN TRACKING ──────────────────────────────

/**
 * Registreer een mislukte loginpoging voor een IP.
 * Bij te veel pogingen wordt het IP automatisch geblokkeerd.
 * @param {string} ip    - IP-adres van de poging
 * @param {string} email - Ingevoerd emailadres (voor logging)
 */
const registreerMislukteLogin = (ip, email) => {
  const nu = Date.now();

  if (!misluktLogins.has(ip)) {
    misluktLogins.set(ip, { pogingen: [] });
  }

  const data = misluktLogins.get(ip);

  // Verwijder pogingen buiten het tijdvenster
  data.pogingen = data.pogingen.filter(t => nu - t < CONFIG.LOGIN_WINDOW_MS);
  data.pogingen.push(nu);

  const aantalPogingen = data.pogingen.length;

  logger.warn('BEWAKER', `Mislukte login poging ${aantalPogingen}/${CONFIG.MAX_MISLUKTE_LOGINS}`, { ip, email });

  // Blokkeer bij te veel pogingen
  if (aantalPogingen >= CONFIG.MAX_MISLUKTE_LOGINS) {
    blokkeerIP(ip, `Brute force: ${aantalPogingen} mislukte logins in ${CONFIG.LOGIN_WINDOW_MS / 60000} minuten`, CONFIG.BLOKKADE_DUUR_BRUTE);
    misluktLogins.delete(ip);
  }
};

/**
 * Reset de mislukte loginpogingen voor een IP na een succesvolle login.
 * @param {string} ip - IP-adres om te resetten
 */
const resetMisluktLogins = (ip) => {
  misluktLogins.delete(ip);
};

// ─── EXPRESS MIDDLEWARE ───────────────────────────────────

/**
 * Hoofd beveiligingsmiddleware.
 * Voeg toe aan Express VOOR alle routes: app.use(bewaker.middleware)
 *
 * Controleert per request:
 * 1. Is het IP op de whitelist? → altijd doorlaten
 * 2. Is het IP geblokkeerd? → 403 teruggeven
 * 3. Overschrijdt het IP de rate limiet? → blokkeren + 429 teruggeven
 */
const middleware = (req, res, next) => {
  const ip = (req.ip || req.connection.remoteAddress || '').replace('::ffff:', '');

  // Whitelist — altijd doorlaten
  if (CONFIG.WHITELIST.includes(ip)) return next();

  // Statische bestanden altijd doorlaten
  if (req.path.startsWith('/css') || req.path.startsWith('/js') || req.path === '/geblokkeerd') {
    return next();
  }

  const isAPI = req.path.startsWith('/api/');
  const isBrowser = !isAPI && (req.headers.accept?.includes('text/html') || req.headers.accept?.includes('*/*'));

  /**
   * Stuur de blokkadepagina direct terug als HTML.
   * Injecteert de blokkadeinfo direct in de HTML zodat de timer werkt.
   */
  const stuurBlokkadePagina = (restMin, tot, reden) => {
    // Inject blokkade data in de HTML via script tag
    const script = `<script>
      window.__BLOKKADE__ = {
        tot: ${tot},
        reden: ${JSON.stringify(reden)},
        min: ${restMin}
      };
    </script>`;
    const html = blokkadeHTML.replace('</head>', `${script}</head>`);
    res.status(403).set('Content-Type', 'text/html').send(html);
  };

  // Check blokkadelijst
  const { geblokkeerd, info } = isGeblokkeerd(ip);
  if (geblokkeerd) {
    const restMs = info.tot - Date.now();
    const restMin = Math.ceil(restMs / 60000);

    logger.warn('BEWAKER', 'Geblokkeerd IP probeert toegang', { ip, reden: info.reden, nogMinuten: restMin });

    if (isBrowser) return stuurBlokkadePagina(restMin, info.tot, info.reden);

    return res.status(403).json({
      succes: false,
      fout: `Toegang geweigerd. Probeer het over ${restMin} minuten opnieuw.`,
      geblokkerdTot: new Date(info.tot).toISOString()
    });
  }

  // Rate limiting check
  const { overschreden, reden } = controleerRateLimit(ip);
  if (overschreden) {
    const duur = reden.includes('DDoS') ? CONFIG.BLOKKADE_DUUR_DDOS : CONFIG.BLOKKADE_DUUR_VERDACHT;
    blokkeerIP(ip, reden, duur);
    const tot = Date.now() + duur;
    const restMin = Math.ceil(duur / 60000);

    if (isBrowser) return stuurBlokkadePagina(restMin, tot, reden);

    return res.status(429).json({
      succes: false,
      fout: 'Te veel verzoeken. Je bent tijdelijk geblokkeerd.'
    });
  }

  next();
};

// ─── OPSCHONEN ────────────────────────────────────────────

/**
 * Schoon verlopen data op uit het geheugen.
 * Draait elke 5 minuten automatisch.
 */
setInterval(() => {
  const nu = Date.now();
  let opgeschoond = 0;

  // Verwijder verlopen request tellers
  requestTeller.forEach((data, ip) => {
    if (nu - data.minuutStart > 120000) {
      requestTeller.delete(ip);
      opgeschoond++;
    }
  });

  // Verwijder verlopen login pogingen
  misluktLogins.forEach((data, ip) => {
    data.pogingen = data.pogingen.filter(t => nu - t < CONFIG.LOGIN_WINDOW_MS);
    if (data.pogingen.length === 0) misluktLogins.delete(ip);
  });

  // Verwijder verlopen blokkades
  geblokkeerdeIPs.forEach((info, ip) => {
    if (nu > info.tot) {
      geblokkeerdeIPs.delete(ip);
      logger.info('BEWAKER', 'Blokkade automatisch opgeheven', { ip });
    }
  });

  if (opgeschoond > 0) {
    logger.debug('BEWAKER', `Geheugen opgeschoond: ${opgeschoond} verlopen records verwijderd`);
  }
}, 5 * 60 * 1000);

// Laad bestaande blokkades bij opstarten
laadBlokkades();

module.exports = {
  middleware,
  registreerMislukteLogin,
  resetMisluktLogins,
  blokkeerIP,
  deblokkeerIP,
  isGeblokkeerd,
  geblokkeerdeIPs,
  CONFIG
};