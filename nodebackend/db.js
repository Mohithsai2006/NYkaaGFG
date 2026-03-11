const fs = require('fs');
const path = require('path');
const alasql = require('alasql');
const Papa = require('papaparse');

const CSV_PATH = path.join(__dirname, '..', 'Nykaa Digital Marketing.csv');
const TABLE_NAME = 'campaigns';

let _currentSchema = '';
let _initialized = false;

/* ── helpers ────────────────────────────────────────────────────────── */

function cleanColumnName(name) {
  return name.trim().replace(/[\s-]+/g, '_');
}

function cleanDataFrame(rows, columns) {
  return rows.map((row) => {
    const clean = {};
    for (const col of columns) {
      let val = row[col];
      // Try to parse numbers
      if (val !== null && val !== undefined && val !== '') {
        const num = Number(val);
        if (!isNaN(num) && String(val).trim() !== '') {
          val = num;
        }
      }
      // Normalize dates
      if (col.toLowerCase().includes('date') && typeof val === 'string') {
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
          val = d.toISOString().split('T')[0]; // YYYY-MM-DD
        }
      }
      clean[col] = val;
    }
    return clean;
  });
}

function buildSchema(tableName, rows, columns) {
  const lines = [`Table: ${tableName}`, 'Columns:'];
  for (const col of columns) {
    const samples = rows
      .slice(0, 3)
      .map((r) => r[col])
      .filter((v) => v !== null && v !== undefined);
    const sampleType = typeof samples[0] === 'number' ? 'number' : 'string';
    lines.push(`  - ${col} (${sampleType}): e.g. ${samples.join(', ')}`);
  }
  return lines.join('\n');
}

/* ── core functions ─────────────────────────────────────────────────── */

/**
 * Strip macOS binary plist wrapper or other binary prefixes from CSV files.
 * Uses direct string search for the CSV header row.
 */
function stripBinaryPrefix(content) {
  // Directly search for known header pattern "Campaign_ID"
  let idx = content.indexOf('Campaign_ID');
  
  // Fallback: find any pattern like "Word_Word,Word_Word," (CSV header-like)
  if (idx < 0) {
    const m = content.match(/[A-Z][a-z]+_[A-Z][A-Za-z]+,[A-Z][a-z]+_[A-Z][A-Za-z]+,/);
    if (m && m.index !== undefined) idx = m.index;
  }

  if (idx > 0) {
    const cleaned = content.substring(idx);
    console.log(`[DB] Stripped ${idx} bytes of binary prefix from CSV.`);
    return cleaned;
  }

  return content;
}

function init() {
  if (_initialized) return;
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Default CSV not found at ${CSV_PATH}`);
  }
  let csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
  csvContent = stripBinaryPrefix(csvContent);
  loadCsvFromContent(csvContent, TABLE_NAME);
  _initialized = true;
  console.log(`[DB] Loaded default CSV into '${TABLE_NAME}' table.`);
}

function loadCsvFromContent(csvContent, tableName = 'user_data') {
  const parsed = Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  // Clean column names
  const rawCols = parsed.meta.fields || [];
  const cleanCols = rawCols.map(cleanColumnName);

  // Rename columns in data
  const rows = parsed.data.map((row) => {
    const clean = {};
    rawCols.forEach((raw, i) => {
      clean[cleanCols[i]] = row[raw];
    });
    return clean;
  });

  const cleanedRows = cleanDataFrame(rows, cleanCols);

  // Drop existing table if any
  try {
    alasql(`DROP TABLE IF EXISTS ${tableName}`);
  } catch (_) {}

  // Create table and insert
  if (cleanedRows.length > 0) {
    // Build CREATE TABLE
    const colDefs = cleanCols
      .map((col) => {
        const sample = cleanedRows.find((r) => r[col] !== null && r[col] !== undefined);
        const type = sample && typeof sample[col] === 'number' ? 'NUMBER' : 'STRING';
        return `[${col}] ${type}`;
      })
      .join(', ');
    alasql(`CREATE TABLE ${tableName} (${colDefs})`);
    alasql(`INSERT INTO ${tableName} SELECT * FROM ?`, [cleanedRows]);
  }

  _currentSchema = buildSchema(tableName, cleanedRows, cleanCols);
  console.log(`[DB] Loaded ${cleanedRows.length} rows into '${tableName}'.`);
  return _currentSchema;
}

function getSchema() {
  init();
  return _currentSchema;
}

function executeQuery(sql) {
  init();
  try {
    const result = alasql(sql);
    // alasql returns array of objects for SELECT
    if (!Array.isArray(result)) return [];
    return result;
  } catch (err) {
    throw new Error(`SQL execution error: ${err.message}`);
  }
}

function getTableNames() {
  init();
  try {
    const tables = alasql('SHOW TABLES');
    return tables.map((t) => t.tableid);
  } catch (_) {
    return [TABLE_NAME];
  }
}

module.exports = { init, getSchema, executeQuery, loadCsvFromContent, getTableNames };
