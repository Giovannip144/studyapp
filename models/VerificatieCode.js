const mongoose = require('mongoose');

/**
 * VerificatieCode Schema
 * Slaat tijdelijke 2FA codes op per gebruiker.
 * Codes verlopen automatisch na 10 minuten via de TTL index.
 * Er kan maar één actieve code per gebruiker bestaan.
 */
const verificatieCodeSchema = new mongoose.Schema({
  gebruiker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // De 6-cijferige code (opgeslagen als hash voor beveiliging)
  codeHash: {
    type: String,
    required: true
  },

  // Aantal pogingen — voorkomt brute force aanvallen
  pogingen: {
    type: Number,
    default: 0,
    max: 5
  },

  // Aanmaaktijd — MongoDB verwijdert het document automatisch na 10 minuten
  aangemaaktOp: {
    type: Date,
    default: Date.now,
    expires: 600 // 10 minuten in seconden
  }
});

/**
 * Zorg dat er maar één actieve code per gebruiker bestaat.
 */
verificatieCodeSchema.index({ gebruiker: 1 }, { unique: true });

module.exports = mongoose.model('VerificatieCode', verificatieCodeSchema);
