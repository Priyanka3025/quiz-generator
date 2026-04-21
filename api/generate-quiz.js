module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { pdfBase64, textContent, numQuestions, questionTypes, difficulties, bloomLevels, board, classLevel } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server.' });
    }

    const prompt = buildPrompt({ numQuestions, questionTypes, difficulties, bloomLevels, board, classLevel, textContent });

    const parts = [];
    if (pdfBase64) {
      parts.push({ inline_data: { mime_type: 'application/pdf', data: pdfBase64 } });
    }
    parts.push({ text: prompt });

    const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: parts }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192, responseMimeType: 'application/json' }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', errorText);
      let errorMessage = `Gemini API error: ${response.statusText}`;
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error && errorData.error.message) errorMessage = errorData.error.message;
      } catch (e) {}
      if (response.status === 429) errorMessage = 'Rate limit reached. Please wait a minute and try again.';
      return res.status(response.status).json({ error: errorMessage });
    }

    const data = await response.json();
    const textResponse = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

    if (!textResponse) {
      return res.status(500).json({ error: 'No response from Gemini AI.' });
    }

    let quiz;
    try {
      quiz = JSON.parse(textResponse);
    } catch (e) {
      const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(500).json({ error: 'Could not parse quiz from AI response' });
      }
      quiz = JSON.parse(jsonMatch[0]);
    }

    if (!quiz.questions || !Array.isArray(quiz.questions)) {
      return res.status(500).json({ error: 'Invalid quiz format received from AI' });
    }

    return res.status(200).json(quiz);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

function buildPrompt(config) {
  return `You are an expert educator. Generate exactly ${config.numQuestions} questions based on the content.

Context: Board: ${config.board}, Class/Grade: ${config.classLevel}
Question Types: ${config.questionTypes.join(', ')}
Difficulty: ${config.difficulties.join(', ')}
Bloom's Levels: ${config.bloomLevels.join(', ')}

Guidelines:
- MCQ/SCQ: 4 options prefixed "A)", "B)", "C)", "D)"
- TrueFalse: options ["True", "False"]
- Subjective: detailed modelAnswer

${config.textContent ? `\nContent:\n${config.textContent}\n` : ''}

Return JSON only:
{
  "questions": [
    {
      "questionNumber": 1,
      "type": "MCQ",
      "difficulty": "Easy",
      "bloomLevel": "Remember",
      "question": "Question text?",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
      "correctAnswer": "A) Option 1",
      "explanation": "Brief explanation"
    }
  ]
}`;
}
