const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * User Schema
 * Slaat alle studentgegevens op inclusief gehashte wachtwoorden.
 * Wachtwoorden worden NOOIT als plaintext opgeslagen.
 */
const userSchema = new mongoose.Schema({
  // Basisgegevens
  naam: {
    type: String,
    required: [true, 'Naam is verplicht'],
    trim: true,
    minlength: [2, 'Naam moet minimaal 2 tekens zijn'],
    maxlength: [100, 'Naam mag maximaal 100 tekens zijn']
  },
  email: {
    type: String,
    required: [true, 'E-mail is verplicht'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Ongeldig e-mailadres']
  },
  wachtwoordHash: {
    type: String,
    required: true,
    select: false // Nooit automatisch meesturen in queries
  },

  // Schoolgegevens
  school: {
    type: String,
    required: [true, 'School is verplicht'],
    trim: true,
    maxlength: [200, 'Schoolnaam mag maximaal 200 tekens zijn']
  },
  opleiding: {
    type: String,
    required: [true, 'Opleiding is verplicht'],
    trim: true,
    maxlength: [200, 'Opleidingsnaam mag maximaal 200 tekens zijn']
  },
  niveau: {
    type: String,
    required: [true, 'Niveau is verplicht'],
    enum: {
      values: ['middelbaar', 'bachelor', 'master'],
      message: 'Niveau moet middelbaar, bachelor of master zijn'
    }
  },

  // Profielafbeelding (optioneel, wordt als initialen weergegeven als leeg)
  avatar: {
    type: String,
    default: ''
  },

  registratieLocatie: {
    ip: String,
    land: String,
    regio: String,
    stad: String
  },

  // Aanmaakdatum
  aangemaaktOp: {
    type: Date,
    default: Date.now
  }
});

/**
 * Hash het wachtwoord automatisch voor opslaan.
 * Wordt alleen uitgevoerd als het wachtwoord gewijzigd is.
 */
userSchema.pre('save', async function (next) {
  try {
    if (!this.isModified('wachtwoordHash')) return next();
    const salt = await bcrypt.genSalt(12);
    this.wachtwoordHash = await bcrypt.hash(this.wachtwoordHash, salt);
    next();
  } catch (err) {
    next(err);
  }
});

/**
 * Vergelijk een ingevoerd wachtwoord met de opgeslagen hash.
 * @param {string} wachtwoord - Het ingevoerde wachtwoord
 * @returns {boolean} - True als het wachtwoord klopt
 */
userSchema.methods.vergelijkWachtwoord = async function (wachtwoord) {
  try {
    return await bcrypt.compare(wachtwoord, this.wachtwoordHash);
  } catch (err) {
    throw new Error('Fout bij wachtwoordvergelijking');
  }
};

/**
 * Geef een veilig gebruikersobject terug zonder gevoelige gegevens.
 * @returns {object} - Gebruikersgegevens zonder wachtwoord
 */
userSchema.methods.naarPubliek = function () {
  return {
    id: this._id,
    naam: this.naam,
    email: this.email,
    school: this.school,
    opleiding: this.opleiding,
    niveau: this.niveau,
    avatar: this.avatar,
    aangemaaktOp: this.aangemaaktOp
  };
};

module.exports = mongoose.model('User', userSchema);
