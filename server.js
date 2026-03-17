require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const logger = require('./utils/logger');
const bewaker = require('./utils/bewaker');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 🔒 Beveiligingsbewaker — controleert elk request op blokkades en rate limits
app.use(bewaker.middleware);

// Log elke inkomende HTTP request
app.use(logger.httpMiddleware);

// ─── DATABASE VERBINDING ──────────────────────────────────────────────────────

const verbindMongoDB = async () => {
  try {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI ontbreekt in omgevingsvariabelen');
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('SERVER', 'MongoDB verbonden');
  } catch (err) {
    logger.error('SERVER', 'MongoDB verbindingsfout', { fout: err.message });
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => logger.warn('SERVER', 'MongoDB verbinding verbroken'));
mongoose.connection.on('reconnected',  () => logger.info('SERVER', 'MongoDB herverbonden'));

// ─── ADMIN MIDDLEWARE ─────────────────────────────────────────────────────────

/**
 * Middleware die admin endpoints beveiligt met ADMIN_SECRET.
 */
const adminAuth = (req, res, next) => {
  const secret = process.env.ADMIN_SECRET;
  const token = req.headers.authorization?.split(' ')[1];
  if (!secret || token !== secret) {
    logger.warn('SERVER', 'Ongeautoriseerde toegang tot admin endpoint', {
      ip: (req.ip || '').replace('::ffff:', ''),
      url: req.url
    });
    return res.status(403).json({ succes: false, fout: 'Geen toegang.' });
  }
  next();
};

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.use('/api/auth',     require('./routes/auth'));
app.use('/api/sessies',  require('./routes/sessions'));
app.use('/api/studeren', require('./routes/study'));
app.use('/api/reacties', require('./routes/reacties'));
app.use('/api/scores',   require('./routes/scores'));

// Health check
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    mongodb: mongoose.connection.readyState === 1 ? 'verbonden' : 'niet verbonden',
    tijd: new Date().toISOString()
  });
});

// ─── ADMIN ENDPOINTS ──────────────────────────────────────────────────────────

/**
 * GET /api/admin/logs?type=app&regels=100
 * Geeft de laatste logregels terug.
 */
app.get('/api/admin/logs', adminAuth, (req, res) => {
  const type = req.query.type === 'error' ? 'error' : 'app';
  const regels = Math.min(parseInt(req.query.regels) || 100, 500);
  const logRegels = logger.leesLog(type, regels);
  res.json({ succes: true, type, regels: logRegels.length, log: logRegels });
});

/**
 * GET /api/admin/blokkades
 * Geeft alle actieve IP-blokkades terug.
 */
app.get('/api/admin/blokkades', adminAuth, (req, res) => {
  const nu = Date.now();
  const actief = [];

  bewaker.geblokkeerdeIPs.forEach((info, ip) => {
    if (info.tot > nu) {
      actief.push({
        ip,
        reden: info.reden,
        geblokkerdOp: info.geblokkerdOp,
        tot: new Date(info.tot).toISOString(),
        nogMinuten: Math.ceil((info.tot - nu) / 60000)
      });
    }
  });

  logger.info('SERVER', 'Admin: blokkadelijst opgevraagd', { aantalActief: actief.length });
  res.json({ succes: true, aantalActief: actief.length, blokkades: actief });
});

/**
 * DELETE /api/admin/blokkades/:ip
 * Hef een blokkade handmatig op voor een specifiek IP.
 */
app.delete('/api/admin/blokkades/:ip', adminAuth, (req, res) => {
  const ip = decodeURIComponent(req.params.ip);
  const opgeheven = bewaker.deblokkeerIP(ip);

  if (!opgeheven) {
    return res.status(404).json({ succes: false, fout: `IP ${ip} staat niet op de blokkadelijst.` });
  }

  res.json({ succes: true, bericht: `Blokkade voor ${ip} opgeheven.` });
});

/**
 * POST /api/admin/blokkades
 * Blokkeer handmatig een IP-adres.
 * Verwacht: { ip, reden, minuten }
 */
app.post('/api/admin/blokkades', adminAuth, (req, res) => {
  const { ip, reden, minuten = 60 } = req.body;
  if (!ip) return res.status(400).json({ succes: false, fout: 'IP is verplicht.' });

  bewaker.blokkeerIP(ip, reden || 'Handmatig geblokkeerd via admin', minuten * 60 * 1000);
  res.json({ succes: true, bericht: `IP ${ip} geblokkeerd voor ${minuten} minuten.` });
});

// Pagina routes
app.get('/dashboard',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/studeren',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'study.html')));
app.get('/ontdek',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'ontdek.html')));
app.get('/quest',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'quest.html')));
app.get('/profiel',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/geblokkeerd', (req, res) => res.sendFile(path.join(__dirname, 'public', 'geblokkeerd.html')));
app.get('*',            (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ─── GLOBALE FOUTAFHANDELING ──────────────────────────────────────────────────

app.use((err, req, res, next) => {
  logger.error('SERVER', 'Onbehandelde fout', { fout: err.message, url: req.url });
  res.status(500).json({ succes: false, fout: 'Er is een onverwachte fout opgetreden.' });
});

// ─── SERVER STARTEN ───────────────────────────────────────────────────────────

const start = async () => {
  await verbindMongoDB();
  app.listen(PORT, () => {
    logger.info('SERVER', `StudyFlow gestart op poort ${PORT}`);
    logger.info('BEWAKER', `Beveiligingsbewaker actief — max ${bewaker.CONFIG.MAX_REQUESTS_PER_MINUUT} req/min, ${bewaker.CONFIG.MAX_MISLUKTE_LOGINS} login pogingen`);
    console.log('\n========================================');
    console.log(`✅ StudyFlow draait op http://localhost:${PORT}`);
    console.log(`🔒 Bewaker actief`);
    console.log('========================================\n');
  });
};

process.on('uncaughtException',  (err) => logger.error('SERVER', 'Ongecatchte uitzondering', { fout: err.message }));
process.on('unhandledRejection', (err) => logger.error('SERVER', 'Onbehandelde promise rejection', { fout: String(err) }));
process.on('SIGTERM', () => { logger.info('SERVER', 'Server gestopt via SIGTERM'); process.exit(0); });

start();