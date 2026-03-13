require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────

// CORS instellen (staat verzoeken toe van alle origins voor lokaal testen)
app.use(cors());

// JSON body parser met verhoogde limiet voor PDF base64 data
app.use(express.json({ limit: '50mb' }));

// Statische bestanden serveren vanuit de public map
app.use(express.static(path.join(__dirname, 'public')));

// ─── DATABASE VERBINDING ──────────────────────────────────────────────────────

/**
 * Maak verbinding met MongoDB Atlas.
 * Herprobeert automatisch bij verbindingsverlies via mongoose instellingen.
 */
const verbindMongoDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI ontbreekt in omgevingsvariabelen');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB verbonden');

  } catch (err) {
    console.error('❌ MongoDB verbindingsfout:', err.message);
    console.error('   Controleer je MONGODB_URI in het .env bestand');
    process.exit(1); // Stop de server als de database niet bereikbaar is
  }
};

// Log mongoose verbindingsstatussen
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB verbinding verbroken');
});
mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB herverbonden');
});

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sessies', require('./routes/sessions'));
app.use('/api/studeren', require('./routes/study'));

// Health check endpoint voor Railway/monitoring
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    mongodb: mongoose.connection.readyState === 1 ? 'verbonden' : 'niet verbonden',
    tijd: new Date().toISOString()
  });
});

// Alle andere GET verzoeken sturen naar de juiste HTML pagina
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/studeren', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'study.html'));
});
app.get('/profiel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ─── GLOBALE FOUTAFHANDELING ──────────────────────────────────────────────────

/**
 * Vang alle onbehandelde fouten op en stuur een nette foutmelding terug.
 * Voorkomt dat gevoelige foutinformatie naar de client lekt.
 */
app.use((err, req, res, next) => {
  console.error('Onbehandelde fout:', err.message);
  res.status(500).json({
    succes: false,
    fout: 'Er is een onverwachte fout opgetreden.'
  });
});

// ─── SERVER STARTEN ───────────────────────────────────────────────────────────

const start = async () => {
  await verbindMongoDB();

  app.listen(PORT, () => {
    console.log('\n========================================');
    console.log(`✅ StudyFlow draait op http://localhost:${PORT}`);
    console.log('========================================\n');
  });
};

start();
