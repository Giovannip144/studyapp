const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const axios = require("axios");

const router = express.Router();


/**
 * Genereer een JWT-token voor een gebruiker.
 * Token is 7 dagen geldig.
 * @param {string} id - MongoDB gebruikers-ID
 * @returns {string} - Gesigneerd JWT-token
 */
const maakToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

/**
 * POST /api/auth/registreer
 * Maak een nieuw studentaccount aan.
 * Verwacht: naam, email, wachtwoord, school, opleiding, niveau
 */
router.post('/registreer', async (req, res) => {

    const ip =
  req.headers["x-forwarded-for"]?.split(",")[0] ||
  req.socket.remoteAddress ||
  req.ip;

  let geo = {};


  try {
     // IP locatie ophalen
    try {
      const response = await axios.get(`https://ipapi.co/${ip}/json/`);
      geo = response.data;
      console.log(geo)
    } catch (err) {
      console.warn("Geo lookup mislukt:", err.message);
    }

    const { naam, email, wachtwoord, school, opleiding, niveau } = req.body;

    // Valideer verplichte velden
    if (!naam || !email || !wachtwoord || !school || !opleiding || !niveau) {
      return res.status(400).json({
        succes: false,
        fout: 'Alle velden zijn verplicht.'
      });
    }

    // Controleer wachtwoordsterkte
    if (wachtwoord.length < 8) {
      return res.status(400).json({
        succes: false,
        fout: 'Wachtwoord moet minimaal 8 tekens zijn.'
      });
    }
    

    // Controleer of e-mail al in gebruik is
    const bestaatAl = await User.findOne({ email: email.toLowerCase() });
    if (bestaatAl) {
      return res.status(409).json({
        succes: false,
        fout: 'Dit e-mailadres is al geregistreerd.'
      });
    }

    // Maak nieuwe gebruiker aan (wachtwoord wordt automatisch gehasht via model)
    const gebruiker = new User({
      naam,
      email,
      wachtwoordHash: wachtwoord,
      school,
      opleiding,
      niveau,

       registratieLocatie: {
        ip: ip,
        land: geo?.country_name || "Onbekend",
        regio: geo?.region || "Onbekend",
        stad: geo?.city || "Onbekend"
      }
    });

    await gebruiker.save();

    // Genereer token en stuur terug
    const token = maakToken(gebruiker._id);

    res.status(201).json({
      succes: true,
      token,
      gebruiker: gebruiker.naarPubliek()
    });

  } catch (err) {
    console.error('Registratie fout:', err.message);

    // MongoDB duplicate key error
    if (err.code === 11000) {
      return res.status(409).json({
        succes: false,
        fout: 'Dit e-mailadres is al geregistreerd.'
      });
    }

    // Mongoose validatiefouten
    if (err.name === 'ValidationError') {
      const berichten = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({
        succes: false,
        fout: berichten.join(', ')
      });
    }

    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij registratie. Probeer het later opnieuw.'
    });
  }
});

/**
 * POST /api/auth/login
 * Log in met e-mail en wachtwoord.
 * Geeft een JWT-token terug bij succesvolle authenticatie.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, wachtwoord } = req.body;

    // Valideer invoer
    if (!email || !wachtwoord) {
      return res.status(400).json({
        succes: false,
        fout: 'E-mail en wachtwoord zijn verplicht.'
      });
    }

    // Zoek gebruiker op (inclusief wachtwoordhash)
    const gebruiker = await User.findOne({ email: email.toLowerCase() }).select('+wachtwoordHash');
    if (!gebruiker) {
      return res.status(401).json({
        succes: false,
        fout: 'Onjuist e-mailadres of wachtwoord.'
      });
    }

    // Controleer wachtwoord
    const klopt = await gebruiker.vergelijkWachtwoord(wachtwoord);
    if (!klopt) {
      return res.status(401).json({
        succes: false,
        fout: 'Onjuist e-mailadres of wachtwoord.'
      });
    }

    // Genereer token
    const token = maakToken(gebruiker._id);

    res.json({
      succes: true,
      token,
      gebruiker: gebruiker.naarPubliek()
    });

  } catch (err) {
    console.error('Login fout:', err.message);
    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij inloggen. Probeer het later opnieuw.'
    });
  }
});

/**
 * GET /api/auth/ik
 * Haal de gegevens op van de ingelogde gebruiker.
 * Vereist geldig JWT-token.
 */
router.get('/ik', authMiddleware, async (req, res) => {
  try {
    res.json({
      succes: true,
      gebruiker: req.gebruiker.naarPubliek()
    });
  } catch (err) {
    console.error('Profiel ophalen fout:', err.message);
    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij ophalen profiel.'
    });
  }
});

/**
 * PUT /api/auth/profiel
 * Werk profielgegevens bij van de ingelogde gebruiker.
 * Wachtwoord wijzigen kan ook via dit endpoint.
 */
router.put('/profiel', authMiddleware, async (req, res) => {
  try {
    const { naam, school, opleiding, niveau, huidigWachtwoord, nieuwWachtwoord } = req.body;

    const gebruiker = await User.findById(req.gebruiker._id).select('+wachtwoordHash');

    // Update basisgegevens indien aanwezig
    if (naam) gebruiker.naam = naam;
    if (school) gebruiker.school = school;
    if (opleiding) gebruiker.opleiding = opleiding;
    if (niveau) gebruiker.niveau = niveau;

    // Wachtwoord wijzigen (alleen als beide velden aanwezig zijn)
    if (nieuwWachtwoord) {
      if (!huidigWachtwoord) {
        return res.status(400).json({
          succes: false,
          fout: 'Huidig wachtwoord is verplicht om wachtwoord te wijzigen.'
        });
      }

      const klopt = await gebruiker.vergelijkWachtwoord(huidigWachtwoord);
      if (!klopt) {
        return res.status(401).json({
          succes: false,
          fout: 'Huidig wachtwoord is onjuist.'
        });
      }

      if (nieuwWachtwoord.length < 8) {
        return res.status(400).json({
          succes: false,
          fout: 'Nieuw wachtwoord moet minimaal 8 tekens zijn.'
        });
      }

      gebruiker.wachtwoordHash = nieuwWachtwoord;
    }

    await gebruiker.save();

    res.json({
      succes: true,
      gebruiker: gebruiker.naarPubliek()
    });

  } catch (err) {
    console.error('Profiel bijwerken fout:', err.message);

    if (err.name === 'ValidationError') {
      const berichten = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({
        succes: false,
        fout: berichten.join(', ')
      });
    }

    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij bijwerken profiel.'
    });
  }
});

/**
 * DELETE /api/auth/account
 * Verwijder het account van de ingelogde gebruiker inclusief alle sessies.
 */
router.delete('/account', authMiddleware, async (req, res) => {
  try {
    const Session = require('../models/Session');
    await Session.deleteMany({ gebruiker: req.gebruiker._id });
    await req.gebruiker.deleteOne();

    res.json({ succes: true, bericht: 'Account succesvol verwijderd.' });

  } catch (err) {
    console.error('Account verwijderen fout:', err.message);
    res.status(500).json({ succes: false, fout: 'Serverfout bij verwijderen account.' });
  }
});

module.exports = router;
