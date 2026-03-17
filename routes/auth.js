const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const VerificatieCode = require('../models/VerificatieCode');
const authMiddleware = require('../middleware/auth');
const { stuurVerificatieCode } = require('../services/email');
const logger = require('../utils/logger');
const bewaker = require('../utils/bewaker');

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
 * Genereer een willekeurige 6-cijferige verificatiecode.
 * @returns {string} - 6-cijferige code als string
 */
const maakCode = () => {
  return String(Math.floor(100000 + Math.random() * 900000));
};

/**
 * POST /api/auth/registreer
 * Maak een nieuw studentaccount aan.
 * Verwacht: naam, email, wachtwoord, school, opleiding, niveau
 */
router.post('/registreer', async (req, res) => {
  try {
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
      niveau
    });

    await gebruiker.save();

    // Genereer token en stuur terug
    const token = maakToken(gebruiker._id);

    logger.info('AUTH', 'Nieuw account aangemaakt', { email: gebruiker.email, naam: gebruiker.naam, niveau: gebruiker.niveau, school: gebruiker.school });
    res.status(201).json({
      succes: true,
      token,
      gebruiker: gebruiker.naarPubliek()
    });

  } catch (err) {
    console.error('Registratie fout:', err.message);

    if (err.code === 11000) {
      return res.status(409).json({
        succes: false,
        fout: 'Dit e-mailadres is al geregistreerd.'
      });
    }

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
 * Stap 1 van 2FA: controleer email + wachtwoord.
 * Bij succes wordt een verificatiecode verstuurd naar het emailadres.
 * Geeft GEEN token terug — dat gebeurt pas na /verifieer.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, wachtwoord } = req.body;

    if (!email || !wachtwoord) {
      return res.status(400).json({
        succes: false,
        fout: 'E-mail en wachtwoord zijn verplicht.'
      });
    }

    // Zoek gebruiker op (inclusief wachtwoordhash)
    const gebruiker = await User.findOne({ email: email.toLowerCase() }).select('+wachtwoordHash');
    if (!gebruiker) {
      logger.warn('AUTH', 'Mislukte login: onbekend emailadres', { email });
      const ip1 = (req.ip || '').replace('::ffff:', '');
      bewaker.registreerMislukteLogin(ip1, email);
      return res.status(401).json({
        succes: false,
        fout: 'Onjuist e-mailadres of wachtwoord.'
      });
    }

    // Controleer wachtwoord
    const klopt = await gebruiker.vergelijkWachtwoord(wachtwoord);
    if (!klopt) {
      logger.warn('AUTH', 'Mislukte login: fout wachtwoord', { email });
      const ip2 = (req.ip || '').replace('::ffff:', '');
      bewaker.registreerMislukteLogin(ip2, email);
      return res.status(401).json({
        succes: false,
        fout: 'Onjuist e-mailadres of wachtwoord.'
      });
    }

    // Genereer en hash de 6-cijferige code
    const code = maakCode();
    const salt = await bcrypt.genSalt(10);
    const codeHash = await bcrypt.hash(code, salt);

    // Sla op (of overschrijf bestaande code voor deze gebruiker)
    await VerificatieCode.findOneAndUpdate(
      { gebruiker: gebruiker._id },
      { gebruiker: gebruiker._id, codeHash, pogingen: 0, aangemaaktOp: new Date() },
      { upsert: true, new: true }
    );

    // Verstuur de code via email
    const verstuurd = await stuurVerificatieCode(gebruiker.email, gebruiker.naam, code);
    if (!verstuurd) {
      return res.status(500).json({
        succes: false,
        fout: 'Kon verificatiecode niet versturen. Controleer je emailadres.'
      });
    }

    logger.info('AUTH', '2FA code verstuurd', { email: gebruiker.email });

    res.json({
      succes: true,
      stap: 'verifieer',
      email: gebruiker.email,
      // Stuur een gemaskerd emailadres terug voor weergave (bijv. g***@gmail.com)
      emailMasked: maskeerEmail(gebruiker.email),
      bericht: `Verificatiecode verstuurd naar ${maskeerEmail(gebruiker.email)}`
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
 * POST /api/auth/verifieer
 * Stap 2 van 2FA: controleer de ingevoerde verificatiecode.
 * Bij succes wordt een JWT-token teruggegeven.
 * Verwacht: email, code
 */
router.post('/verifieer', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        succes: false,
        fout: 'Email en verificatiecode zijn verplicht.'
      });
    }

    // Zoek de gebruiker op
    const gebruiker = await User.findOne({ email: email.toLowerCase() });
    if (!gebruiker) {
      return res.status(401).json({
        succes: false,
        fout: 'Ongeldige verificatiepoging.'
      });
    }

    // Zoek de actieve verificatiecode
    const verificatie = await VerificatieCode.findOne({ gebruiker: gebruiker._id });
    if (!verificatie) {
      return res.status(401).json({
        succes: false,
        fout: 'Geen actieve verificatiecode gevonden. Vraag een nieuwe code aan.'
      });
    }

    // Controleer het maximaal aantal pogingen (brute force beveiliging)
    if (verificatie.pogingen >= 5) {
      await VerificatieCode.findByIdAndDelete(verificatie._id);
      logger.warn('AUTH', 'Te veel 2FA pogingen — code geblokkeerd', { email });
      return res.status(429).json({
        succes: false,
        fout: 'Te veel pogingen. Log opnieuw in om een nieuwe code te ontvangen.'
      });
    }

    // Verhoog pogingen teller
    await VerificatieCode.findByIdAndUpdate(verificatie._id, { $inc: { pogingen: 1 } });

    // Vergelijk de ingevoerde code met de opgeslagen hash
    const klopt = await bcrypt.compare(code.trim(), verificatie.codeHash);
    if (!klopt) {
      const over = 5 - (verificatie.pogingen + 1);
      return res.status(401).json({
        succes: false,
        fout: `Onjuiste code. Nog ${over} poging${over !== 1 ? 'en' : ''} over.`
      });
    }

    // Code klopt — verwijder hem zodat hij niet hergebruikt kan worden
    await VerificatieCode.findByIdAndDelete(verificatie._id);

    // Genereer JWT token
    const token = maakToken(gebruiker._id);

    logger.info('AUTH', 'Succesvolle login via 2FA', { email: gebruiker.email, naam: gebruiker.naam });
    const ipOk = (req.ip || '').replace('::ffff:', '');
    bewaker.resetMisluktLogins(ipOk);

    res.json({
      succes: true,
      token,
      gebruiker: gebruiker.naarPubliek()
    });

  } catch (err) {
    console.error('Verificatie fout:', err.message);
    res.status(500).json({
      succes: false,
      fout: 'Serverfout bij verificatie. Probeer het later opnieuw.'
    });
  }
});

