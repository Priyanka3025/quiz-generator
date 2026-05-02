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
RULE #0 — MOST IMPORTANT RULE
============================

Every text field you generate — the question field, the options, the explanation field, the modelAnswer field, and the correctAnswer field — must read as a pure, standalone educational artifact. Nothing should hint that there is any source material behind the scenes.

The question must be a pure, standalone educational question that stands completely on its own — exactly as it would appear in a textbook, exam paper, or worksheet. The explanation must read like a normal textbook explanation. The model answer must read like a normal textbook answer. None of these fields may reference how the question was created or what material was used to create it.

DO NOT include ANY of the following phrases ANYWHERE in any generated field (question, options, explanation, modelAnswer, correctAnswer):
- "according to..."
- "as mentioned..."
- "as stated..."
- "as highlighted..."
- "as given..."
- "as shown..."
- "as per..."
- "based on..."
- "as described..."
- "as explained..."
- "as outlined..."
- "as discussed..."
- "as noted..."
- "as written..."
- "from the text/passage/PDF/document/content/chapter/paragraph/extract/source/article/lesson/book/transcript/video"
- "in the text/passage/PDF/document/content/chapter/paragraph/extract/source/article/lesson/book/transcript/video"
- "the text says", "the passage says", "the author says", "the document states"
- "the transcript indicates", "the transcript says", "the video shows", "the video explains"
- "referring to..."
- "following the..."
- "highlighted in..."
- "referenced in..."
- Any mention of: text, passage, document, PDF, content, extract, chapter, paragraph, article, author, source, lesson, reading, material, above, below, given, provided, transcript, video, recording, audio
- Any phrase that would not appear in a standard textbook question or textbook explanation

CRITICAL CONTEXT FOR UPLOADED CONTENT: When a teacher uploads a PDF or video transcript, the uploaded material is YOUR private input. Students will only see the final quiz. They have no idea a transcript or PDF exists. Writing "the transcript indicates that..." or "according to the video..." would be like a chef writing a recipe that says "as shown in the supermarket where I bought these ingredients" — completely out of place in the final product. The student must not be able to tell whether the quiz was generated from a textbook, a video, a PDF, or your general knowledge. All four sources should produce identical-looking output in terms of style and self-containedness.

WRONG (these are all FORBIDDEN — do NOT do this):
❌ Question: "According to the text, what is photosynthesis?"
❌ Question: "What is photosynthesis, as mentioned in the passage?"
❌ Question: "What is the main message conveyed by the author, according to the text?"
❌ Explanation: "The transcript indicates that this developed gradually."
❌ Explanation: "As stated in the video, the process began at age 11."
❌ ModelAnswer: "Based on the passage, the main idea is..."
❌ Explanation: "The text shows that this was first noticed when..."

CORRECT (this is what you MUST do):
✓ Question: "What is photosynthesis?"
✓ Question: "What is the main message conveyed in the story?"
✓ Explanation: "Hearing loss developed gradually and was first noticed at age 11."
✓ Explanation: "The condition began at birth and worsened over time."
✓ ModelAnswer: "The main idea centers on the importance of perseverance..."

THE TEST: Read each generated field aloud. If anything in the question, explanation, or answer hints that there is a source somewhere, rewrite it as a clean statement about the CONCEPT itself. The reader must believe these came from a textbook author who simply knows the subject — not from someone summarizing a specific document.

You are generating questions as if writing a standalone exam paper. The student does NOT have access to "the text" or "the passage" or "the transcript" — they must answer from their knowledge of the subject. Write every field accordingly.

============================
OTHER CRITICAL RULES
============================

1. QUESTION TYPE RULE:
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
${config.textContent && (config.textContent.includes('UPLOADED SOURCE MATERIAL') || config.textContent.includes('PDF CONTENT TO USE AS SOURCE')) ? `CONTENT SCOPE RULE (CRITICAL — HIGHEST PRIORITY)
============================

The teacher has uploaded source material below (a PDF, video subtitles, or both). The uploaded material defines BOTH the facts you may use AND the scope of concepts you may test. The teacher uploaded this specific material because it represents what students have actually been taught so far. Going beyond it would test material students have not yet learned, which is harmful.

You MUST follow these rules:

1. Source of facts: Generate questions STRICTLY from concepts, facts, and topics covered in the uploaded source material ONLY. Do NOT use your general knowledge about the named chapter to introduce facts that are not in the upload.

2. Scope of concepts (most important): Test ONLY concepts that are actually discussed in the uploaded material. If a concept belongs to the named chapter but is NOT covered in the upload, do NOT include any question about it. For example, if the chapter is "Motion" and the upload covers only distance, displacement, and speed, do NOT create questions about acceleration or equations of motion — even though those concepts belong to the Motion chapter, students have not yet been taught them from this material.

3. Topic mismatch: If the uploaded content is about a completely different subject than the chapter name suggests, follow the uploaded content. The uploaded material is the authoritative source.

4. Derivability: Every question's answer must be derivable from or directly supported by the uploaded content.

5. Conceptual focus: Focus on the CONCEPTS in the uploaded material — not on its specific wording or phrasing.

6. REMEMBER RULE #0: Write questions as pure standalone questions. Never reference "the PDF", "the transcript", "the video", "the text", "the passage", etc.

Before writing each question, silently check: "Is this specific concept actually discussed in the uploaded material below?" If the honest answer is no, pick a different concept that IS in the material.

Example:
- If the uploaded material covers: Photosynthesis, chlorophyll, light reactions
- ✓ Good: "What is the role of chlorophyll in photosynthesis?"
- ✗ Bad: "What is meiosis?" (not in the uploaded content at all)
- ✗ Bad: "What is the dark reaction?" (belongs to photosynthesis chapter but is not in this specific upload, so students have not yet learned it)
- ✗ Bad: "According to the video, what does chlorophyll do?" (violates Rule #0)

============================
CONTENT (USE THIS AS YOUR SCOPE)
============================` : `CONTENT SCOPE
============================

Generate questions from your general knowledge about the specified subject/chapter. Keep questions relevant to what a student of that class/grade would be expected to know.

============================
CONTEXT`}
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

FINAL REMINDERS BEFORE YOU GENERATE:

1. RULE #0: Every generated text field — "question", "explanation", "modelAnswer", and all "options" — must be a STANDALONE statement. ZERO references to "the text", "passage", "document", "PDF", "content", "transcript", "video", "above", "highlighted", "mentioned", "stated", "according to", "based on", "as per", etc. Write everything as if for a standalone exam paper where the student has never seen any source material.

2. Every question's "type" field MUST be one of [${allowedTypes}] — NOTHING else.${language !== 'English' ? `

3. All content (questions, options, answers, explanations) MUST be in ${language}.` : ''}

Now generate the JSON output.`;
}
