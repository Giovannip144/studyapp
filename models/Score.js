const mongoose = require('mongoose');

/**
 * Score Schema
 * Slaat de score op van een StudyQuest run per gebruiker per sessie.
 * Wordt gebruikt voor het leaderboard en het XP systeem.
 */
const scoreSchema = new mongoose.Schema({
  gebruiker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sessie: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true,
    index: true
  },

  // Spelresultaten
  score:        { type: Number, required: true, min: 0 },
  levelsGehaald:{ type: Number, required: true, min: 0, max: 5 },
  maxCombo:     { type: Number, default: 0 },
  verdiendXP:   { type: Number, default: 0 },

  // Tijdstempel
  gespeeldOp: { type: Date, default: Date.now }
});

/**
 * Index voor snel ophalen van leaderboard per sessie.
 */
scoreSchema.index({ sessie: 1, score: -1 });

/**
 * Index voor globaal leaderboard.
 */
scoreSchema.index({ score: -1, gespeeldOp: -1 });

module.exports = mongoose.model('Score', scoreSchema);
