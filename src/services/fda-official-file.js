const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const yauzl = require('yauzl');
const sax = require('sax');
const {
  cleanText,
  normKey,
  normalizeForDb,
  rowLooksValid,
  isTargetCountry,
  ensureStageTable,
  insertBatch,
  promoteStage
} = require('./fda-official-normalize');

const BATCH_SIZE = Math.max(50, Number(process.env.FDA_OFFICIAL_FILE_BATCH_SIZE || 500));
const HEADER_SCAN_ROWS = Math.max(5, Number(process.env.FDA_OFFICIAL_FILE_HEADER_SCAN_ROWS || 40));

function localName(name = '') {
  return String(name || '').split(':').pop();
}

function colLettersToIndex(letters = '') {
  let n = 0;
  const text = String(letters || '').toUpperCase();
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 65 || code > 90) continue;
    n = n * 26 + (code - 64);
  }
  return Math.max(0, n - 1);
}

function cellRefToColIndex(ref = '', fallback = 0) {
  const m = String(ref || '').match(/^([A-Z]+)/i);
  return m ? colLettersToIndex(m[1]) : fallback;
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) reject(err);
      else resolve(zipfile);
    });
  });
}

async function listZipEntries(filePath) {
  const zipfile = await openZip(filePath);
  return await new Promise((resolve, reject) => {
    const entries = [];
    zipfile.readEntry();
    zipfile.on('entry', entry => {
      entries.push(entry.fileName);
      zipfile.readEntry();
    });
    zipfile.on('end', () => resolve(entries));
    zipfile.on('error', reject);
  });
}

async function withZipEntryStream(filePath, entryName, onStream) {
  const zipfile = await openZip(filePath);
  return await new Promise((resolve, reject) => {
    let found = false;
    zipfile.readEntry();
    zipfile.on('entry', entry => {
      if (entry.fileName !== entryName) {
        zipfile.readEntry();
        return;
      }
      found = true;
      zipfile.openReadStream(entry, (err, stream) => {
        if (err) {
          zipfile.close();
          reject(err);
          return;
        }
        Promise.resolve(onStream(stream))
          .then(result => {
            zipfile.close();
            resolve(result);
          })
          .catch(error => {
            zipfile.close();
            reject(error);
          });
      });
    });
    zipfile.on('end', () => {
      if (!found) resolve(null);
    });
    zipfile.on('error', reject);
  });
}

async function parseXmlEntry(filePath, entryName, configureParser) {
  return await withZipEntryStream(filePath, entryName, stream => new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: false, normalize: false, xmlns: false, lowercase: false });
    configureParser(parser, resolve, reject);
    parser.on('error', err => reject(err));
    stream.on('error', reject);
    stream.pipe(parser);
  }));
}

async function readSharedStrings(filePath, entries = []) {
  if (!entries.includes('xl/sharedStrings.xml')) return [];
  const shared = [];
  console.log('[FDA-OFFICIAL-FILE] Leyendo sharedStrings de Excel...');
  await parseXmlEntry(filePath, 'xl/sharedStrings.xml', (parser, resolve) => {
    let inSi = false;
    let inText = false;
    let parts = [];

    parser.on('opentag', node => {
      const name = localName(node.name);
      if (name === 'si') {
        inSi = true;
        parts = [];
      } else if (inSi && name === 't') {
        inText = true;
      }
    });

    parser.on('text', text => {
      if (inSi && inText) parts.push(text);
    });
    parser.on('cdata', text => {
      if (inSi && inText) parts.push(text);
    });

    parser.on('closetag', nameRaw => {
      const name = localName(nameRaw);
      if (name === 't') inText = false;
      else if (name === 'si') {
        shared.push(parts.join(''));
        inSi = false;
        parts = [];
      }
    });

    parser.on('end', () => resolve());
  });
  return shared;
}

