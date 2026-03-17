const fs = require('fs');
const path = require('path');

/**
 * logger.js – Centraal logbestand systeem
 *
 * Schrijft alle activiteiten naar:
 * - De console (voor directe monitoring)
 * - logs/app.log (voor persistente opslag, max 10MB, daarna geroteerd)
 * - logs/error.log (alleen fouten, apart bijgehouden)
 *
 * Logformaat per regel:
 * [2026-03-16 14:32:01] [NIVEAU] [CATEGORIE] Bericht | extra data
 *
 * Categorieën:
 * AUTH     – inloggen, registreren, 2FA, uitloggen
 * SESSIE   – aanmaken, opslaan, verwijderen, delen
 * STUDEREN – PDF analyse
 * QUEST    – scores, leaderboard
 * REACTIE  – plaatsen, verwijderen
 * SERVER   – opstarten, stoppen, verbindingen
 * FOUT     – alle fouten
 * HTTP     – inkomende requests (optioneel via middleware)
 */

// ─── CONFIGURATIE ─────────────────────────────────────────

const LOG_MAP = path.join(__dirname, '..', 'logs');
const APP_LOG = path.join(LOG_MAP, 'app.log');
const ERROR_LOG = path.join(LOG_MAP, 'error.log');
const MAX_GROOTTE = 10 * 1024 * 1024; // 10MB

// Zorg dat de logs map bestaat
if (!fs.existsSync(LOG_MAP)) {
  fs.mkdirSync(LOG_MAP, { recursive: true });
}

// ─── NIVEAUS ──────────────────────────────────────────────

const NIVEAUS = {
  INFO:  { label: 'INFO ', kleur: '\x1b[36m' },  // Cyaan
  WARN:  { label: 'WARN ', kleur: '\x1b[33m' },  // Geel
  ERROR: { label: 'ERROR', kleur: '\x1b[31m' },  // Rood
  DEBUG: { label: 'DEBUG', kleur: '\x1b[35m' },  // Magenta
};

const RESET = '\x1b[0m';
const DIM   = '\x1b[2m';
const BOLD  = '\x1b[1m';

// ─── HULPFUNCTIES ─────────────────────────────────────────

/**
 * Formatteer de huidige datum/tijd als leesbare string.
 * @returns {string} – bijv. "2026-03-16 14:32:01"
 */
const tijdstempel = () => {
  const nu = new Date();
  return nu.toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
};

/**
 * Roteer het logbestand als het te groot wordt.
 * Het oude bestand krijgt een tijdstempel in de naam.
 * @param {string} bestand – pad naar het logbestand
 */
const roteerAls = (bestand) => {
  try {
    if (!fs.existsSync(bestand)) return;
    const stat = fs.statSync(bestand);
    if (stat.size >= MAX_GROOTTE) {
      const tijdstamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      const archief = bestand.replace('.log', `_${tijdstamp}.log`);
      fs.renameSync(bestand, archief);
      schrijfRegel(bestand, 'INFO', 'SERVER', `Logbestand geroteerd naar ${path.basename(archief)}`);
    }
  } catch (err) {
    console.error('Log rotatie fout:', err.message);
  }
};

/**
 * Schrijf een enkele logregel naar een bestand.
 * @param {string} bestand – pad naar het logbestand
 * @param {string} niveau  – INFO / WARN / ERROR / DEBUG
 * @param {string} categorie – AUTH / SESSIE / etc.
 * @param {string} bericht – de logboodschap
 * @param {object} [extra] – optionele extra data als JSON
 */
const schrijfRegel = (bestand, niveau, categorie, bericht, extra) => {
  try {
    roteerAls(bestand);
    const extraTekst = extra ? ` | ${JSON.stringify(extra)}` : '';
    const regel = `[${tijdstempel()}] [${(NIVEAUS[niveau]?.label || niveau).trim()}] [${categorie.padEnd(8)}] ${bericht}${extraTekst}\n`;
    fs.appendFileSync(bestand, regel, 'utf8');
  } catch (err) {
    console.error('Log schrijven mislukt:', err.message);
  }
};

