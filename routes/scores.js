const express = require('express');
const Score = require('../models/Score');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * XP drempelwaarden per rank (1–10).
 * Rank stijgt als totaal verdiende XP de drempel overschrijdt.
 */
const XP_PER_RANK = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5800, 8000];

/**
 * Bereken de huidige rank op basis van totaal XP.
 * @param {number} xp - Totaal verdiende XP
 * @returns {{ rank: number, huidigXP: number, volgendXP: number }}
 */
const berekenRank = (xp) => {
  let rank = 1;
  for (let i = 1; i < XP_PER_RANK.length; i++) {
    if (xp >= XP_PER_RANK[i]) rank = i + 1;
    else break;
  }
  rank = Math.min(rank, 10);
  const huidigDrempel = XP_PER_RANK[rank - 1] || 0;
  const volgendDrempel = XP_PER_RANK[rank] || XP_PER_RANK[XP_PER_RANK.length - 1];
  return { rank, huidigXP: xp - huidigDrempel, volgendXP: volgendDrempel - huidigDrempel };
};

/**
 * POST /api/scores
 * Sla een nieuwe score op na een StudyQuest run.
 * Verdeelt XP aan de gebruiker en geeft rankinfo terug.
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { sessieId, score, levelsGehaald, maxCombo } = req.body;

    if (!sessieId || score === undefined || levelsGehaald === undefined) {
      return res.status(400).json({ succes: false, fout: 'sessieId, score en levelsGehaald zijn verplicht.' });
    }

    // XP berekening: basis XP + bonus voor levels + combo bonus
    const verdiendXP = Math.floor(score / 10) + (levelsGehaald * 20) + Math.min(maxCombo * 5, 50);

    const nieuweScore = new Score({
      gebruiker: req.gebruiker._id,
      sessie: sessieId,
      score,
      levelsGehaald,
      maxCombo: maxCombo || 0,
      verdiendXP
    });
    await nieuweScore.save();
    logger.info('QUEST', 'Score opgeslagen', { gebruiker: req.gebruiker.email, sessieId, score, levelsGehaald, maxCombo, verdiendXP });

    // Voeg XP toe aan gebruiker (sla op als apart veld)
    await User.findByIdAndUpdate(req.gebruiker._id, { $inc: { totaalXP: verdiendXP } });

    // Haal bijgewerkte XP op
    const gebruiker = await User.findById(req.gebruiker._id);
    const rankInfo = berekenRank(gebruiker.totaalXP || 0);

    res.status(201).json({
      succes: true,
      verdiendXP,
      totaalXP: gebruiker.totaalXP || 0,
      rankInfo
    });

  } catch (err) {
    console.error('Score opslaan fout:', err.message);
    res.status(500).json({ succes: false, fout: 'Serverfout bij opslaan score.' });
  }
});

/**
 * GET /api/scores/leaderboard/:sessieId
 * Top 10 scores voor een specifieke sessie.
 */
router.get('/leaderboard/:sessieId', authMiddleware, async (req, res) => {
  try {
    const scores = await Score.find({ sessie: req.params.sessieId })
      .sort({ score: -1 })
      .limit(10)
      .populate('gebruiker', 'naam school opleiding niveau');

    res.json({ succes: true, scores });
  } catch (err) {
    console.error('Leaderboard ophalen fout:', err.message);
    res.status(500).json({ succes: false, fout: 'Serverfout bij ophalen leaderboard.' });
  }
});

/**
 * GET /api/scores/globaal
 * Top 10 hoogste scores ooit, over alle sessies.
 */
router.get('/globaal', authMiddleware, async (req, res) => {
  try {
    const scores = await Score.find()
      .sort({ score: -1 })
      .limit(10)
      .populate('gebruiker', 'naam school niveau')
      .populate('sessie', 'titel');

    res.json({ succes: true, scores });
  } catch (err) {
    console.error('Globaal leaderboard fout:', err.message);
    res.status(500).json({ succes: false, fout: 'Serverfout bij ophalen globaal leaderboard.' });
  }
});

/**
 * GET /api/scores/mijn-rank
 * Haal de huidige XP en rank op van de ingelogde gebruiker.
 */
router.get('/mijn-rank', authMiddleware, async (req, res) => {
  try {
    const gebruiker = await User.findById(req.gebruiker._id);
    const rankInfo = berekenRank(gebruiker.totaalXP || 0);
    res.json({ succes: true, totaalXP: gebruiker.totaalXP || 0, rankInfo });
  } catch (err) {
    console.error('Rank ophalen fout:', err.message);
    res.status(500).json({ succes: false, fout: 'Serverfout bij ophalen rank.' });
  }
});

module.exports = router;