function resolveCellValue(cell, sharedStrings) {
  if (!cell) return '';
  const type = String(cell.type || '');
  if (type === 's') {
    const idx = Number(String(cell.value || '').trim());
    return cleanText(Number.isFinite(idx) ? (sharedStrings[idx] ?? '') : '');
  }
  if (type === 'inlineStr') return cleanText(cell.inline || cell.value || '');
  if (type === 'str') return cleanText(cell.value || cell.inline || '');
  if (type === 'b') return cleanText(cell.value === '1' ? 'TRUE' : cell.value === '0' ? 'FALSE' : cell.value);
  return cleanText(cell.value || cell.inline || '');
}

function rowMapToArray(rowMap) {
  const cols = [...rowMap.keys()].filter(n => Number.isFinite(n));
  if (!cols.length) return [];
  const min = Math.min(...cols, 0);
  const max = Math.max(...cols);
  const out = [];
  for (let c = min; c <= max; c++) out.push(rowMap.get(c) || '');
  return out;
}

function headerScore(headers = []) {
  const text = headers.map(normKey).join(' | ');
  let score = 0;
  if (/firm|legal name|manufacturer/.test(text)) score += 30;
  if (/refus|refused/.test(text)) score += 25;
  if (/product/.test(text)) score += 20;
  if (/country/.test(text)) score += 15;
  if (/charge|violation/.test(text)) score += 10;
  if (/shipment|entry/.test(text)) score += 10;
  return score;
}

function chooseHeaderFromBufferedRows(bufferedRows = []) {
  let best = null;
  for (const item of bufferedRows) {
    const headers = rowMapToArray(item.map);
    const nonEmpty = headers.filter(Boolean).length;
    const score = headerScore(headers);
    if (nonEmpty >= 3 && score > 0 && (!best || score > best.score)) {
      best = { row: item.rowNumber || item.index, headers, score, item };
    }
  }
  return best && best.score >= 45 ? best : null;
}

function rowMapToObject(rowMap, headers = []) {
  const obj = {};
  for (let c = 0; c < headers.length; c++) {
    const header = cleanText(headers[c]);
    if (!header) continue;
    obj[header] = rowMap.get(c) || '';
  }
  return obj;
}

function workbookSheetEntries(entries = []) {
  return entries
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const an = Number((a.match(/sheet(\d+)\.xml/i) || [0, 0])[1]);
      const bn = Number((b.match(/sheet(\d+)\.xml/i) || [0, 0])[1]);
      return an - bn;
    });
}

