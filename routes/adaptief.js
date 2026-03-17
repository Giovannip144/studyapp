const express = require('express');
const https = require('https');
const Session = require('../models/Session');
const VraagVoortgang = require('../models/VraagVoortgang');
const authMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/adaptief/:sessieId
 * Haal de voortgang op per vraag voor de ingelogde gebruiker.
 * Geeft ook terug welke vragen "gememoreerd" zijn en vervangen moeten worden.
 */
router.get('/:sessieId', authMiddleware, async (req, res) => {
  try {
    const voortgang = await VraagVoortgang.find({
      gebruiker: req.gebruiker._id,
      sessie: req.params.sessieId
    });

    const gememoreerd = voortgang.filter(v => v.score >= 4).length;
    const beheerst    = voortgang.filter(v => v.score >= 2 && v.score < 4).length;
    const bezig       = voortgang.filter(v => v.score > 0 && v.score < 2).length;

    res.json({
      succes: true,
      voortgang,
      samenvatting: { gememoreerd, beheerst, bezig, onbekend: 0 }
    });

  } catch (err) {
    logger.error('ADAPTIEF', 'Voortgang ophalen fout', { fout: err.message });
    res.status(500).json({ succes: false, fout: 'Serverfout bij ophalen voortgang.' });
  }
});

/**
 * POST /api/adaptief/:sessieId/antwoord
 * Registreer een antwoord op een vraag en update de beheersingsscore.
 * Verwacht: { vraagIndex: number, goed: boolean }
 */
router.post('/:sessieId/antwoord', authMiddleware, async (req, res) => {
  try {
    const { vraagIndex, goed } = req.body;

    if (vraagIndex === undefined || goed === undefined) {
      return res.status(400).json({ succes: false, fout: 'vraagIndex en goed zijn verplicht.' });
    }

    // Zoek of maak voortgang record aan voor deze vraag
    let voortgang = await VraagVoortgang.findOne({
      gebruiker: req.gebruiker._id,
      sessie: req.params.sessieId,
      vraagIndex
    });

    if (!voortgang) {
      voortgang = new VraagVoortgang({
        gebruiker: req.gebruiker._id,
        sessie: req.params.sessieId,
        vraagIndex
      });
    }

    // Update score
    if (goed) {
      voortgang.score = Math.min(voortgang.score + 1, 10);
      voortgang.goedBeantwoord++;
    } else {
      voortgang.score = Math.max(voortgang.score - 1, 0);
      voortgang.foutBeantwoord++;
    }

    voortgang.laarstBeantwoord = new Date();
    await voortgang.save();

    const gememoreerd = voortgang.score >= 4;
    const beheerst    = voortgang.score >= 2;

    res.json({
      succes: true,
      score: voortgang.score,
      beheerst,
      gememoreerd,
      // Geef aan als de vraag gememoreerd is — quest.js kan dan nieuwe vragen aanvragen
      nieuweVraagNodig: gememoreerd
    });

  } catch (err) {
    logger.error('ADAPTIEF', 'Antwoord registreren fout', { fout: err.message });
    res.status(500).json({ succes: false, fout: 'Serverfout bij registreren antwoord.' });
  }
});

/**
 * POST /api/adaptief/:sessieId/genereer
 * Genereer nieuwe AI-vragen voor een sessie op basis van de samenvatting.
 * Wordt aangeroepen als te veel vragen "gememoreerd" zijn.
 * Verwacht: { aantalNieuw: number } (default 4)
 */
router.post('/:sessieId/genereer', authMiddleware, async (req, res) => {
  try {
    const { aantalNieuw = 4 } = req.body;

    // Haal de sessie op voor context
    const sessie = await Session.findById(req.params.sessieId);
    if (!sessie) {
      return res.status(404).json({ succes: false, fout: 'Sessie niet gevonden.' });
    }

    // Haal bestaande vragen op om duplicaten te voorkomen
    const bestaandeVragen = (sessie.quiz || []).map(q => q.vraag || q.question).join('\n- ');

    logger.info('ADAPTIEF', 'Nieuwe vragen genereren', {
      gebruiker: req.gebruiker.email,
      sessie: sessie.titel,
      aantalNieuw
    });

    // Roep Anthropic API aan voor nieuwe vragen
    const nieuweVragen = await genereerNieuweVragen(
      sessie.samenvatting,
      bestaandeVragen,
      aantalNieuw
    );

    if (!nieuweVragen || nieuweVragen.length === 0) {
      return res.status(500).json({ succes: false, fout: 'Kon geen nieuwe vragen genereren.' });
    }

    // Voeg nieuwe vragen toe aan de sessie
    const geformatteerd = nieuweVragen.map(q => ({
      vraag: q.question || q.vraag,
      opties: q.options || q.opties,
      correct: q.correct,
      uitleg: q.explanation || q.uitleg || ''
    }));

    sessie.quiz.push(...geformatteerd);
    await sessie.save();

    logger.info('ADAPTIEF', 'Nieuwe vragen toegevoegd', {
      sessie: sessie.titel,
      nieuw: geformatteerd.length,
      totaal: sessie.quiz.length
    });

    res.json({
      succes: true,
      nieuwAantal: geformatteerd.length,
      totaalVragen: sessie.quiz.length,
      nieuweVragen: geformatteerd
    });

  } catch (err) {
    logger.error('ADAPTIEF', 'Vragen genereren fout', { fout: err.message });
    res.status(500).json({ succes: false, fout: 'Serverfout bij genereren vragen.' });
  }
});

