const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Authentication middleware
 * Controleert of een geldig JWT-token aanwezig is in de Authorization header.
 * Voegt de ingelogde gebruiker toe aan req.gebruiker als het token geldig is.
 *
 * Gebruik: voeg toe als middleware aan beveiligde routes
 * Voorbeeld: router.get('/profiel', authMiddleware, profielHandler)
 */
const authMiddleware = async (req, res, next) => {
  try {
    // Haal token op uit Authorization header (formaat: "Bearer <token>")
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        succes: false,
        fout: 'Geen toegangstoken gevonden. Log eerst in.'
      });
    }

    const token = authHeader.split(' ')[1];

    // Verifieer en decodeer het token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({
          succes: false,
          fout: 'Sessie verlopen. Log opnieuw in.'
        });
      }
      return res.status(401).json({
        succes: false,
        fout: 'Ongeldig toegangstoken.'
      });
    }

    // Zoek de gebruiker op in de database
    const gebruiker = await User.findById(decoded.id);
    if (!gebruiker) {
      return res.status(401).json({
        succes: false,
        fout: 'Gebruiker niet gevonden. Account mogelijk verwijderd.'
      });
    }

    // Voeg gebruiker toe aan request voor gebruik in route handlers
    req.gebruiker = gebruiker;
    next();

  } catch (err) {
    console.error('Auth middleware fout:', err.message);
    return res.status(500).json({
      succes: false,
      fout: 'Serverfout bij authenticatie.'
    });
  }
};

module.exports = authMiddleware;