async function stageSheetXml(filePath, entryName, sharedStrings = []) {
  let totalInserted = 0;
  let batch = [];
  let parsedRows = 0;
  let visitedRows = 0;
  let headerInfo = null;
  const bufferedRows = [];
  let headerFinalized = false;

  function flushBatch() {
    if (!batch.length) return;
    totalInserted += insertBatch(batch);
    batch = [];
  }

  function processDataRow(rowMap) {
    if (!headerInfo || !rowMap || !rowMap.size) return;
    const obj = rowMapToObject(rowMap, headerInfo.headers);
    const parsed = normalizeForDb(obj);
    if (!rowLooksValid(parsed)) return;
    if (!parsed._targetCountryEvidence) return;
    if (!isTargetCountry(parsed.country_name)) return;
    batch.push(parsed);
    parsedRows++;
    if (batch.length >= BATCH_SIZE) flushBatch();
  }

  function finalizeHeaderIfNeeded(force = false) {
    if (headerFinalized) return;
    if (!force && bufferedRows.length < HEADER_SCAN_ROWS) return;
    headerFinalized = true;
    headerInfo = chooseHeaderFromBufferedRows(bufferedRows);
    if (!headerInfo) return;
    console.log(`[FDA-OFFICIAL-FILE] Hoja ${entryName}: encabezados fila ${headerInfo.row}, columnas: ${headerInfo.headers.slice(0, 8).join(', ')}`);
    for (const item of bufferedRows) {
      if ((item.rowNumber || item.index) > headerInfo.row) processDataRow(item.map);
    }
  }

  await parseXmlEntry(filePath, entryName, (parser, resolve, reject) => {
    let inRow = false;
    let currentRowNumber = 0;
    let currentRowMap = new Map();
    let currentCell = null;
    let cellFallbackCol = 0;
    let collectValue = false;
    let collectInline = false;

    parser.on('opentag', node => {
      const name = localName(node.name);
      const attrs = node.attributes || {};
      if (name === 'row') {
        inRow = true;
        visitedRows++;
        currentRowNumber = Number(attrs.r || visitedRows);
        currentRowMap = new Map();
        cellFallbackCol = 0;
        return;
      }
      if (!inRow) return;
      if (name === 'c') {
        const ref = attrs.r || '';
        const col = cellRefToColIndex(ref, cellFallbackCol++);
        currentCell = { col, type: attrs.t || '', value: '', inline: '' };
        return;
      }
      if (!currentCell) return;
      if (name === 'v') {
        collectValue = true;
        currentCell.value = '';
      } else if (name === 't') {
        collectInline = true;
      }
    });

    parser.on('text', text => {
      if (!currentCell) return;
      if (collectValue) currentCell.value += text;
      if (collectInline) currentCell.inline += text;
    });
    parser.on('cdata', text => {
      if (!currentCell) return;
      if (collectValue) currentCell.value += text;
      if (collectInline) currentCell.inline += text;
    });

    parser.on('closetag', nameRaw => {
      const name = localName(nameRaw);
      if (name === 'v') { collectValue = false; return; }
      if (name === 't') { collectInline = false; return; }
      if (name === 'c' && currentCell) {
        const value = resolveCellValue(currentCell, sharedStrings);
        if (value) currentRowMap.set(currentCell.col, value);
        currentCell = null;
        return;
      }
      if (name === 'row' && inRow) {
        inRow = false;
        if (currentRowMap.size) {
          if (!headerFinalized) {
            bufferedRows.push({ rowNumber: currentRowNumber || visitedRows, index: visitedRows, map: currentRowMap });
            finalizeHeaderIfNeeded(false);
          } else {
            processDataRow(currentRowMap);
          }
        }
      }
    });

    parser.on('end', () => {
      try {
        finalizeHeaderIfNeeded(true);
        flushBatch();
        if (!headerInfo) console.log(`[FDA-OFFICIAL-FILE] Hoja omitida sin encabezados FDA: ${entryName}`);
        else console.log(`[FDA-OFFICIAL-FILE] Hoja ${entryName}: ${parsedRows.toLocaleString()} fila(s) SV detectadas.`);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });

  return totalInserted;
}

async function stageXlsx(filePath) {
  ensureStageTable();
  console.log('[FDA-OFFICIAL-FILE] Procesando Excel oficial en modo streaming...');
  const entries = await listZipEntries(filePath);
  const sheetEntries = workbookSheetEntries(entries);
  if (!sheetEntries.length) throw new Error('El XLSX no contiene hojas worksheet legibles');

  const sharedStrings = await readSharedStrings(filePath, entries);
  let totalInserted = 0;
  for (const entryName of sheetEntries) totalInserted += await stageSheetXml(filePath, entryName, sharedStrings);
  sharedStrings.length = 0;
  return totalInserted;
}

async function stageCsv(filePath) {
  ensureStageTable();
  console.log('[FDA-OFFICIAL-FILE] Procesando CSV oficial...');
  let totalInserted = 0;
  let batch = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', row => {
        const parsed = normalizeForDb(row);
        if (!rowLooksValid(parsed) || !parsed._targetCountryEvidence || !isTargetCountry(parsed.country_name)) return;
        batch.push(parsed);
        if (batch.length >= BATCH_SIZE) {
          totalInserted += insertBatch(batch);
          batch = [];
        }
      })
      .on('end', () => {
        try {
          if (batch.length) totalInserted += insertBatch(batch);
          resolve();
        } catch (err) { reject(err); }
      })
      .on('error', reject);
  });
  return totalInserted;
}

async function importOfficialFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const parsed = ['.csv', '.tsv', '.txt'].includes(ext) ? await stageCsv(filePath) : await stageXlsx(filePath);
  const result = promoteStage(parsed, 'manual-official-file');
  result.provider = 'manual-official-file';
  result.legal_safe = true;
  return result;
}

module.exports = {
  stageXlsx,
  stageCsv,
  importOfficialFile,
  promoteStage,
  normalizeForDb
};
