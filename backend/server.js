/**
 * ExamForge Backend — Node.js + Express
 * Handles: PDF parsing via Groq/OpenRouter LLM + Translation via LibreTranslate
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3001;

// ──────────────────────────────────────────
// MIDDLEWARE
// ──────────────────────────────────────────
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));

// Rate limiters
const parseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: { error: 'Too many parse requests. Please wait 15 minutes.' }
});
const translateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: { error: 'Too many translation requests. Please wait 5 minutes.' }
});

// Multer: accept raw text body (PDF text extracted by PDF.js on frontend)
const upload = multer();

// ──────────────────────────────────────────
// CONFIG — Choose LLM provider via env var
// LLM_PROVIDER=groq | openrouter
// ──────────────────────────────────────────
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'groq';

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const LIBRE_TRANSLATE_URL = process.env.LIBRE_TRANSLATE_URL || 'https://libretranslate.com';
const LIBRE_TRANSLATE_KEY = process.env.LIBRE_TRANSLATE_KEY || '';

// ──────────────────────────────────────────
// LLM CALL ABSTRACTION
// ──────────────────────────────────────────
async function callLLM(systemPrompt, userPrompt) {
  if (LLM_PROVIDER === 'groq') {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama3-70b-8192',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 8000
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Groq API error ${res.status}: ${err.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;

  } else if (LLM_PROVIDER === 'openrouter') {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
        'X-Title': 'ExamForge'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'mistralai/mistral-7b-instruct:free',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 8000
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenRouter API error ${res.status}: ${err.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  }

  throw new Error('No valid LLM_PROVIDER configured. Set GROQ_API_KEY or OPENROUTER_API_KEY.');
}

// ──────────────────────────────────────────
// POST /parse-pdf
// Body: { text: "<extracted PDF text>" }
// Returns: { questions: [...] }
// ──────────────────────────────────────────
app.post('/parse-pdf', parseLimiter, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length < 50) {
      return res.status(400).json({ error: 'PDF text is too short or missing.' });
    }

    const systemPrompt = `You are an expert MCQ parser for Indian competitive exam papers (UPSC, SSC, NEET, JEE, GATE, etc.).
Extract ALL multiple-choice questions from the provided text.
Return ONLY a valid JSON array — no markdown, no backticks, no preamble, no explanation outside JSON.
Each object must have exactly this shape:
{
  "question": "Full question text (cleaned, no numbering)",
  "options": { "A": "option text", "B": "option text", "C": "option text", "D": "option text" },
  "correct_answer": "A",
  "explanation": "Brief explanation why the answer is correct"
}
Rules:
- correct_answer must be exactly one of: "A", "B", "C", "D"
- Extract EVERY question present — do not skip any
- If no explanation exists in the source, generate a concise factual one
- Clean up question numbering (remove "Q1.", "1.", "(1)" etc. from question text)
- Map options correctly: if source uses (a)(b)(c)(d) or 1.2.3.4, map to A/B/C/D
- Output ONLY the raw JSON array starting with [ and ending with ]`;

    const userPrompt = `Extract all MCQs from this text:\n\n${text.slice(0, 28000)}`;

    const rawOutput = await callLLM(systemPrompt, userPrompt);

    // Parse JSON robustly
    let parsed;
    try {
      const cleaned = rawOutput.replace(/```json/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const match = rawOutput.match(/\[[\s\S]*\]/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        return res.status(422).json({ error: 'LLM did not return valid JSON. Try a different PDF or re-upload.' });
      }
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return res.status(422).json({ error: 'No MCQs found in this PDF. Ensure the PDF contains MCQ-format questions.' });
    }

    // Validate & clean
    const questions = parsed
      .filter(q => q.question && q.options?.A && q.options?.B && q.options?.C && q.options?.D && ['A','B','C','D'].includes(q.correct_answer))
      .map((q, i) => ({
        id: i,
        question_en: String(q.question).trim(),
        options_en: {
          A: String(q.options.A).trim(),
          B: String(q.options.B).trim(),
          C: String(q.options.C).trim(),
          D: String(q.options.D).trim()
        },
        correct_answer: q.correct_answer,
        explanation_en: q.explanation ? String(q.explanation).trim() : `The correct answer is ${q.correct_answer}: ${q.options[q.correct_answer]}.`,
        // Hindi fields — populated on demand via /translate
        question_hi: null,
        options_hi: null,
        explanation_hi: null
      }));

    res.json({ questions, total: questions.length, provider: LLM_PROVIDER });

  } catch (err) {
    console.error('[/parse-pdf]', err.message);
    res.status(500).json({ error: err.message || 'Internal server error during parsing.' });
  }
});

// ──────────────────────────────────────────
// POST /translate
// Body: { questions: [...], targetLang: "hi" }
// Returns: { questions: [...] } with _hi fields populated
// ──────────────────────────────────────────
app.post('/translate', translateLimiter, async (req, res) => {
  try {
    const { questions, targetLang = 'hi' } = req.body;

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'No questions provided for translation.' });
    }

    // Strategy: batch translate via LLM (free, no separate API needed)
    // Translate all questions in one call for efficiency
    const BATCH_SIZE = 15; // translate 15 questions per LLM call

    const translated = [...questions];

    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE);

      const toTranslate = batch.map((q, idx) => ({
        idx: i + idx,
        question: q.question_en,
        options: q.options_en,
        explanation: q.explanation_en
      }));

      const systemPrompt = `You are a professional Hindi translator specializing in academic and competitive exam content.
Translate the given JSON from English to Hindi accurately.
Preserve technical terms, proper nouns, numbers, formulas, and chemical symbols as-is.
Return ONLY a valid JSON array with the same structure — no markdown, no backticks.
Each object: { "idx": number, "question": "...", "options": {"A":"...","B":"...","C":"...","D":"..."}, "explanation": "..." }`;

      const userPrompt = `Translate to Hindi:\n${JSON.stringify(toTranslate)}`;

      const rawOutput = await callLLM(systemPrompt, userPrompt);

      let batchResult;
      try {
        const cleaned = rawOutput.replace(/```json/g, '').replace(/```/g, '').trim();
        batchResult = JSON.parse(cleaned);
      } catch {
        const match = rawOutput.match(/\[[\s\S]*\]/);
        if (match) batchResult = JSON.parse(match[0]);
        else throw new Error('Translation LLM returned invalid JSON.');
      }

      batchResult.forEach(item => {
        const idx = item.idx;
        if (translated[idx]) {
          translated[idx].question_hi = item.question || translated[idx].question_en;
          translated[idx].options_hi = item.options || translated[idx].options_en;
          translated[idx].explanation_hi = item.explanation || translated[idx].explanation_en;
        }
      });
    }

    res.json({ questions: translated });

  } catch (err) {
    console.error('[/translate]', err.message);
    res.status(500).json({ error: err.message || 'Translation failed.' });
  }
});

// ──────────────────────────────────────────
// HEALTH CHECK
// ──────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', provider: LLM_PROVIDER, time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n🚀 ExamForge Backend running on port ${PORT}`);
  console.log(`   LLM Provider : ${LLM_PROVIDER}`);
  console.log(`   Health check : http://localhost:${PORT}/health\n`);
});
