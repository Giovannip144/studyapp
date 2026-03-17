const express = require('express');
const Session = require('../models/Session');
const authMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/sessies
 * Haal alle studeersessies op van de ingelogde gebruiker.
 * Gesorteerd van nieuw naar oud.
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const sessies = await Session.find({ gebruiker: req.gebruiker._id })
      .select('-samenvatting -flashcards -quiz') // Stuur alleen metadata voor het dashboard
      .sort({ aangemaaktOp: -1 });

    res.json({
      succes: true,
      sessies
    });

  } catch (err) {
    console.error('Sessies ophalen fout:', err.message);
    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij ophalen sessies.'
    });
  }
});

/**
 * GET /api/sessies/openbaar
 * Haal alle openbare sessies op van alle gebruikers.
 * Voor de "delen met anderen" functionaliteit.
 */
router.get('/openbaar', authMiddleware, async (req, res) => {
  try {
    const sessies = await Session.find({ isOpenbaar: true })
      .select('titel bestandsnaam aangemaaktOp statistieken gebruiker')
      .populate('gebruiker', 'naam school opleiding niveau')
      .sort({ aangemaaktOp: -1 })
      .limit(50);

    res.json({
      succes: true,
      sessies
    });

  } catch (err) {
    console.error('Openbare sessies ophalen fout:', err.message);
    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij ophalen openbare sessies.'
    });
  }
});

/**
 * GET /api/sessies/:id
 * Haal één volledige sessie op inclusief alle content.
 * Alleen toegankelijk voor de eigenaar of als de sessie openbaar is.
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const sessie = await Session.findById(req.params.id)
      .populate('gebruiker', 'naam school');

    if (!sessie) {
      return res.status(404).json({
        succes: false,
        fout: 'Sessie niet gevonden.'
      });
    }

    // Controleer toegangsrecht
    const isEigenaar = sessie.gebruiker._id.toString() === req.gebruiker._id.toString();
    if (!isEigenaar && !sessie.isOpenbaar) {
      return res.status(403).json({
        succes: false,
        fout: 'Geen toegang tot deze sessie.'
      });
    }

    res.json({
      succes: true,
      sessie
    });

  } catch (err) {
    console.error('Sessie ophalen fout:', err.message);

    if (err.name === 'CastError') {
      return res.status(400).json({
        succes: false,
        fout: 'Ongeldig sessie-ID.'
      });
    }

    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij ophalen sessie.'
    });
  }
});

/**
 * POST /api/sessies
 * Sla een nieuwe studeersessie op.
 * Verwacht: bestandsnaam, titel, samenvatting, flashcards, quiz
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { bestandsnaam, titel, samenvatting, flashcards, quiz } = req.body;

    // Valideer verplichte velden
    if (!bestandsnaam || !samenvatting || !flashcards || !quiz) {
      return res.status(400).json({
        succes: false,
        fout: 'Bestandsnaam, samenvatting, flashcards en quiz zijn verplicht.'
      });
    }

    // Valideer flashcards structuur
    if (!Array.isArray(flashcards) || flashcards.length === 0) {
      return res.status(400).json({
        succes: false,
        fout: 'Flashcards moeten een niet-lege array zijn.'
      });
    }

    // Valideer quiz structuur
    if (!Array.isArray(quiz) || quiz.length === 0) {
      return res.status(400).json({
        succes: false,
        fout: 'Quiz moet een niet-lege array zijn.'
      });
    }

    // Zet flashcards om naar het juiste formaat
    const geformatteerdeFlashcards = flashcards.map(fc => ({
      voorkant: fc.front || fc.voorkant,
      achterkant: fc.back || fc.achterkant
    }));

    // Zet quiz om naar het juiste formaat
    const geformatteerdeQuiz = quiz.map(q => ({
      vraag: q.question || q.vraag,
      opties: q.options || q.opties,
      correct: q.correct,
      uitleg: q.explanation || q.uitleg || ''
    }));

    const sessie = new Session({
      gebruiker: req.gebruiker._id,
      bestandsnaam,
      titel: titel || bestandsnaam,
      samenvatting,
      flashcards: geformatteerdeFlashcards,
      quiz: geformatteerdeQuiz
    });

    await sessie.save();
    logger.info('SESSIE', 'Nieuwe sessie opgeslagen', { gebruiker: req.gebruiker.email, titel: sessie.titel, flashcards: sessie.flashcards.length, quiz: sessie.quiz.length });

    res.status(201).json({
      succes: true,
      sessie
    });

  } catch (err) {
    console.error('Sessie opslaan fout:', err.message);

    if (err.name === 'ValidationError') {
      const berichten = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({
        succes: false,
        fout: berichten.join(', ')
      });
    }

    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij opslaan sessie.'
    });
  }
});

/**
 * PUT /api/sessies/:id/delen
 * Zet een sessie op openbaar of privé.
 * Alleen de eigenaar kan dit wijzigen.
 */
