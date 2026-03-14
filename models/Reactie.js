const mongoose = require('mongoose');

/**
 * Reactie Schema
 * Slaat een reactie op bij een openbare studeersessie.
 * Gekoppeld aan zowel een sessie als een gebruiker.
 */
const reactieSchema = new mongoose.Schema({
  // Koppeling aan de sessie
  sessie: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true,
    index: true
  },

  // Koppeling aan de auteur
  gebruiker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Inhoud van de reactie
  tekst: {
    type: String,
    required: [true, 'Reactie mag niet leeg zijn'],
    trim: true,
    minlength: [2, 'Reactie moet minimaal 2 tekens zijn'],
    maxlength: [500, 'Reactie mag maximaal 500 tekens zijn']
  },

  // Aanmaakdatum
  aangemaaktOp: {
    type: Date,
    default: Date.now
  }
});

/**
 * Index voor snel ophalen van reacties per sessie, nieuwste eerst.
 */
reactieSchema.index({ sessie: 1, aangemaaktOp: -1 });

module.exports = mongoose.model('Reactie', reactieSchema);