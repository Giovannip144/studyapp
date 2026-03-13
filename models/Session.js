const mongoose = require('mongoose');

/**
 * Session Schema
 * Slaat een volledige studeersessie op per student.
 * Elke sessie bevat de samenvatting, flashcards en quiz die gegenereerd zijn uit een PDF.
 */
const sessionSchema = new mongoose.Schema({
  // Koppeling aan de gebruiker
  gebruiker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Bestandsinformatie
  bestandsnaam: {
    type: String,
    required: true,
    trim: true,
    maxlength: [255, 'Bestandsnaam te lang']
  },
  titel: {
    type: String,
    required: true,
    trim: true,
    maxlength: [200, 'Titel te lang'],
    default: function () { return this.bestandsnaam; }
  },

  // Gegenereerde content
  samenvatting: {
    type: String,
    required: true
  },
  flashcards: [{
    voorkant: { type: String, required: true },
    achterkant: { type: String, required: true }
  }],
  quiz: [{
    vraag: { type: String, required: true },
    opties: [{ type: String, required: true }],
    correct: { type: Number, required: true, min: 0, max: 3 },
    uitleg: { type: String, default: '' }
  }],

  // Statistieken
  statistieken: {
    quizGespeeld: { type: Number, default: 0 },
    besteScore: { type: Number, default: 0 },
    flashcardsGeoefend: { type: Number, default: 0 }
  },

  // Deelinstelling
  isOpenbaar: {
    type: Boolean,
    default: false
  },

  // Tijdstempels
  aangemaaktOp: {
    type: Date,
    default: Date.now
  },
  bijgewerktOp: {
    type: Date,
    default: Date.now
  }
});

/**
 * Update bijgewerktOp automatisch bij elke wijziging.
 */
sessionSchema.pre('save', function (next) {
  this.bijgewerktOp = new Date();
  next();
});

/**
 * Index voor snelle zoekopdrachten per gebruiker gesorteerd op datum.
 */
sessionSchema.index({ gebruiker: 1, aangemaaktOp: -1 });

module.exports = mongoose.model('Session', sessionSchema);
