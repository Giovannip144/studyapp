/**
 * auth.js – Login en registratie logica
 * Verwerkt formulierinvoer, API calls en foutmeldingen voor de loginpagina.
 */

/**
 * Wissel tussen login en registratie formulier.
 * @param {string} tab - 'login' of 'registreer'
 */
const wisselTab = (tab) => {
  document.getElementById('formulier-login').classList.toggle('actief', tab === 'login');
  document.getElementById('formulier-registreer').classList.toggle('actief', tab === 'registreer');
  document.getElementById('tab-login').classList.toggle('actief', tab === 'login');
  document.getElementById('tab-registreer').classList.toggle('actief', tab === 'registreer');
  verbergMelding('login-melding');
  verbergMelding('registreer-melding');
};

/**
 * Verwerk het loginformulier.
 * Valideert invoer, stuurt API verzoek en slaat token op bij succes.
 */
const login = async () => {
  const email = document.getElementById('login-email').value.trim();
  const wachtwoord = document.getElementById('login-wachtwoord').value;
  const knop = document.getElementById('login-knop');

  verbergMelding('login-melding');

  // Basisvalidatie
  if (!email || !wachtwoord) {
    toonMelding('login-melding', 'Vul alle velden in.');
    return;
  }

  // Laadstatus
  knop.disabled = true;
  knop.innerHTML = '<span class="spinner"></span> Inloggen…';

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, wachtwoord })
    });

    slaInlogOp(data.token, data.gebruiker);
    window.location.href = '/dashboard';

  } catch (err) {
    toonMelding('login-melding', err.message);
  } finally {
    knop.disabled = false;
    knop.innerHTML = 'Inloggen';
  }
};

/**
 * Verwerk het registratieformulier.
 * Valideert alle velden en maakt een nieuw account aan.
 */
const registreer = async () => {
  console.log("er word geklikt op de regristreer knop")
  const naam = document.getElementById('reg-naam').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const wachtwoord = document.getElementById('reg-wachtwoord').value;
  const school = document.getElementById('reg-school').value.trim();
  const opleiding = document.getElementById('reg-opleiding').value.trim();
  const niveau = document.getElementById('reg-niveau').value;
  const knop = document.getElementById('registreer-knop');

  verbergMelding('registreer-melding');

  // Valideer alle velden
  if (!naam || !email || !wachtwoord || !school || !opleiding || !niveau) {
    toonMelding('registreer-melding', 'Vul alle velden in.');
    return;
  }
  if (wachtwoord.length < 8) {
    toonMelding('registreer-melding', 'Wachtwoord moet minimaal 8 tekens zijn.');
    return;
  }

  knop.disabled = true;
  knop.innerHTML = '<span class="spinner"></span> Account aanmaken…';

  try {
    const data = await api('/api/auth/registreer', {
      method: 'POST',
      body: JSON.stringify({ naam, email, wachtwoord, school, opleiding, niveau })
    });

    slaInlogOp(data.token, data.gebruiker);
    window.location.href = '/dashboard';

  } catch (err) {
    toonMelding('registreer-melding', err.message);
  } finally {
    knop.disabled = false;
    knop.innerHTML = 'Account aanmaken';
  }
};

/**
 * Stuur formulier in bij Enter-toets.
 */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const loginActief = document.getElementById('formulier-login').classList.contains('actief');
  if (loginActief) login();
  else registreer();
});

// Stuur ingelogde gebruikers meteen door naar het dashboard
if (getToken()) {
  window.location.href = '/dashboard';
}