// ─── HOOFD LOG FUNCTIE ────────────────────────────────────

/**
 * Schrijf een logmelding naar console én logbestanden.
 * @param {string} niveau    – 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'
 * @param {string} categorie – logcategorie (bijv. 'AUTH')
 * @param {string} bericht   – de logboodschap
 * @param {object} [extra]   – optionele extra metadata
 */
const log = (niveau, categorie, bericht, extra) => {
  const niv = NIVEAUS[niveau] || NIVEAUS.INFO;
  const extraTekst = extra ? ` ${DIM}${JSON.stringify(extra)}${RESET}` : '';

  // Console output met kleuren
  console.log(
    `${DIM}[${tijdstempel()}]${RESET} ${niv.kleur}${BOLD}[${niv.label}]${RESET} ${DIM}[${categorie}]${RESET} ${bericht}${extraTekst}`
  );

  // Schrijf naar app.log
  schrijfRegel(APP_LOG, niveau, categorie, bericht, extra);

  // Schrijf ook naar error.log bij fouten
  if (niveau === 'ERROR' || niveau === 'WARN') {
    schrijfRegel(ERROR_LOG, niveau, categorie, bericht, extra);
  }
};

// ─── HANDIGE SHORTCUTS ────────────────────────────────────

/** Log een informatieve melding */
const info  = (cat, msg, extra) => log('INFO',  cat, msg, extra);

/** Log een waarschuwing */
const warn  = (cat, msg, extra) => log('WARN',  cat, msg, extra);

/** Log een fout */
const error = (cat, msg, extra) => log('ERROR', cat, msg, extra);

/** Log een debug melding (alleen in development) */
const debug = (cat, msg, extra) => {
  if (process.env.NODE_ENV !== 'production') log('DEBUG', cat, msg, extra);
};

// ─── HTTP REQUEST MIDDLEWARE ──────────────────────────────

/**
 * Express middleware die elke inkomende HTTP request logt.
 * Slaat gevoelige routes over (zoals /api/auth/login body).
 * Gebruik: app.use(logger.httpMiddleware)
 */
const httpMiddleware = (req, res, next) => {
  const start = Date.now();
  const { method, url, ip } = req;

  // Log de request na afloop zodat we de statuscode weten
  res.on('finish', () => {
    const duur = Date.now() - start;
    const status = res.statusCode;
    const niveau = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';

    // Sla statische bestanden en health checks over
    if (url.startsWith('/css') || url.startsWith('/js') || url === '/api/status') return;

    log(niveau, 'HTTP', `${method} ${url} → ${status} (${duur}ms)`, {
      ip: ip?.replace('::ffff:', '') || 'onbekend',
    });
  });

  next();
};

// ─── LOG READER VOOR ADMIN ────────────────────────────────

/**
 * Lees de laatste N regels uit het logbestand.
 * Wordt gebruikt door het /api/admin/logs endpoint.
 * @param {string} type   – 'app' of 'error'
 * @param {number} regels – aantal regels om terug te geven
 * @returns {string[]} – array van logregels (nieuwste eerst)
 */
const leesLog = (type = 'app', regels = 100) => {
  try {
    const bestand = type === 'error' ? ERROR_LOG : APP_LOG;
    if (!fs.existsSync(bestand)) return [];

    const inhoud = fs.readFileSync(bestand, 'utf8');
    const lijnen = inhoud.split('\n').filter(Boolean);
    return lijnen.slice(-regels).reverse();

  } catch (err) {
    error('SERVER', 'Log lezen mislukt', { fout: err.message });
    return [];
  }
};

module.exports = { log, info, warn, error, debug, httpMiddleware, leesLog, APP_LOG, ERROR_LOG };
