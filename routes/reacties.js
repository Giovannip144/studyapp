const express = require('express');
const Reactie = require('../models/Reactie');
const Session = require('../models/Session');
const authMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/reacties/:sessieId
 * Haal alle reacties op voor een specifieke sessie.
 * Alleen beschikbaar voor openbare sessies of de eigenaar.
 */
router.get('/:sessieId', authMiddleware, async (req, res) => {
  try {
    // Controleer of de sessie bestaat en toegankelijk is
    const sessie = await Session.findById(req.params.sessieId);
    if (!sessie) {
      return res.status(404).json({
        succes: false,
        fout: 'Sessie niet gevonden.'
      });
    }

    const isEigenaar = sessie.gebruiker.toString() === req.gebruiker._id.toString();
    if (!sessie.isOpenbaar && !isEigenaar) {
      return res.status(403).json({
        succes: false,
        fout: 'Geen toegang tot reacties van een privésessie.'
      });
    }

    const reacties = await Reactie.find({ sessie: req.params.sessieId })
      .populate('gebruiker', 'naam school opleiding niveau')
      .sort({ aangemaaktOp: -1 });

    res.json({
      succes: true,
      reacties
    });

  } catch (err) {
    console.error('Reacties ophalen fout:', err.message);

    if (err.name === 'CastError') {
      return res.status(400).json({ succes: false, fout: 'Ongeldig sessie-ID.' });
    }

    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij ophalen reacties.'
    });
  }
});

/**
 * POST /api/reacties/:sessieId
 * Plaats een nieuwe reactie bij een openbare sessie.
 * Verwacht: tekst (string, max 500 tekens)
 */
router.post('/:sessieId', authMiddleware, async (req, res) => {
  try {
    const { tekst } = req.body;

    // Valideer invoer
    if (!tekst || !tekst.trim()) {
      return res.status(400).json({
        succes: false,
        fout: 'Reactietekst is verplicht.'
      });
    }

    if (tekst.trim().length > 500) {
      return res.status(400).json({
        succes: false,
        fout: 'Reactie mag maximaal 500 tekens zijn.'
      });
    }

    // Controleer of de sessie bestaat en openbaar is
    const sessie = await Session.findById(req.params.sessieId);
    if (!sessie) {
      return res.status(404).json({
        succes: false,
        fout: 'Sessie niet gevonden.'
      });
    }

    const isEigenaar = sessie.gebruiker.toString() === req.gebruiker._id.toString();
    if (!sessie.isOpenbaar && !isEigenaar) {
      return res.status(403).json({
        succes: false,
        fout: 'Kan alleen reageren op openbare sessies.'
      });
    }

    // Maak de reactie aan
    const reactie = new Reactie({
      sessie: req.params.sessieId,
      gebruiker: req.gebruiker._id,
      tekst: tekst.trim()
    });

    await reactie.save();
    logger.info('REACTIE', 'Reactie geplaatst', { gebruiker: req.gebruiker.email, sessieId: req.params.sessieId });

    // Stuur terug met gebruikersgegevens (voor directe weergave)
    await reactie.populate('gebruiker', 'naam school opleiding niveau');

    res.status(201).json({
      succes: true,
      reactie
    });

  } catch (err) {
    console.error('Reactie plaatsen fout:', err.message);

    if (err.name === 'ValidationError') {
      const berichten = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ succes: false, fout: berichten.join(', ') });
    }

    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij plaatsen reactie.'
    });
  }
});

/**
 * DELETE /api/reacties/:id
 * Verwijder een reactie.
 * Alleen de auteur van de reactie kan hem verwijderen.
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const reactie = await Reactie.findById(req.params.id);

    if (!reactie) {
      return res.status(404).json({
        succes: false,
        fout: 'Reactie niet gevonden.'
      });
    }

    // Alleen de auteur mag verwijderen
    if (reactie.gebruiker.toString() !== req.gebruiker._id.toString()) {
      return res.status(403).json({
        succes: false,
        fout: 'Alleen de auteur kan een reactie verwijderen.'
      });
    }

    await Reactie.findByIdAndDelete(req.params.id);
    logger.info('REACTIE', 'Reactie verwijderd', { gebruiker: req.gebruiker.email, reactieId: req.params.id });

    res.json({
      succes: true,
      bericht: 'Reactie succesvol verwijderd.'
    });

  } catch (err) {
    console.error('Reactie verwijderen fout:', err.message);

    if (err.name === 'CastError') {
      return res.status(400).json({ succes: false, fout: 'Ongeldig reactie-ID.' });
    }

    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij verwijderen reactie.'
    });
  }
});

module.exports = router;