/**
 * POST /api/auth/code-opnieuw
 * Stuur een nieuwe verificatiecode als de vorige verlopen is.
 * Verwacht: email
 */
router.post('/code-opnieuw', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ succes: false, fout: 'Email is verplicht.' });
    }

    const gebruiker = await User.findOne({ email: email.toLowerCase() });
    if (!gebruiker) {
      // Geen fout teruggeven — geeft anders aan of een email bestaat
      return res.json({ succes: true, bericht: 'Als dit emailadres bestaat, is een nieuwe code verstuurd.' });
    }

    // Genereer nieuwe code
    const code = maakCode();
    const salt = await bcrypt.genSalt(10);
    const codeHash = await bcrypt.hash(code, salt);

    await VerificatieCode.findOneAndUpdate(
      { gebruiker: gebruiker._id },
      { gebruiker: gebruiker._id, codeHash, pogingen: 0, aangemaaktOp: new Date() },
      { upsert: true, new: true }
    );

    await stuurVerificatieCode(gebruiker.email, gebruiker.naam, code);

    res.json({
      succes: true,
      emailMasked: maskeerEmail(gebruiker.email),
      bericht: 'Nieuwe code verstuurd.'
    });

  } catch (err) {
    console.error('Code opnieuw fout:', err.message);
    res.status(500).json({ succes: false, fout: 'Serverfout. Probeer het later opnieuw.' });
  }
});

