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
      classLevel,
      language
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
      textContent,
      language
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

    // Try multiple models in order: Flash (best quality) → Flash-Lite (more reliable fallback)
    const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

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

    // Attempt each model, retry on overload errors
    let response = null;
    let lastErrorText = '';
    let lastStatus = 0;

    for (const model of MODELS) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      // Try up to 2 times per model (with short delay between)
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });

          if (response.ok) {
            console.log(`Success with ${model} on attempt ${attempt}`);
            break;
          }

          lastStatus = response.status;
          lastErrorText = await response.text();
          console.warn(`${model} attempt ${attempt} failed: ${response.status}`);

          // If it's an overload (503) or rate limit (429), retry / try next model
          // If it's a client error (400), don't bother retrying
          if (response.status === 400 || response.status === 401 || response.status === 403) {
            break; // skip to error handling
          }

          // Wait 1 second before retry
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 1000));
          }
        } catch (fetchErr) {
          lastErrorText = fetchErr.message;
          console.warn(`Fetch error for ${model}:`, fetchErr.message);
        }
      }

      if (response && response.ok) break; // success, stop trying other models
    }

    if (!response || !response.ok) {
      console.error('All models failed. Last error:', lastErrorText);

      let errorMessage = `Gemini API error: ${lastStatus || 'Unknown'}`;
      try {
        const errorData = JSON.parse(lastErrorText);
        if (errorData.error && errorData.error.message) {
          errorMessage = errorData.error.message;
        }
      } catch (e) {
        // ignore
      }

      // Friendly error messages
      if (lastStatus === 429) {
        errorMessage = 'Rate limit reached. Please wait a minute and try again.';
      } else if (lastStatus === 400 && errorMessage.indexOf('API key') !== -1) {
        errorMessage = 'Invalid API key. Please check your GEMINI_API_KEY in Vercel settings.';
      } else if (lastStatus === 503 || errorMessage.toLowerCase().includes('overload') || errorMessage.toLowerCase().includes('high demand')) {
        errorMessage = 'Gemini servers are currently overloaded. Please try again in a moment.';
      }

      return res.status(lastStatus || 500).json({ error: errorMessage });
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
  const language = config.language || 'English';
  
  // Calculate TYPE distribution
  let distributionNote = '';
  if (config.questionTypes.length === 1) {
    distributionNote = `ALL ${numQuestions} questions MUST be of type "${config.questionTypes[0]}". Do NOT include any other question type.`;
  } else {
    const perType = Math.floor(numQuestions / config.questionTypes.length);
    const remainder = numQuestions % config.questionTypes.length;
    distributionNote = `Distribute the ${numQuestions} questions roughly equally across ONLY these types: ${allowedTypes}. Approximately ${perType} questions per type${remainder > 0 ? ` (extra questions can go to any of the selected types)` : ''}.`;
  }

  // Calculate DIFFICULTY distribution (balanced mix)
  let difficultyDistribution = '';
  const diffCount = config.difficulties.length;
  if (diffCount === 1) {
    difficultyDistribution = `ALL ${numQuestions} questions MUST be of difficulty "${config.difficulties[0]}".`;
  } else {
    const perDiff = Math.floor(numQuestions / diffCount);
    const extraDiff = numQuestions % diffCount;
    const diffBreakdown = config.difficulties.map((d, idx) => {
      const count = perDiff + (idx < extraDiff ? 1 : 0);
      return `${count} "${d}"`;
    }).join(', ');
    difficultyDistribution = `BALANCE the difficulty mix across all selected levels. Distribute approximately: ${diffBreakdown}. Do NOT generate all questions at one difficulty level — spread them evenly across: ${config.difficulties.join(', ')}.`;
  }

  // Calculate BLOOM'S distribution (balanced mix)
  let bloomDistribution = '';
  const bloomCount = config.bloomLevels.length;
  if (bloomCount === 1) {
    bloomDistribution = `ALL ${numQuestions} questions MUST be at Bloom's level "${config.bloomLevels[0]}".`;
  } else {
    const perBloom = Math.floor(numQuestions / bloomCount);
    const extraBloom = numQuestions % bloomCount;
    const bloomBreakdown = config.bloomLevels.map((b, idx) => {
      const count = perBloom + (idx < extraBloom ? 1 : 0);
      return `${count} "${b}"`;
    }).join(', ');
    bloomDistribution = `BALANCE the Bloom's Taxonomy levels across all selected. Distribute approximately: ${bloomBreakdown}. Spread cognitive levels evenly across: ${config.bloomLevels.join(', ')}.`;
  }

  // Language instruction
  const languageNote = language === 'English' 
    ? '' 
    : `\n============================\nLANGUAGE REQUIREMENT (IMPORTANT)\n============================\n\nGenerate ALL content in ${language}. This includes:\n- The "question" field\n- All options in the "options" array\n- The "correctAnswer" field\n- The "explanation" field\n- The "modelAnswer" field (for Subjective questions)\n\nHowever, KEEP these fields in English:\n- "type" (e.g., "MCQ", "Subjective")\n- "difficulty" (e.g., "Easy", "Medium", "Hard")\n- "bloomLevel" (e.g., "Remember", "Understand")\n- "questionNumber"\n\nUse natural, grammatically correct ${language}. For technical/scientific terms, you may use English terminology where appropriate (e.g., "photosynthesis" is universally understood).\n`;

  return `You are an expert educator creating an educational quiz. Generate exactly ${numQuestions} high-quality questions.

============================
CRITICAL RULES — MUST FOLLOW
============================

1. QUESTION TYPE RULE (MOST IMPORTANT):
   The "type" field in every question MUST be EXACTLY one of these values ONLY:
   ${config.questionTypes.map(t => `   - "${t}"`).join('\n')}
   
   ${distributionNote}
   
   DO NOT create questions with any type not listed above.

2. DIFFICULTY DISTRIBUTION RULE:
   Allowed difficulty values: ${config.difficulties.join(', ')}
   
   ${difficultyDistribution}

3. BLOOM'S TAXONOMY DISTRIBUTION RULE:
   Allowed Bloom's values: ${config.bloomLevels.join(', ')}
   
   ${bloomDistribution}
${languageNote}
============================
EDUCATIONAL CONTEXT
============================
- Board: ${config.board}
- Class/Grade: ${config.classLevel}
- Language: ${language}

============================
QUESTION QUALITY RULES (VERY IMPORTANT)
============================

For MCQ and SCQ questions, the 4 options MUST be:

✓ GOOD MCQ OPTIONS (what you MUST do):
- Each option is a meaningful, distinct concept or answer
- All options should be plausible (not obviously wrong)
- Options should be similar in length and style
- Test actual understanding of the subject

✗ BAD MCQ OPTIONS (what you MUST AVOID):
- NEVER use Yes/No style: ["Yes", "No", "Maybe", "Not sure"] ❌
- NEVER use True/False style: ["True", "False", "Cannot say", "Partially true"] ❌
- NEVER use filler options: ["All of the above", "None of the above"] alone ❌
- NEVER use nonsense distractors that no student would pick ❌

Examples of GOOD MCQ options:

Q: What is photosynthesis?
A) Process of converting light energy into chemical energy in plants
B) Process of breaking down glucose for energy
C) Process of water absorption by plant roots
D) Process of cell division in plant tissues

Q: What is the value of 2x² + 3x - 5 when x = 2?
A) 9
B) 11
C) 13
D) 15

Examples of BAD MCQ options (DO NOT DO THIS):

Q: Is photosynthesis important?  ← This should be True/False, not MCQ!
A) Yes
B) No
C) Maybe  
D) Sometimes

If a question naturally has only 2 answers (yes/no, true/false, right/wrong), make it a "TrueFalse" type instead of forcing 4 fake options.

============================
QUESTION FORMAT RULES
============================

• "MCQ" (Multiple Choice):
  - MUST have "options" array with exactly 4 items: ["A) ...", "B) ...", "C) ...", "D) ..."]
  - ALL 4 options must be substantive answers (NOT Yes/No/Maybe)
  - MUST have "correctAnswer" matching one of the options exactly
  - MUST have "explanation" field

• "SCQ" (Single Choice):
  - Same format as MCQ: 4 substantive options, one correct answer
  - ALL 4 options must be substantive answers (NOT Yes/No/Maybe)
  - MUST have "explanation" field

• "TrueFalse":
  - "options" MUST be exactly ["True", "False"] (keep these in English even if language is different)
  - "correctAnswer" MUST be exactly "True" or "False"
  - MUST have "explanation" field
  - USE THIS when the question is inherently binary (yes/no, right/wrong)

• "Subjective" (open-ended, essay-type):
  - MUST NOT have "options" field
  - MUST NOT have "correctAnswer" field
  - MUST have "modelAnswer" field with detailed answer (2-4 sentences minimum)

============================
MATH & SCIENCE NOTATION
============================

For mathematical and scientific content, use these formatting conventions:
- Use ^ for superscripts: x^2 means x squared, 10^3 means 10 cubed
- Use _ for subscripts: H_2O means water, x_1 means x-sub-1
- Use * for multiplication (not ×)
- Use / for division (or fractions)
- For complex expressions, group with braces: x^{10}, H_{2}O
- Use standard symbols: π, ∞, ≤, ≥, ≠, ± where appropriate
- Chemical formulas: H_2SO_4, CO_2, Ca(OH)_2

Examples:
- "Solve the equation x^2 + 5x + 6 = 0"
- "What is the molecular formula of water? H_2O"
- "Find the derivative of f(x) = x^3 + 2x^2"

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

FINAL REMINDER: Every question's "type" field MUST be one of [${allowedTypes}] — NOTHING else.${language !== 'English' ? ` All content (questions, options, answers, explanations) MUST be in ${language}.` : ''}`;
}
