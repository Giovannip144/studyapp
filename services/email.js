const { Resend } = require('resend');

/**
 * email.js – Email verstuurservice via Resend
 * Gebruikt de Resend API om verificatiecodes te versturen.
 *
 * Vereiste omgevingsvariabelen:
 * - RESEND_API_KEY: je Resend API key van resend.com
 * - EMAIL_VAN: het afzenderadres (bijv. noreply@jouwdomein.nl)
 *   Gebruik tijdens ontwikkeling: onboarding@resend.dev (Resend standaard)
 */

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Verstuur een 2FA verificatiecode naar de gebruiker.
 * @param {string} naarEmail - Ontvanger emailadres
 * @param {string} naam - Naam van de ontvanger voor personalisatie
 * @param {string} code - De 6-cijferige verificatiecode
 * @returns {Promise<boolean>} - True als versturen gelukt is
 */
const stuurVerificatieCode = async (naarEmail, naam, code) => {
  try {
    const vanEmail = process.env.EMAIL_VAN || 'onboarding@resend.dev';

    const { error } = await resend.emails.send({
      from: `StudyFlow <${vanEmail}>`,
      to: naarEmail,
      subject: `${code} — je StudyFlow verificatiecode`,
      html: `
        <!DOCTYPE html>
        <html lang="nl">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="X-UA-Compatible" content="IE=edge">
          <title>StudyFlow verificatiecode</title>
          <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,500;0,700;1,400&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
        </head>
        <body style="margin:0;padding:0;background:#0e0f14;font-family:'DM Sans',Arial,sans-serif;min-height:100vh;width:100%">

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e0f14;min-height:100vh">
            <tr>
              <td align="center" style="padding:48px 20px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px">

                  <!-- Logo -->
                  <tr>
                    <td align="center" style="padding-bottom:36px">
                      <span style="font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:700;color:#eeedf0;letter-spacing:-1px">
                        Study<span style="color:#c8f25a">Flow</span>
                      </span>
                    </td>
                  </tr>

                  <!-- Kaart -->
                  <tr>
                    <td style="background:#16181f;border:1px solid #2a2d3a;border-radius:16px;overflow:hidden">

                      <!-- Accent balk -->
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="background:linear-gradient(90deg,#c8f25a,#5a8cf2);height:3px;font-size:0;line-height:0">&nbsp;</td>
                        </tr>
                      </table>

                      <!-- Header tekst -->
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding:40px 44px 20px">
                            <p style="margin:0 0 8px;font-family:'DM Sans',Arial,sans-serif;color:#8085a0;font-size:15px;font-weight:400">Hoi ${naam},</p>
                            <h1 style="margin:0 0 8px;font-family:'Fraunces',Georgia,serif;color:#eeedf0;font-size:28px;font-weight:500;letter-spacing:-0.5px;line-height:1.2">Je verificatiecode</h1>
                            <p style="margin:0;font-family:'DM Sans',Arial,sans-serif;color:#8085a0;font-size:14px;line-height:1.7">Gebruik onderstaande code om in te loggen bij StudyFlow.</p>
                          </td>
                        </tr>

                        <!-- Code blok -->
                        <tr>
                          <td style="padding:20px 44px 28px">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td align="center" style="background:#1e2029;border:1px solid #2a2d3a;border-radius:12px;padding:36px 20px">
                                  <span style="font-family:'DM Sans',Arial,sans-serif;font-size:30px;font-weight:700;letter-spacing:16px;color:#c8f25a;display:block;line-height:1">${code}</span>
                                  <span style="display:block;margin-top:14px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:#8085a0;letter-spacing:0.3px">geldig voor 10 minuten &nbsp;·&nbsp; eenmalig gebruik</span>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>

                        <!-- Info -->
                        <tr>
                          <td style="padding:0 44px 20px">
                            <p style="margin:0;font-family:'DM Sans',Arial,sans-serif;color:#8085a0;font-size:14px;line-height:1.7">
                              Voer deze code in op de StudyFlow inlogpagina. Na 5 onjuiste pogingen vervalt de code automatisch.
                            </p>
                          </td>
                        </tr>

                        <!-- Waarschuwing -->
                        <tr>
                          <td style="padding:0 44px 40px">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td style="background:#1e2029;border-left:3px solid #f25a8c;border-radius:0 8px 8px 0;padding:14px 18px">
                                  <p style="margin:0;font-family:'DM Sans',Arial,sans-serif;color:#8085a0;font-size:13px;line-height:1.6">
                                    <span style="color:#f25a8c;font-weight:600">Niet jij?</span> Heb jij niet geprobeerd in te loggen? Negeer dan deze email. Je account blijft veilig.
                                  </p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td align="center" style="padding:28px 0 0">
                      <p style="margin:0 0 4px;font-family:'DM Sans',Arial,sans-serif;color:#4a4d5e;font-size:12px">
                        © ${new Date().getFullYear()} StudyFlow — Slimmer studeren met AI
                      </p>
                      <p style="margin:0;font-family:'DM Sans',Arial,sans-serif;color:#4a4d5e;font-size:12px">
                        Dit is een automatisch gegenereerd bericht. Niet beantwoorden.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>

        </body>
        </html>
      `
    });

    if (error) {
      console.error('Resend fout:', error);
      return false;
    }

    console.log(`✅ Verificatiecode verstuurd naar ${naarEmail}`);
    return true;

  } catch (err) {
    console.error('Email versturen fout:', err.message);
    return false;
  }
};

module.exports = { stuurVerificatieCode };