// Vercel Serverless Function - Google Gemini API
// Uses Gemini 2.5 Flash (free tier) to generate quizzes

module.exports = async function handler(req, res) {
  // Set CORS headers
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
    const {
      pdfBase64,
      textContent,
      numQuestions,
      questionTypes,
      difficulties,
      bloomLevels,
      board,
      classLevel
    } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY not configured on server. Please add it in Vercel environment variables.'
      });
    }

    const prompt = buildPrompt({
      numQuestions,
      questionTypes,
      difficulties,
      bloomLevels,
      board,
      classLevel,
      textContent
    });

    const parts = [];

    if (pdfBase64) {
      parts.push({
        inline_data: {
          mime_type: 'application/pdf',
          data: pdfBase64
        }
      });
    }

    parts.push({ text: prompt });

    const MODEL = 'gemini-2.5-flash';
    const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: parts
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    };

    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', errorText);

      let errorMessage = `Gemini API error: ${response.statusText}`;
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error && errorData.error.message) {
          errorMessage = errorData.error.message;
        }
      } catch (e) {
        // ignore
      }

      if (response.status === 429) {
        errorMessage = 'Rate limit reached. Please wait a minute and try again. (Free tier: 10 requests/min, 250/day)';
      } else if (response.status === 400 && errorMessage.indexOf('API key') !== -1) {
        errorMessage = 'Invalid API key. Please check your GEMINI_API_KEY in Vercel settings.';
      }

      return res.status(response.status).json({ error: errorMessage });
    }

    const data = await response.json();
    const textResponse = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

    if (!textResponse) {
      console.error('Unexpected Gemini response:', JSON.stringify(data));
      return res.status(500).json({
        error: 'No response from Gemini AI. The model may have been blocked due to content filters.'
      });
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
  const allowedTypes = config.questionTypes.join(', ');
  const numQuestions = parseInt(config.numQuestions);
  
  // Calculate distribution guidance
  let distributionNote = '';
  if (config.questionTypes.length === 1) {
    distributionNote = `ALL ${numQuestions} questions MUST be of type "${config.questionTypes[0]}". Do NOT include any other question type.`;
  } else {
    const perType = Math.floor(numQuestions / config.questionTypes.length);
    const remainder = numQuestions % config.questionTypes.length;
    distributionNote = `Distribute the ${numQuestions} questions roughly equally across ONLY these types: ${allowedTypes}. Approximately ${perType} questions per type${remainder > 0 ? ` (extra questions can go to any of the selected types)` : ''}.`;
  }

  return `You are an expert educator creating an educational quiz. Generate exactly ${numQuestions} questions.

============================
CRITICAL RULES — MUST FOLLOW
============================

1. QUESTION TYPE RULE (MOST IMPORTANT):
   The "type" field in every question MUST be EXACTLY one of these values ONLY:
   ${config.questionTypes.map(t => `   - "${t}"`).join('\n')}
   
   ${distributionNote}
   
   DO NOT create questions with any type not listed above. If "Subjective" is NOT in the list, do NOT create subjective/essay questions. If "MCQ" is NOT in the list, do NOT create multiple choice questions.

2. Difficulty levels allowed: ${config.difficulties.join(', ')}
   Every question's "difficulty" field MUST be one of these values.

3. Bloom's Taxonomy levels allowed: ${config.bloomLevels.join(', ')}
   Every question's "bloomLevel" field MUST be one of these values.

============================
EDUCATIONAL CONTEXT
============================
- Board: ${config.board}
- Class/Grade: ${config.classLevel}

============================
QUESTION FORMAT RULES
============================

For each TYPE, follow these formats STRICTLY:

• "MCQ" (Multiple Choice — multiple correct answers possible, but for simplicity treat as one):
  - MUST have "options" array with exactly 4 items: ["A) ...", "B) ...", "C) ...", "D) ..."]
  - MUST have "correctAnswer" matching one of the options exactly
  - MUST have "explanation" field

• "SCQ" (Single Choice — exactly one correct answer):
  - Same format as MCQ: 4 options, one correct answer
  - MUST have "explanation" field

• "TrueFalse":
  - "options" MUST be exactly ["True", "False"]
  - "correctAnswer" MUST be exactly "True" or "False"
  - MUST have "explanation" field

• "Subjective" (open-ended, essay-type):
  - MUST NOT have "options" field
  - MUST NOT have "correctAnswer" field
  - MUST have "modelAnswer" field with detailed answer (2-4 sentences minimum)

============================
CONTENT
============================
${config.textContent || 'Generate questions from your general knowledge of this subject/chapter.'}

============================
OUTPUT FORMAT
============================

Return ONLY a valid JSON object. No markdown, no backticks, no explanation text before or after. Start with { and end with }.

Structure:
{
  "questions": [
    {
      "questionNumber": 1,
      "type": "<must be one of: ${allowedTypes}>",
      "difficulty": "<must be one of: ${config.difficulties.join(', ')}>",
      "bloomLevel": "<must be one of: ${config.bloomLevels.join(', ')}>",
      "question": "The actual question text?",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correctAnswer": "A) ...",
      "explanation": "Why this is correct"
    }
  ]
}

For Subjective questions, use this structure instead:
{
  "questionNumber": N,
  "type": "Subjective",
  "difficulty": "...",
  "bloomLevel": "...",
  "question": "Explain/Describe/Analyze...",
  "modelAnswer": "Detailed model answer with key points explaining the concept thoroughly..."
}

FINAL REMINDER: Every question's "type" field MUST be one of [${allowedTypes}] — NOTHING else.`;
}