/**
 * GET /api/adaptief/:sessieId/slim
 * Geeft een slimme vraagvolgorde terug op basis van beheersingsscore.
 * Onbekende en moeilijke vragen komen vaker voor dan gememoreerde vragen.
 */
router.get('/:sessieId/slim', authMiddleware, async (req, res) => {
  try {
    const sessie = await Session.findById(req.params.sessieId);
    if (!sessie) return res.status(404).json({ succes: false, fout: 'Sessie niet gevonden.' });

    const voortgang = await VraagVoortgang.find({
      gebruiker: req.gebruiker._id,
      sessie: req.params.sessieId
    });

    // Maak een map van vraagIndex → score
    const scoreMap = {};
    voortgang.forEach(v => { scoreMap[v.vraagIndex] = v.score; });

    // Stel gewichten in — lage score = hogere kans om gesteld te worden
    const gewogenVragen = [];
    sessie.quiz.forEach((q, i) => {
      const score = scoreMap[i] || 0;

      // Gememoreerde vragen (score >= 4) komen 1x voor
      // Onbekende vragen (score 0) komen 4x voor
      // Tussenin schaalt lineair
      const gewicht = Math.max(1, 4 - score);

      for (let w = 0; w < gewicht; w++) {
        gewogenVragen.push({
          ...q.toObject(),
          index: i,
          score: score,
          beheerst: score >= 2,
          gememoreerd: score >= 4
        });
      }
    });

    // Schud de gewogen lijst door elkaar
    const geshuffled = shuffleArray(gewogenVragen);

    res.json({
      succes: true,
      vragen: geshuffled,
      totaal: sessie.quiz.length,
      scoreMap
    });

  } catch (err) {
    logger.error('ADAPTIEF', 'Slimme volgorde fout', { fout: err.message });
    res.status(500).json({ succes: false, fout: 'Serverfout bij ophalen slimme volgorde.' });
  }
});

// ─── HELPERS ─────────────────────────────────────────────

/**
 * Genereer nieuwe quizvragen via de Anthropic API op basis van de samenvatting.
 * @param {string} samenvatting - De samenvatting van de sessie als context
 * @param {string} bestaandeVragen - Bestaande vragen om duplicaten te voorkomen
 * @param {number} aantal - Aantal te genereren vragen
 * @returns {Promise<Array>} - Array van nieuwe quizvragen
 */
const genereerNieuweVragen = (samenvatting, bestaandeVragen, aantal) => {
  return new Promise((resolve, reject) => {
    const prompt = `Je bent een slimme studieassistent. Genereer ${aantal} NIEUWE meerkeuzevragen op basis van onderstaande samenvatting.

BELANGRIJK: De volgende vragen bestaan al — maak GEEN duplicaten of varianten hiervan:
- ${bestaandeVragen}

Geef ALLEEN een geldig JSON array terug, geen uitleg, geen markdown, geen backticks.

Formaat:
[
  {
    "question": "Vraagtekst",
    "options": ["Optie A", "Optie B", "Optie C", "Optie D"],
    "correct": 0,
    "explanation": "Korte uitleg"
  }
]

Samenvatting:
${samenvatting.substring(0, 3000)}

Genereer precies ${aantal} nieuwe, unieke vragen die andere aspecten van de stof testen dan de bestaande vragen.`;

    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const opties = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(opties, apiRes => {
      let data = '';
      apiRes.on('data', chunk => { data += chunk; });
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const tekst = parsed.content?.map(b => b.text || '').join('') || '';
          const schoon = tekst.replace(/```json|```/g, '').trim();
          const vragen = JSON.parse(schoon);
          resolve(Array.isArray(vragen) ? vragen : []);
        } catch (e) {
          logger.error('ADAPTIEF', 'JSON parse fout bij nieuwe vragen', { fout: e.message });
          resolve([]);
        }
      });
    });

    req.on('error', err => reject(err));
    req.write(body);
    req.end();
  });
};

/**
 * Schud een array willekeurig door elkaar.
 * @param {Array} arr
 * @returns {Array}
 */
const shuffleArray = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

module.exports = router;