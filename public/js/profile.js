/**
 * profile.js – Profielpagina logica
 * Laadt en updatet gebruikersgegevens, wachtwoord en accountbeheer.
 */

vereisInlog();

/**
 * Laad de profielgegevens van de ingelogde gebruiker en vul de formulieren in.
 */
const laadProfiel = async () => {
  try {
    const data = await api('/api/auth/ik');
    const g = data.gebruiker;

    // Stel avatar in (eerste letter van de naam)
    document.getElementById('profiel-avatar').textContent = g.naam.charAt(0).toUpperCase();
    document.getElementById('profiel-naam').textContent = g.naam;
    document.getElementById('profiel-sub').textContent =
      `${g.opleiding} · ${g.school} · ${g.niveau.charAt(0).toUpperCase() + g.niveau.slice(1)}`;

    // Vul formuliervelden in
    document.getElementById('profiel-naam-invoer').value = g.naam;
    document.getElementById('profiel-email').value = g.email;
    document.getElementById('profiel-school').value = g.school;
    document.getElementById('profiel-opleiding').value = g.opleiding;
    document.getElementById('profiel-niveau').value = g.niveau;

    // Update ook opgeslagen gebruiker in localStorage
    localStorage.setItem('sf_gebruiker', JSON.stringify(g));

  } catch (err) {
    console.error('Profiel laden fout:', err.message);
    toonMelding('profiel-melding', `Kon profiel niet laden: ${err.message}`);
  }
};

/**
 * Sla gewijzigde persoonsgegevens op (naam).
 */
const profielOpslaan = async () => {
  const naam = document.getElementById('profiel-naam-invoer').value.trim();
  verbergMelding('profiel-melding');

  if (!naam) {
    toonMelding('profiel-melding', 'Naam mag niet leeg zijn.');
    return;
  }

  try {
    await api('/api/auth/profiel', {
      method: 'PUT',
      body: JSON.stringify({ naam })
    });

    toonMelding('profiel-melding', '✅ Naam succesvol bijgewerkt.', 'succes');
    laadProfiel();

  } catch (err) {
    console.error('Naam opslaan fout:', err.message);
    toonMelding('profiel-melding', `Opslaan mislukt: ${err.message}`);
  }
};

/**
 * Sla gewijzigde schoolgegevens op.
 */
const schoolOpslaan = async () => {
  const school = document.getElementById('profiel-school').value.trim();
  const opleiding = document.getElementById('profiel-opleiding').value.trim();
  const niveau = document.getElementById('profiel-niveau').value;
  verbergMelding('profiel-melding');

  if (!school || !opleiding || !niveau) {
    toonMelding('profiel-melding', 'Vul alle schoolgegevens in.');
    return;
  }

  try {
    await api('/api/auth/profiel', {
      method: 'PUT',
      body: JSON.stringify({ school, opleiding, niveau })
    });

    toonMelding('profiel-melding', '✅ Schoolgegevens succesvol bijgewerkt.', 'succes');
    laadProfiel();

  } catch (err) {
    console.error('Schoolgegevens opslaan fout:', err.message);
    toonMelding('profiel-melding', `Opslaan mislukt: ${err.message}`);
  }
};

/**
 * Wijzig het wachtwoord van de ingelogde gebruiker.
 * Valideert of de nieuwe wachtwoorden overeenkomen.
 */
const wachtwoordWijzigen = async () => {
  const huidig = document.getElementById('huidig-wachtwoord').value;
  const nieuw = document.getElementById('nieuw-wachtwoord').value;
  const bevestig = document.getElementById('bevestig-wachtwoord').value;
  verbergMelding('profiel-melding');

  if (!huidig || !nieuw || !bevestig) {
    toonMelding('profiel-melding', 'Vul alle wachtwoordvelden in.');
    return;
  }

  if (nieuw !== bevestig) {
    toonMelding('profiel-melding', 'Nieuwe wachtwoorden komen niet overeen.');
    return;
  }

  if (nieuw.length < 8) {
    toonMelding('profiel-melding', 'Nieuw wachtwoord moet minimaal 8 tekens zijn.');
    return;
  }

  try {
    await api('/api/auth/profiel', {
      method: 'PUT',
      body: JSON.stringify({ huidigWachtwoord: huidig, nieuwWachtwoord: nieuw })
    });

    toonMelding('profiel-melding', '✅ Wachtwoord succesvol gewijzigd.', 'succes');

    // Leeg de wachtwoordvelden
    document.getElementById('huidig-wachtwoord').value = '';
    document.getElementById('nieuw-wachtwoord').value = '';
    document.getElementById('bevestig-wachtwoord').value = '';

  } catch (err) {
    console.error('Wachtwoord wijzigen fout:', err.message);
    toonMelding('profiel-melding', `Wijzigen mislukt: ${err.message}`);
  }
};

/**
 * Verwijder het account van de ingelogde gebruiker na dubbele bevestiging.
 * Logt de gebruiker uit na succesvolle verwijdering.
 */
const accountVerwijderen = async () => {
  const eerste = confirm('Weet je zeker dat je je account wilt verwijderen? Alle sessies worden permanent verwijderd.');
  if (!eerste) return;

  const tweede = confirm('Dit kan NIET ongedaan worden gemaakt. Doorgaan?');
  if (!tweede) return;

  try {
    await api('/api/auth/account', { method: 'DELETE' });
    uitloggen();
  } catch (err) {
    console.error('Account verwijderen fout:', err.message);
    toonMelding('profiel-melding', `Verwijderen mislukt: ${err.message}`);
  }
};

// Initialiseer
laadProfiel();
