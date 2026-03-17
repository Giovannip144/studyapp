const express = require('express');
const https = require('https');
const authMiddleware = require('../middleware/auth');
const pdfParse = require('pdf-parse');
const router = express.Router();
const logger = require('../utils/logger');

/**
 * Split tekst in chunks van een bepaalde grootte.
 * Zorgt dat grote PDFs volledig verwerkt worden.
 * @param {string} tekst - De volledige PDF tekst
 * @param {number} grootte - Maximale chunk grootte in tekens
 * @returns {string[]} - Array van tekst chunks
 */
function splitTekst(tekst, grootte = 10000) {
  const chunks = [];
  for (let i = 0; i < tekst.length; i += grootte) {
    chunks.push(tekst.slice(i, i + grootte));
  }
  return chunks;
}

/**
 * Stuur een verzoek naar de Anthropic API.
 * @param {object} payload - Het request body object
 * @returns {Promise<{status: number, data: object}>}
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

    const req = https.request(opties, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (err) {
          reject(new Error('Ongeldige JSON response van Anthropic'));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error('Netwerkfout bij Anthropic: ' + err.message));
    });

    req.write(body);
    req.end();
  });
};

/**
 * POST /api/studeren/analyseer
 * Analyseer een PDF via tekst extractie + chunk verwerking.
 * Stap 1: PDF naar tekst via pdf-parse
 * Stap 2: Tekst splitsen in chunks
 * Stap 3: Alle chunks parallel analyseren
 * Stap 4: Deelanalyses samenvoegen tot eindresultaat
 */
