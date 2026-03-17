/**
 * auth.js – Login, registratie en 2FA verificatie logica
 * Beheert alle formulieren op de loginpagina inclusief
 * het two-step verification scherm.
 */

// Sla het emailadres op tussen stap 1 en stap 2 van 2FA
let loginEmail = '';

/**
 * Wissel tussen login, registreer en verificatiescherm.
 * @param {string} tab - 'login', 'registreer' of 'verifieer'
 */
const wisselTab = (tab) => {
  ['login', 'registreer', 'verifieer'].forEach(t => {
    document.getElementById(`formulier-${t}`)?.classList.toggle('actief', t === tab);
    document.getElementById(`tab-${t}`)?.classList.toggle('actief', t === tab);
  });

  // Verberg auth-tabs bij verificatiescherm
  const tabs = document.querySelector('.auth-tabs');
  if (tabs) tabs.style.display = tab === 'verifieer' ? 'none' : 'flex';

  verbergMelding('login-melding');
  verbergMelding('registreer-melding');
  verbergMelding('verifieer-melding');
};

/**
 * Stap 1 van 2FA: verwerk het loginformulier.
 * Controleert email + wachtwoord en vraagt een verificatiecode aan.
 */
const login = async () => {
  const email = document.getElementById('login-email').value.trim();
  const wachtwoord = document.getElementById('login-wachtwoord').value;
  const knop = document.getElementById('login-knop');

  verbergMelding('login-melding');

  if (!email || !wachtwoord) {
    toonMelding('login-melding', 'Vul alle velden in.');
    return;
  }

  knop.disabled = true;
  knop.innerHTML = '<span class="spinner"></span> Controleren…';

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, wachtwoord })
    });

    // Sla email op voor stap 2
    loginEmail = data.email;

    // Update de verificatietekst met gemaskeerd emailadres
    const sub = document.getElementById('verifieer-sub');
    if (sub) sub.textContent = `We hebben een 6-cijferige code verstuurd naar ${data.emailMasked}. Voer hem hieronder in.`;

    // Schakel naar verificatiescherm
    wisselTab('verifieer');

    // Focus op het code invoerveld
    setTimeout(() => document.getElementById('verifieer-code')?.focus(), 100);

  } catch (err) {
    toonMelding('login-melding', err.message);
  } finally {
    knop.disabled = false;
    knop.innerHTML = 'Inloggen';
  }
};

/**
 * Stap 2 van 2FA: verifieer de ingevoerde code.
 * Bij succes wordt de gebruiker ingelogd en doorgestuurd.
 */
const verifieer = async () => {
  const code = document.getElementById('verifieer-code').value.trim();
  const knop = document.getElementById('verifieer-knop');

  verbergMelding('verifieer-melding');

  if (!code || code.length !== 6) {
    toonMelding('verifieer-melding', 'Voer de volledige 6-cijferige code in.');
    return;
  }

  if (!/^\d{6}$/.test(code)) {
    toonMelding('verifieer-melding', 'De code mag alleen cijfers bevatten.');
    return;
  }

  knop.disabled = true;
  knop.innerHTML = '<span class="spinner"></span> Verificeren…';

  try {
    const data = await api('/api/auth/verifieer', {
      method: 'POST',
      body: JSON.stringify({ email: loginEmail, code })
    });

    slaInlogOp(data.token, data.gebruiker);
    window.location.href = '/dashboard';

  } catch (err) {
    toonMelding('verifieer-melding', err.message);
    // Leeg het code veld zodat de gebruiker opnieuw kan invoeren
    document.getElementById('verifieer-code').value = '';
    document.getElementById('verifieer-code').focus();
  } finally {
    knop.disabled = false;
    knop.innerHTML = 'Bevestigen';
  }
};

/**
 * Stuur de verificatiecode opnieuw naar het emailadres.
 * Heeft een cooldown van 30 seconden om spam te voorkomen.
 */
let opnieuwCooldown = false;
const stuurOpnieuw = async () => {
  if (opnieuwCooldown) return;
  if (!loginEmail) {
    toonMelding('verifieer-melding', 'Ga terug en log opnieuw in.');
    return;
  }

  const knop = document.getElementById('opnieuw-knop');
  opnieuwCooldown = true;
  knop.style.opacity = '0.4';
  knop.style.pointerEvents = 'none';

  try {
    const data = await api('/api/auth/code-opnieuw', {
      method: 'POST',
      body: JSON.stringify({ email: loginEmail })
    });

    toonMelding('verifieer-melding', `✅ Nieuwe code verstuurd naar ${data.emailMasked}`, 'succes');
    document.getElementById('verifieer-code').value = '';
    document.getElementById('verifieer-code').focus();

  } catch (err) {
    toonMelding('verifieer-melding', err.message);
  }

  // Cooldown van 30 seconden
  let seconden = 30;
  const interval = setInterval(() => {
    seconden--;
    knop.textContent = `Stuur opnieuw (${seconden}s)`;
    if (seconden <= 0) {
      clearInterval(interval);
      knop.textContent = 'Stuur opnieuw';
      knop.style.opacity = '';
      knop.style.pointerEvents = '';
      opnieuwCooldown = false;
    }
  }, 1000);
};

/**
 * Verwerk het registratieformulier.
 * Valideert alle velden en maakt een nieuw account aan.
 */
const registreer = async () => {
  const naam = document.getElementById('reg-naam').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const wachtwoord = document.getElementById('reg-wachtwoord').value;
  const school = document.getElementById('reg-school').value.trim();
  const opleiding = document.getElementById('reg-opleiding').value.trim();
  const niveau = document.getElementById('reg-niveau').value;
  const knop = document.getElementById('registreer-knop');

  verbergMelding('registreer-melding');

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
 * Automatisch getallen-only invoer voor de verificatiecode.
 * Verwijdert automatisch niet-numerieke tekens.
 */
document.addEventListener('DOMContentLoaded', () => {
  const codeInvoer = document.getElementById('verifieer-code');
  if (codeInvoer) {
    codeInvoer.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '');
      // Automatisch indienen als 6 cijfers zijn ingevoerd
      if (e.target.value.length === 6) verifieer();
    });
  }
});

/**
 * Stuur het juiste formulier in bij Enter-toets.
 */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const actief = document.querySelector('.formulier.actief')?.id;
  if (actief === 'formulier-login') login();
  else if (actief === 'formulier-registreer') registreer();
  else if (actief === 'formulier-verifieer') verifieer();
});

// Stuur ingelogde gebruikers meteen door
if (getToken()) window.location.href = '/dashboard';