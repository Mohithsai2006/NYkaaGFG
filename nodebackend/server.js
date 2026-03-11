require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const db = require('./db');
const { runQueryAgent } = require('./agent');

const app = express();
const PORT = process.env.PORT || 8000;
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}));
app.use(express.json());

// Initialize DB on startup
db.init();

// Verify API key
const apiKey = process.env.GEMINI_API_KEY;
if (apiKey && apiKey !== 'paste_your_key_here') {
  const masked = apiKey.slice(0, 8) + '...' + apiKey.slice(-4);
  console.log(`[API] ✅ Gemini API key loaded successfully (${masked})`);
} else {
  console.log('[API] ⚠️ GEMINI_API_KEY not set or invalid! Queries will fail.');
}


/* ── Endpoints ────────────────────────────────────────────────────────── */

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', db_tables: db.getTableNames() });
});

app.get('/api/schema', (req, res) => {
  const schema = db.getSchema();
  const tables = db.getTableNames();
  res.json({ schema, tables });
});

app.post('/api/query', async (req, res) => {
  const { query, conversation_history = [], custom_schema = null } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ detail: 'Query cannot be empty.' });
  }

  try {
    const result = await runQueryAgent(query, conversation_history, custom_schema);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err.message || err), data: [] });
  }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ detail: 'No file uploaded.' });
  }
  if (!req.file.originalname.endsWith('.csv')) {
    return res.status(400).json({ detail: 'Only CSV files are supported.' });
  }

  const csvText = req.file.buffer.toString('utf-8');

  // Derive table name from filename
  let tableName = req.file.originalname
    .replace('.csv', '')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  if (!tableName) tableName = 'uploaded_data';

  try {
    const schema = db.loadCsvFromContent(csvText, tableName);
    const rows = db.executeQuery(`SELECT COUNT(*) as cnt FROM ${tableName}`);
    const rowCount = rows.length > 0 ? Number(rows[0].cnt) : 0;

    res.json({
      success: true,
      db_schema: schema,
      table_name: tableName,
      row_count: rowCount,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

app.get('/', (req, res) => {
  res.json({ message: 'Nykaa BI Dashboard API is running 🚀' });
});

/* ── Start ────────────────────────────────────────────────────────────── */

app.listen(PORT, () => {
  console.log(`[API] Nykaa BI Backend running on http://localhost:${PORT}`);
});