router.put('/:id/delen', authMiddleware, async (req, res) => {
  try {
    const { isOpenbaar } = req.body;

    const sessie = await Session.findById(req.params.id);

    if (!sessie) {
      return res.status(404).json({
        succes: false,
        fout: 'Sessie niet gevonden.'
      });
    }

    // Alleen eigenaar mag deelstatus wijzigen
    if (sessie.gebruiker.toString() !== req.gebruiker._id.toString()) {
      return res.status(403).json({
        succes: false,
        fout: 'Alleen de eigenaar kan de deelstatus wijzigen.'
      });
    }

    sessie.isOpenbaar = isOpenbaar;
    await sessie.save();
    logger.info('SESSIE', `Sessie ${isOpenbaar ? 'openbaar' : 'privé'} gezet`, { gebruiker: req.gebruiker.email, sessieId: req.params.id });

    res.json({
      succes: true,
      isOpenbaar: sessie.isOpenbaar
    });

  } catch (err) {
    console.error('Deelstatus wijzigen fout:', err.message);
    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij wijzigen deelstatus.'
    });
  }
});

/**
 * PUT /api/sessies/:id/statistieken
 * Werk quizstatistieken bij na het spelen van een quiz.
 * Verwacht: score (aantal goed), totaal (totaal vragen)
 */
router.put('/:id/statistieken', authMiddleware, async (req, res) => {
  try {
    const { score, totaal } = req.body;

    const sessie = await Session.findOne({
      _id: req.params.id,
      gebruiker: req.gebruiker._id
    });

    if (!sessie) {
      return res.status(404).json({
        succes: false,
        fout: 'Sessie niet gevonden.'
      });
    }

    sessie.statistieken.quizGespeeld += 1;
    if (score > sessie.statistieken.besteScore) {
      sessie.statistieken.besteScore = score;
    }

    await sessie.save();

    res.json({
      succes: true,
      statistieken: sessie.statistieken
    });

  } catch (err) {
    console.error('Statistieken bijwerken fout:', err.message);
    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij bijwerken statistieken.'
    });
  }
});

/**
 * DELETE /api/sessies/:id
 * Verwijder een sessie permanent.
 * Alleen de eigenaar kan een sessie verwijderen.
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const sessie = await Session.findById(req.params.id);

    if (!sessie) {
      return res.status(404).json({
        succes: false,
        fout: 'Sessie niet gevonden.'
      });
    }

    if (sessie.gebruiker.toString() !== req.gebruiker._id.toString()) {
      return res.status(403).json({
        succes: false,
        fout: 'Alleen de eigenaar kan een sessie verwijderen.'
      });
    }

    await Session.findByIdAndDelete(req.params.id);
    logger.info('SESSIE', 'Sessie verwijderd', { gebruiker: req.gebruiker.email, sessieId: req.params.id });

    res.json({
      succes: true,
      bericht: 'Sessie succesvol verwijderd.'
    });

  } catch (err) {
    console.error('Sessie verwijderen fout:', err.message);
    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij verwijderen sessie.'
    });
  }
});

module.exports = router;