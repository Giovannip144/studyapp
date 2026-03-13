const express = require('express');
const https = require('https');
const authMiddleware = require('../middleware/auth');
const pdfParse = require("pdf-parse");
const router = express.Router();


/**
 * Split tekst in chunks
 */
function splitTekst(tekst, grootte = 4000) {
  const chunks = [];
  for (let i = 0; i < tekst.length; i += grootte) {
    chunks.push(tekst.slice(i, i + grootte));
  }
  return chunks;
}

/**
 * Stuur verzoek naar Anthropic API
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

      res.on('data', (chunk) => {
        data += chunk;
      });

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
 */
router.post('/analyseer', authMiddleware, async (req, res) => {
  try {

    const { base64, bestandsnaam } = req.body;

    if (!base64) {
      return res.status(400).json({
        succes: false,
        fout: 'Geen PDF-data ontvangen.'
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        succes: false,
        fout: 'ANTHROPIC_API_KEY ontbreekt.'
      });
    }

    console.log(`📄 PDF analyse gestart: ${bestandsnaam}`);

    /**
     * PDF omzetten naar tekst
     */
    const buffer = Buffer.from(base64, "base64");
    const pdfData = await pdfParse(buffer);
    const tekst = pdfData.text;

    /**
     * Tekst splitsen
     */
    const chunks = splitTekst(tekst, 10000);

    console.log(`PDF gesplitst in ${chunks.length} chunks`);

    /**
     * Analyse per chunk
     */
    const chunkPromises = chunks.map(async (chunk) => {

  const { data } = await roepAnthropicAan({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `Analyseer dit deel van een studie document:\n\n${chunk}`
    }]
  });

  if (!data?.content) {
    throw new Error("Anthropic response bevat geen content.");
  }

  return data.content.map(b => b.text || '').join('');
});

const analyses = await Promise.all(chunkPromises);

    const samengevoegd = analyses.join("\n\n");

    /**
     * JOUW ORIGINELE PROMPT (ongewijzigd)
     */
    const prompt = `Je bent een zeer grondige studieassistent die studenten helpt complexe studiematerialen te begrijpen.

Analyseer het volledige PDF-document diepgaand en structureer alle belangrijke informatie.

Geef ALLEEN een geldig JSON-object terug. Geen markdown, geen backticks, geen uitleg, geen tekst buiten het JSON-object.

Gebruik exact dit formaat:

{
  "titel": "Korte beschrijvende titel voor dit document (max 60 tekens)",

  "samenvatting": "ZEER uitgebreide samenvatting van het volledige document. 
  Beschrijf alle belangrijke concepten, definities, processen en verbanden.
  De samenvatting moet minimaal 20 alinea's bevatten.
  Gebruik \\n\\n tussen alinea's.
  Vermijd opsommingen en markdown.",

  "flashcards": [
    {"front": "Belangrijk begrip of vraag", "back": "Uitgebreide uitleg van het begrip"}
  ],

  "quiz": [
    {
      "question": "Inhoudelijke vraag over het document",
      "options": ["Optie A", "Optie B", "Optie C", "Optie D"],
      "correct": 0,
      "explanation": "Waarom dit het juiste antwoord is"
    }
  ]
}

Belangrijke regels:

- Analyseer ALLE secties van het document
- Gebruik informatie uit het hele document
- Negeer geen hoofdstukken
- Zorg dat flashcards verschillende onderwerpen behandelen
- Quizvragen moeten het begrip testen, niet alleen definities

Vereisten:

Samenvatting:
- minimaal 20 alinea's
- maximaal 30 alinea's
- elke alinea 4–8 zinnen

Flashcards:
- minimaal 15
- maximaal 25
- focus op belangrijke concepten, definities en processen

Quizvragen:
- minimaal 20
- maximaal 35
- mix van conceptvragen, begripvragen en toepassingsvragen

Gebruik altijd de taal van het document.

Zorg dat het juiste antwoord niet altijd op dezelfde positie staat.

Als je de tokenlimiet bereikt voordat het JSON-object volledig is, stop dan NIET midden in een string maar beëindig het JSON-object correct.
`;

    /**
     * Finale analyse
     */
    const { status, data } = await roepAnthropicAan({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 7000,
      messages: [{
        role: 'user',
        content: `
Gebruik deze deelanalyses om een volledige studieanalyse te maken:

${samengevoegd}

${prompt}
`
      }]
    });

    if (status !== 200) {
      console.error('Anthropic API fout:', data);
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

      // shuffle functie (betrouwbare Fisher-Yates shuffle)
        function shuffleVraag(vraag) {
          const opties = [...vraag.options];
          const correctAnswer = opties[vraag.correct];

          // shuffle
          for (let i = opties.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [opties[i], opties[j]] = [opties[j], opties[i]];
          }

          const nieuweIndex = opties.indexOf(correctAnswer);

          return {
            ...vraag,
            options: opties,
            correct: nieuweIndex
          };
        }

        if (Array.isArray(resultaat.quiz)) {
          resultaat.quiz = resultaat.quiz.map(shuffleVraag);
        }
    } catch (err) {
      console.error("JSON parse fout:", err.message);
      console.error("Ruwe tekst:", schoon.substring(0, 500));

      return res.status(500).json({
        succes: false,
        fout: "Kon AI response niet verwerken."
      });
    }

    console.log(`✅ Analyse klaar: ${resultaat.flashcards?.length} flashcards`);

    res.json({
      succes: true,
      resultaat
    });

  } catch (err) {

    console.error("Analyse fout:", err);

    res.status(500).json({
      succes: false,
      fout: err.message || "Serverfout bij analyseren."
    });
  }
});

module.exports = router;
