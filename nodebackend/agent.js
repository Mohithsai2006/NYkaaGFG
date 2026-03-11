const { GoogleGenAI } = require('@google/genai');
const { getSchema, executeQuery } = require('./db');
const { SYSTEM_PROMPT, FOLLOWUP_CONTEXT_PROMPT, AMBIGUITY_SYSTEM_NOTE } = require('./prompts');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY not set. Create nodebackend/.env:\n  GEMINI_API_KEY=your_key_here');
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

const VAGUE_QUERIES = [
  'show me everything', "what's interesting", 'what can you show',
  'anything', 'something', 'surprise me', 'show me data',
];

function isVague(query) {
  const q = query.trim().toLowerCase();
  return VAGUE_QUERIES.some((v) => q.includes(v)) || q.length < 10;
}

function extractJson(text) {
  let cleaned = text.trim();
  // Try to extract JSON object from response (handles markdown fences)
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (err) {
      throw new Error(`Could not parse AI response as JSON: ${err.message}\nRaw: ${cleaned.slice(0, 400)}`);
    }
  }
  throw new Error(`No JSON object found in AI response.\nRaw: ${cleaned.slice(0, 400)}`);
}

function validateSql(sql) {
  const normalized = sql.trim().toUpperCase();
  const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC'];
  if (!normalized.startsWith('SELECT')) return false;
  return !forbidden.some((w) => new RegExp(`\\b${w}\\b`).test(normalized));
}

function formatData(rows) {
  if (!rows || rows.length === 0) return [];
  return rows.map((row) => {
    const clean = {};
    for (const [k, v] of Object.entries(row)) {
      clean[k] = v;
    }
    return clean;
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(systemPrompt, userMessage) {
  const MAX_RETRIES = 4;
  const BACKOFF_MS = [2000, 5000, 10000, 20000];

  for (const modelName of CANDIDATE_MODELS) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[Agent] Calling ${modelName}${attempt > 0 ? ` (retry ${attempt})` : ''}...`);

        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            systemPrompt,
            userMessage,
          ],
          config: {
            temperature: 0.1,
          },
        });

        const text = response.text;
        if (text) {
          console.log(`[Agent] ✅ Response received from ${modelName}`);
          return text;
        }
      } catch (err) {
        const errStr = String(err.message || err);

        // Model not found — skip to next model
        if (errStr.includes('NOT_FOUND') || errStr.includes('404') || errStr.includes('not found')) {
          console.log(`[Agent] Model ${modelName} not found, trying next...`);
          break;
        }

        // Rate limited — wait and retry same model
        if (errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('429') || errStr.includes('rate')) {
          if (attempt < MAX_RETRIES) {
            const waitMs = BACKOFF_MS[attempt] || 20000;
            console.log(`[Agent] Rate limited on ${modelName} — retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
            await sleep(waitMs);
            continue;
          }
          console.log(`[Agent] ${modelName} exhausted retries, trying next model...`);
          break;
        }

        // Other error
        throw err;
      }
    }
  }

  throw new Error('⏳ All Gemini models are rate-limited. Please wait 1 minute and try again.');
}

async function runQueryAgent(userQuery, conversationHistory = [], customSchema = null) {
  const schema = customSchema || getSchema();

  if (isVague(userQuery)) {
    userQuery = 'Show top 5 campaign types by total revenue as a bar chart';
  }

  // Build conversation context for follow-ups
  let historyText = '';
  if (conversationHistory && conversationHistory.length > 0) {
    const lines = conversationHistory.slice(-6).map((m) => `${m.role.toUpperCase()}: ${m.content}`);
    historyText = lines.join('\n');
  }

  let system = SYSTEM_PROMPT + AMBIGUITY_SYSTEM_NOTE;
  if (historyText) {
    system += '\n\n' + FOLLOWUP_CONTEXT_PROMPT.replace('{history}', historyText);
  }

  const userMessage =
    `Database Schema:\n${schema}\n\n` +
    `User Question: ${userQuery}\n\n` +
    `Respond ONLY with the JSON object as specified.`;

  // Call Gemini
  let rawText;
  try {
    rawText = await callGemini(system, userMessage);
  } catch (err) {
    return { success: false, error: String(err.message || err), data: [] };
  }

  // Parse JSON
  let aiResult;
  try {
    aiResult = extractJson(rawText);
  } catch (err) {
    return { success: false, error: String(err.message || err), data: [] };
  }

  if (aiResult.cannot_answer) {
    return {
      success: false,
      cannot_answer: true,
      error: aiResult.cannot_answer_reason || "I can't answer this with the available data.",
      data: [],
    };
  }

  const sql = aiResult.sql || '';
  const chartType = aiResult.chart_type || 'bar';
  const xAxis = aiResult.x_axis || '';
  const yAxis = aiResult.y_axis || '';
  const title = aiResult.title || userQuery;
  const insight = aiResult.insight || '';

  if (!validateSql(sql)) {
    return { success: false, error: 'AI generated an unsafe SQL statement. Please rephrase.', data: [] };
  }

  // Execute SQL
  let rows;
  try {
    rows = executeQuery(sql);
  } catch (err) {
    return { success: false, error: String(err.message || err), sql, data: [] };
  }

  if (!rows || rows.length === 0) {
    return {
      success: false,
      cannot_answer: true,
      error: 'Query returned no rows — your filters may be too restrictive.',
      sql,
      data: [],
    };
  }

  const columns = Object.keys(rows[0]);

  return {
    success: true,
    sql,
    chart_type: chartType,
    x_axis: xAxis,
    y_axis: yAxis,
    title,
    insight,
    data: formatData(rows),
    columns,
    row_count: rows.length,
  };
}

module.exports = { runQueryAgent };