router.post('/analyseer', authMiddleware, async (req, res) => {
  try {
    const { base64, bestandsnaam } = req.body;

    if (!base64) {
      return res.status(400).json({ succes: false, fout: 'Geen PDF-data ontvangen.' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ succes: false, fout: 'ANTHROPIC_API_KEY ontbreekt.' });
    }

    logger.info('STUDEREN', 'PDF analyse gestart', { gebruiker: req.gebruiker.email, bestand: bestandsnaam });

    // ─── Stap 1: PDF naar tekst ───────────────────────────
    const buffer = Buffer.from(base64, 'base64');
    const pdfData = await pdfParse(buffer);
    const tekst = pdfData.text;

    // ─── Stap 2: Tekst splitsen in chunks ────────────────
    const chunks = splitTekst(tekst, 10000);
    logger.info('STUDEREN', `PDF gesplitst in ${chunks.length} chunk(s)`, { gebruiker: req.gebruiker.email });

    // ─── Stap 3: Alle chunks parallel analyseren ─────────
    const chunkPromises = chunks.map(async (chunk) => {
      const { data } = await roepAnthropicAan({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Analyseer dit deel van een studiedocument en vat de belangrijkste informatie samen:\n\n${chunk}`
        }]
      });

      if (!data?.content) throw new Error('Anthropic response bevat geen content.');
      return data.content.map(b => b.text || '').join('');
    });

    const analyses = await Promise.all(chunkPromises);
    const samengevoegd = analyses.join('\n\n');

    // ─── Stap 4: Finale analyse op basis van deelanalyses ─
    const prompt = `Je bent een zeer grondige studieassistent die studenten helpt complexe studiematerialen te begrijpen.

Analyseer de volledige deelanalyses diepgaand en structureer alle belangrijke informatie.

Geef ALLEEN een geldig JSON-object terug. Geen markdown, geen backticks, geen uitleg, geen tekst buiten het JSON-object.

Gebruik exact dit formaat:

{
  "titel": "Korte beschrijvende titel voor dit document (max 60 tekens)",

  "samenvatting": "Volledige HTML samenvatting. Gebruik: <h2> voor hoofdsecties, <h3> voor subsecties, <p> voor alineas, <ul><li> voor opsommingen, <strong> voor begrippen, <blockquote> voor definities/citaten. Beschrijf elke afbeelding/grafiek/diagram als: <figure class=\\"afbeelding-beschrijving\\"><figcaption><strong>Afbeelding:</strong> [beschrijving]</figcaption></figure>. Minimaal 20 alineas, maximaal 30. Elke alinea 4-8 zinnen. Laat NIETS weg.",

  "flashcards": [
    {"front": "Belangrijk begrip of vraag", "back": "Uitgebreide uitleg"}
  ],

  "quiz": [
    {
      "question": "Inhoudelijke vraag",
      "options": ["Optie A", "Optie B", "Optie C", "Optie D"],
      "correct": 0,
      "explanation": "Waarom dit het juiste antwoord is"
    }
  ]
}

Vereisten:
- Samenvatting: minimaal 20 alineas als HTML met kopjes
- Flashcards: minimaal 15, maximaal 25, focus op begrippen en processen
- Quizvragen: minimaal 20, maximaal 35, mix van concept/begrip/toepassingsvragen
- Zorg dat het juiste antwoord niet altijd op dezelfde positie staat
- Gebruik de taal van het document
- Als je de tokenlimiet bereikt, beeindig het JSON-object correct`;

    const { status, data } = await roepAnthropicAan({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 15000,
      messages: [{
        role: 'user',
        content: `Gebruik deze deelanalyses om een volledige studieanalyse te maken:\n\n${samengevoegd}\n\n${prompt}`
      }]
    });

    if (status !== 200) {
      logger.error('STUDEREN', 'Anthropic API fout', { status, fout: data.error?.message });
      return res.status(status).json({
        succes: false,
        fout: data.error?.message || 'Fout bij AI-analyse.'
      });
    }

    const tekstAI = data.content.map(b => b.text || '').join('');
    const schoon = tekstAI.replace(/```json|```/g, '').trim();

    let resultaat;
    try {
      resultaat = JSON.parse(schoon);

      // Shuffle quizantwoorden zodat correct niet altijd op positie 0 staat
      function shuffleVraag(vraag) {
        const opties = [...(vraag.options || vraag.opties || [])];
        const correctAntwoord = opties[vraag.correct];

        for (let i = opties.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [opties[i], opties[j]] = [opties[j], opties[i]];
        }

        return {
          ...vraag,
          options: opties,
          options: opties,
          correct: opties.indexOf(correctAntwoord)
        };
      }

      if (Array.isArray(resultaat.quiz)) {
        resultaat.quiz = resultaat.quiz.map(shuffleVraag);
      }

    } catch (err) {
      logger.error('STUDEREN', 'JSON parse fout', { fout: err.message, tekst: schoon.substring(0, 500) });
      return res.status(500).json({ succes: false, fout: 'Kon AI-response niet verwerken. Probeer opnieuw.' });
    }

    logger.info('STUDEREN', 'PDF analyse voltooid', {
      gebruiker: req.gebruiker.email,
      bestand: bestandsnaam,
      flashcards: resultaat.flashcards?.length,
      quiz: resultaat.quiz?.length
    });

    res.json({ succes: true, resultaat });

  } catch (err) {
    logger.error('STUDEREN', 'Analyse fout', { fout: err.message });
    res.status(500).json({ succes: false, fout: err.message || 'Serverfout bij analyseren.' });
  }
});

/**
 * PUT /api/studeren/samenvatting/:sessieId
 * Sla de aangepaste samenvatting op — overschrijft de originele.
 * Verwacht: { samenvatting: string (HTML) }
 */
router.put('/samenvatting/:sessieId', authMiddleware, async (req, res) => {
  try {
    const { samenvatting } = req.body;
    const Session = require('../models/Session');

    if (!samenvatting) {
      return res.status(400).json({ succes: false, fout: 'Samenvatting is verplicht.' });
    }

    const sessie = await Session.findById(req.params.sessieId);
    if (!sessie) return res.status(404).json({ succes: false, fout: 'Sessie niet gevonden.' });

    if (sessie.gebruiker.toString() !== req.gebruiker._id.toString()) {
      return res.status(403).json({ succes: false, fout: 'Alleen de eigenaar kan de samenvatting aanpassen.' });
    }

    sessie.samenvatting = samenvatting;
    await sessie.save();

    logger.info('STUDEREN', 'Samenvatting aangepast', { gebruiker: req.gebruiker.email, sessieId: req.params.sessieId });
    res.json({ succes: true, bericht: 'Samenvatting opgeslagen.' });

  } catch (err) {
    logger.error('STUDEREN', 'Samenvatting opslaan fout', { fout: err.message });
    res.status(500).json({ succes: false, fout: 'Serverfout bij opslaan samenvatting.' });
  }
});

module.exports = router;