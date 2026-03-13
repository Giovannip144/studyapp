const express = require('express');
const https = require('https');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

/**
 * Stuur een verzoek naar de Anthropic API.
 * Wikkelt de Node.js https module in een Promise voor makkelijker gebruik.
 * @param {object} payload - Het request body object voor de API
 * @returns {Promise<object>} - De JSON response van Anthropic
 */
const roepAnthropicAan = (payload) => {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);

    const opties = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY.trim(),
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const verzoek = https.request(opties, (antwoord) => {
      let data = '';
      antwoord.on('data', (chunk) => { data += chunk; });
      antwoord.on('end', () => {
        try {
          resolve({ status: antwoord.statusCode, data: JSON.parse(data) });
        } catch (parseErr) {
          reject(new Error('Ongeldige JSON response van Anthropic'));
        }
      });
    });

    verzoek.on('error', (err) => {
      reject(new Error('Netwerkfout bij Anthropic: ' + err.message));
    });

    verzoek.write(body);
    verzoek.end();
  });
};

/**
 * POST /api/studeren/analyseer
 * Analyseer een PDF en genereer samenvatting, flashcards en quiz.
 * Verwacht: base64 (PDF als base64 string), bestandsnaam
 * Vereist authenticatie.
 */
router.post('/analyseer', authMiddleware, async (req, res) => {
  try {
    const { base64, bestandsnaam } = req.body;

    // Valideer invoer
    if (!base64) {
      return res.status(400).json({
        succes: false,
        fout: 'Geen PDF-data ontvangen.'
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY ontbreekt in omgevingsvariabelen');
      return res.status(500).json({
        succes: false,
        fout: 'Server is niet correct geconfigureerd.'
      });
    }

    console.log(`📄 PDF analyse gestart voor gebruiker ${req.gebruiker.naam}: ${bestandsnaam}`);

    const prompt = `Je bent een slimme studieassistent. Analyseer dit PDF-document grondig en geef ALLEEN een geldig JSON-object terug, absoluut geen markdown, geen backticks, geen uitleg.

Formaat:
{
  "titel": "Korte beschrijvende titel voor dit document (max 60 tekens)",
  "samenvatting": "Uitgebreide samenvatting in lopende tekst. Geen cruciale informatie weglaten. Gebruik \\n\\n voor alinea's. Geen markdown.",
  "flashcards": [
    {"front": "Begrip of vraag", "back": "Uitleg of antwoord"}
  ],
  "quiz": [
    {
      "question": "Vraagtekst",
      "options": ["Optie A", "Optie B", "Optie C", "Optie D"],
      "correct": 0,
      "explanation": "Korte uitleg waarom dit het juiste antwoord is"
    }
  ]
}

Eisen:
- Minimaal 8 flashcards, maximaal 15
- Minimaal 10 quizvragen, maximaal 25 afhankelijk van de hoeveelheid informatie je hebt
- Gebruik de taal van het document`;

    // Roep Anthropic API aan
    const { status, data } = await roepAnthropicAan({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 }
          },
          { type: 'text', text: prompt }
        ]
      }]
    });

    // Fout van Anthropic doorsturen
    if (status !== 200) {
      console.error('Anthropic API fout:', data);
      return res.status(status).json({
        succes: false,
        fout: data.error?.message || 'Fout bij AI-analyse.'
      });
    }

    // Parseer de JSON response
    const tekst = data.content.map(b => b.text || '').join('');
    const schoon = tekst.replace(/```json|```/g, '').trim();

    let resultaat;
    try {
      resultaat = JSON.parse(schoon);
    } catch (parseErr) {
      console.error('JSON parse fout:', parseErr.message);
      console.error('Ruwe tekst:', schoon.substring(0, 500));
      return res.status(500).json({
        succes: false,
        fout: 'Kon AI-response niet verwerken. Probeer opnieuw.'
      });
    }

    console.log(`✅ PDF analyse succesvol: ${resultaat.flashcards?.length} flashcards, ${resultaat.quiz?.length} quizvragen`);

    res.json({
      succes: true,
      resultaat
    });

  } catch (err) {
    console.error('Analyse fout:', err.message);
    res.status(500).json({
      succes: false,
      fout: err.message || 'Serverfout bij analyseren PDF.'
    });
  }
});

module.exports = router;
