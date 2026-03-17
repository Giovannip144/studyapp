const mongoose = require('mongoose');

/**
 * VraagVoortgang Schema
 * Houdt per gebruiker per vraag bij hoe goed ze hem kennen.
 *
 * Elke vraag heeft een "beheersingsscore":
 * - Goed beantwoord → +1
 * - Fout beantwoord → -1 (minimum 0)
 * - Score >= 2 → vraag "beheerst" — wordt minder vaak gesteld
 * - Score >= 4 → vraag "gememoreerd" — wordt vervangen door nieuwe AI vraag
 *
 * Dit model vormt de basis van het adaptief leren systeem.
 */
const vraagVoortgangSchema = new mongoose.Schema({
  gebruiker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sessie: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true
  },

  // Index van de vraag in de sessie quiz array
  vraagIndex: {
    type: Number,
    required: true,
    min: 0
  },

  // Beheersingsscore — hoger = beter gekend
  score: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  },

  // Hoe vaak goed/fout beantwoord
  goedBeantwoord: { type: Number, default: 0 },
  foutBeantwoord: { type: Number, default: 0 },

  // Laatste keer beantwoord
  laarstBeantwoord: { type: Date, default: null }
});

/**
 * Unieke combinatie van gebruiker + sessie + vraagIndex.
 */
vraagVoortgangSchema.index({ gebruiker: 1, sessie: 1, vraagIndex: 1 }, { unique: true });

/**
 * Bereken of een vraag "beheerst" is (score >= 2).
 */
vraagVoortgangSchema.virtual('beheerst').get(function () {
  return this.score >= 2;
});

/**
 * Bereken of een vraag "gememoreerd" is (score >= 4) — vervang door nieuwe vraag.
 */
vraagVoortgangSchema.virtual('gememoreerd').get(function () {
  return this.score >= 4;
});

module.exports = mongoose.model('VraagVoortgang', vraagVoortgangSchema);