/**
 * GET /api/auth/ik
 * Haal de gegevens op van de ingelogde gebruiker.
 */
router.get('/ik', authMiddleware, async (req, res) => {
  try {
    res.json({ succes: true, gebruiker: req.gebruiker.naarPubliek() });
  } catch (err) {
    console.error('Profiel ophalen fout:', err.message);
    res.status(500).json({ succes: false, fout: 'Serverfout bij ophalen profiel.' });
  }
});

/**
 * PUT /api/auth/profiel
 * Werk profielgegevens bij van de ingelogde gebruiker.
 */
router.put('/profiel', authMiddleware, async (req, res) => {
  try {
    const { naam, school, opleiding, niveau, huidigWachtwoord, nieuwWachtwoord } = req.body;
    const gebruiker = await User.findById(req.gebruiker._id).select('+wachtwoordHash');

    if (naam) gebruiker.naam = naam;
    if (school) gebruiker.school = school;
    if (opleiding) gebruiker.opleiding = opleiding;
    if (niveau) gebruiker.niveau = niveau;

    if (nieuwWachtwoord) {
      if (!huidigWachtwoord) {
        return res.status(400).json({ succes: false, fout: 'Huidig wachtwoord is verplicht om wachtwoord te wijzigen.' });
      }
      const klopt = await gebruiker.vergelijkWachtwoord(huidigWachtwoord);
      if (!klopt) {
        return res.status(401).json({ succes: false, fout: 'Huidig wachtwoord is onjuist.' });
      }
      if (nieuwWachtwoord.length < 8) {
        return res.status(400).json({ succes: false, fout: 'Nieuw wachtwoord moet minimaal 8 tekens zijn.' });
      }
      gebruiker.wachtwoordHash = nieuwWachtwoord;
    }

    await gebruiker.save();
    res.json({ succes: true, gebruiker: gebruiker.naarPubliek() });

  } catch (err) {
    console.error('Profiel bijwerken fout:', err.message);
    if (err.name === 'ValidationError') {
      const berichten = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ succes: false, fout: berichten.join(', ') });
    }
    res.status(500).json({ succes: false, fout: 'Serverfout bij bijwerken profiel.' });
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
    await VerificatieCode.deleteMany({ gebruiker: req.gebruiker._id });
    logger.info('AUTH', 'Account verwijderd', { email: req.gebruiker.email, naam: req.gebruiker.naam });
    await req.gebruiker.deleteOne();
    res.json({ succes: true, bericht: 'Account succesvol verwijderd.' });
  } catch (err) {
    console.error('Account verwijderen fout:', err.message);
    res.status(500).json({ succes: false, fout: 'Serverfout bij verwijderen account.' });
  }
});

/**
 * Maskeer een emailadres voor veilige weergave.
 * Voorbeeld: giovanni@gmail.com → g******i@gmail.com
 * @param {string} email
 * @returns {string}
 */
const maskeerEmail = (email) => {
  const [lokaal, domein] = email.split('@');
  if (lokaal.length <= 2) return `${lokaal[0]}*@${domein}`;
  return `${lokaal[0]}${'*'.repeat(lokaal.length - 2)}${lokaal[lokaal.length - 1]}@${domein}`;
};

module.exports = router;

/**
 * POST /api/auth/registreer
 * Maak een nieuw studentaccount aan.
 * Verwacht: naam, email, wachtwoord, school, opleiding, niveau
 */
router.post('/registreer', async (req, res) => {
  try {
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
      niveau
    });

    await gebruiker.save();

    // Genereer token en stuur terug
    const token = maakToken(gebruiker._id);

    logger.info('AUTH', 'Nieuw account aangemaakt', { email: gebruiker.email, naam: gebruiker.naam, niveau: gebruiker.niveau, school: gebruiker.school });
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

module.exports = router;

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