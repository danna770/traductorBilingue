const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3080;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'vocab.json');
const INDEX_FILE = path.join(__dirname, 'index.html');

const PREPOSITIONS = new Set([
  'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around',
  'as', 'at', 'before', 'behind', 'below', 'beneath', 'beside', 'between',
  'beyond', 'by', 'despite', 'down', 'during', 'except', 'for', 'from',
  'in', 'inside', 'into', 'like', 'near', 'of', 'off', 'on', 'onto',
  'out', 'outside', 'over', 'past', 'regarding', 'since', 'through',
  'throughout', 'to', 'toward', 'towards', 'under', 'until', 'up', 'upon',
  'with', 'within', 'without'
]);

const GENERIC_PREPS = new Set(['of', 'in', 'to', 'for', 'with', 'on', 'at', 'by', 'from', 'as']);

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      sections: [
        { id: 'sec-trabajo', name: 'Trabajo y Reuniones', color: 'yellow' },
        { id: 'sec-lectura', name: 'Lectura Actual', color: 'sky' },
        { id: 'sec-phrasal', name: 'Phrasal Verbs', color: 'mint' }
      ],
      words: [],
      recent: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      words: Array.isArray(parsed.words) ? parsed.words : [],
      recent: Array.isArray(parsed.recent) ? parsed.recent : []
    };
  } catch (err) {
    return { sections: [], words: [], recent: [] };
  }
}

function writeData(payload) {
  ensureDataFile();
  const safe = {
    sections: Array.isArray(payload.sections) ? payload.sections : [],
    words: Array.isArray(payload.words) ? payload.words : [],
    recent: Array.isArray(payload.recent) ? payload.recent.slice(0, 20) : []
  };
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(safe, null, 2), 'utf8');
  fs.renameSync(tmpFile, DATA_FILE);
  return safe;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function looksSpanish(text) {
  const lower = text.toLowerCase().trim();
  if (/[áéíóúüñ¿¡]/i.test(lower)) return true;
  const spanishEndings = /(ción|sión|dad|tad|mente|ando|iendo|ar|er|ir|aje|eza|oso|osa|ísimo|ísima)$/i;
  const words = lower.split(/\s+/);
  if (words.length === 1 && spanishEndings.test(words[0]) && words[0].length > 4) return true;
  return false;
}

function fpmToScore(fpm) {
  if (!Number.isFinite(fpm) || fpm <= 0) return 45;
  const score = Math.round(22 * Math.log10(fpm + 1) + 28);
  return Math.max(12, Math.min(99, score));
}

async function fetchJsonSafe(url, options = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function translateMyMemory(text, from, to) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
  const data = await fetchJsonSafe(url);
  if (!data || !data.responseData) return null;
  const main = (data.responseData.translatedText || '').trim();
  const alts = [];
  if (Array.isArray(data.matches)) {
    for (const m of data.matches) {
      const t = (m.translation || '').trim();
      if (t && t.toLowerCase() !== main.toLowerCase() && !alts.includes(t)) {
        alts.push(t);
      }
      if (alts.length >= 3) break;
    }
  }
  return { main, alts };
}

function extractPrepositionsFromText(word, texts) {
  const found = new Set();
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}(?:s|ed|ing)?\\s+(${Array.from(PREPOSITIONS).join('|')})\\b`, 'gi');
  for (const txt of texts) {
    if (!txt) continue;
    let match;
    while ((match = pattern.exec(txt)) !== null) {
      found.add(match[1].toLowerCase());
    }
  }
  return Array.from(found);
}

async function callAI({ provider, apiKey, prompt }) {
  if (!apiKey) return null;
  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
    };
    const data = await fetchJsonSafe(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 12000);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }
  if (provider === 'openai') {
    const url = 'https://api.openai.com/v1/chat/completions';
    const body = {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are a precise bilingual EN-ES lexicographer. Respond only with valid JSON.' },
        { role: 'user', content: prompt }
      ]
    };
    const data = await fetchJsonSafe(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    }, 12000);
    const text = data?.choices?.[0]?.message?.content;
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }
  return null;
}

async function handleTranslate(body) {
  const query = String(body.query || '').trim();
  const direction = body.direction || 'auto';
  if (!query) throw new Error('Empty query');

  const envGemini = process.env.GEMINI_API_KEY || '';
  const envOpenAI = process.env.OPENAI_API_KEY || '';
  const aiProvider = body.aiProvider || (envGemini ? 'gemini' : envOpenAI ? 'openai' : '');
  const aiKey = body.aiKey || (aiProvider === 'gemini' ? envGemini : aiProvider === 'openai' ? envOpenAI : '');

  if (aiProvider && aiKey) {
    const aiPrompt = `Analyze the term "${query}" (direction hint: ${direction}) for a Spanish-speaking reader reading in English (work & everyday contexts).
Return strictly JSON with keys:
{
  "detectedDir": "en-es" or "es-en",
  "en": "canonical English word or expression",
  "es": "clear natural Spanish translation (1-3 concise equivalents separated by /)",
  "pos": "part of speech in English (e.g. verb, noun, adjective, phrasal verb)",
  "phonetic": "IPA phonetic if helpful or empty string",
  "defEn": "clear concise definition in English (max 22 words)",
  "defEs": "clear concise definition in Spanish (max 22 words)",
  "exampleEn": "natural everyday or workplace example sentence in English",
  "exampleEs": "natural Spanish translation of exampleEn",
  "prepositions": ["array of common prepositions strictly collocated with the English word, empty [] if none"],
  "freq": integer 1-100 representing frequency in everyday & workplace English (100 = most common)
}`;
    const aiRes = await callAI({ provider: aiProvider, apiKey: aiKey, prompt: aiPrompt });
    if (aiRes && aiRes.en && aiRes.es) {
      return {
        source: `ai:${aiProvider}`,
        detectedDir: aiRes.detectedDir || (direction === 'es-en' ? 'es-en' : 'en-es'),
        en: String(aiRes.en).trim(),
        es: String(aiRes.es).trim(),
        pos: String(aiRes.pos || '').trim(),
        phonetic: String(aiRes.phonetic || '').trim(),
        defEn: String(aiRes.defEn || '').trim(),
        defEs: String(aiRes.defEs || '').trim(),
        exampleEn: String(aiRes.exampleEn || '').trim(),
        exampleEs: String(aiRes.exampleEs || '').trim(),
        prepositions: Array.isArray(aiRes.prepositions) ? aiRes.prepositions.map(p => String(p).toLowerCase().trim()).filter(Boolean).slice(0, 5) : [],
        freq: Math.max(1, Math.min(100, Number(aiRes.freq) || 65))
      };
    }
  }

  let detectedDir = direction;
  if (direction === 'auto') {
    if (looksSpanish(query)) {
      detectedDir = 'es-en';
    } else {
      const dictCheck = await fetchJsonSafe(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query.split(/\s+/)[0])}`);
      detectedDir = Array.isArray(dictCheck) ? 'en-es' : 'es-en';
      if (detectedDir === 'es-en') {
        const mmEsEn = await translateMyMemory(query, 'es', 'en');
        if (!mmEsEn || mmEsEn.main.toLowerCase() === query.toLowerCase()) {
          detectedDir = 'en-es';
        }
      }
    }
  }

  let enWord = query;
  let esWord = query;
  let alts = [];

  if (detectedDir === 'en-es') {
    const mm = await translateMyMemory(query, 'en', 'es');
    esWord = mm?.main || query;
    alts = mm?.alts || [];
  } else {
    const mm = await translateMyMemory(query, 'es', 'en');
    enWord = (mm?.main || query).replace(/[.!?]+$/, '').trim();
    esWord = query;
    alts = mm?.alts || [];
  }

  const headEn = enWord.toLowerCase().split(/\s+/)[0];
  const [dictData, dmFreqData, dmBgaData] = await Promise.all([
    fetchJsonSafe(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(enWord)}`),
    fetchJsonSafe(`https://api.datamuse.com/words?sp=${encodeURIComponent(headEn)}&md=f&max=1`),
    fetchJsonSafe(`https://api.datamuse.com/words?rel_bga=${encodeURIComponent(headEn)}&max=35`)
  ]);

  let pos = '';
  let phonetic = '';
  let defEn = '';
  let exampleEn = '';
  const allTexts = [];

  if (Array.isArray(dictData) && dictData[0]) {
    const entry = dictData[0];
    phonetic = entry.phonetic || (entry.phonetics?.find(p => p.text)?.text) || '';
    if (Array.isArray(entry.meanings) && entry.meanings.length > 0) {
      const m = entry.meanings[0];
      pos = m.partOfSpeech || '';
      if (Array.isArray(m.definitions) && m.definitions[0]) {
        defEn = m.definitions[0].definition || '';
        for (const meaning of entry.meanings) {
          for (const d of meaning.definitions || []) {
            if (d.definition) allTexts.push(d.definition);
            if (d.example) {
              allTexts.push(d.example);
              if (!exampleEn) exampleEn = d.example;
            }
          }
        }
      }
    }
  }

  if (!defEn) {
    const dmDef = await fetchJsonSafe(`https://api.datamuse.com/words?sp=${encodeURIComponent(enWord)}&md=d&max=1`);
    if (Array.isArray(dmDef) && dmDef[0]?.defs?.[0]) {
      const rawDef = dmDef[0].defs[0];
      const parts = rawDef.split('\t');
      pos = pos || (parts[0] === 'v' ? 'verb' : parts[0] === 'n' ? 'noun' : parts[0] === 'adj' ? 'adjective' : parts[0]);
      defEn = parts[1] || rawDef;
    }
  }

  let defEs = '';
  let exampleEs = '';
  const [mmDef, mmEx] = await Promise.all([
    defEn ? translateMyMemory(defEn, 'en', 'es') : Promise.resolve(null),
    exampleEn ? translateMyMemory(exampleEn, 'en', 'es') : Promise.resolve(null)
  ]);
  defEs = mmDef?.main || (detectedDir === 'en-es' ? `Significado principal de "${enWord}": ${esWord}.` : `Expresión en inglés equivalente a "${esWord}".`);
  exampleEs = mmEx?.main || '';

  let freq = 55;
  if (Array.isArray(dmFreqData) && dmFreqData[0]?.tags) {
    const fTag = dmFreqData[0].tags.find(t => t.startsWith('f:'));
    if (fTag) {
      const fpm = parseFloat(fTag.slice(2));
      freq = fpmToScore(fpm);
    }
  }

  const textPreps = extractPrepositionsFromText(headEn, allTexts);
  const dmPreps = [];
  if (Array.isArray(dmBgaData)) {
    for (let i = 0; i < dmBgaData.length; i++) {
      const w = (dmBgaData[i].word || '').toLowerCase();
      if (PREPOSITIONS.has(w)) {
        const isGeneric = GENERIC_PREPS.has(w);
        if (!isGeneric || i < 12 || textPreps.includes(w)) {
          dmPreps.push(w);
        }
      }
      if (dmPreps.length >= 4) break;
    }
  }
  const combinedPreps = Array.from(new Set([...textPreps, ...dmPreps])).slice(0, 4);

  const displayEs = alts.length > 0 && detectedDir === 'en-es'
    ? [esWord, ...alts.slice(0, 1)].join(' / ')
    : esWord;

  return {
    source: 'live-3apis',
    detectedDir,
    en: enWord,
    es: displayEs,
    pos,
    phonetic,
    defEn: defEn || `English term corresponding to "${esWord}".`,
    defEs,
    exampleEn,
    exampleEs,
    prepositions: combinedPreps,
    freq
  };
}

async function handlePractice(body) {
  const words = Array.isArray(body.words) ? body.words.slice(0, 15) : [];
  const mode = body.mode || 'prepositions';

  const envGemini = process.env.GEMINI_API_KEY || '';
  const envOpenAI = process.env.OPENAI_API_KEY || '';
  const aiProvider = body.aiProvider || (envGemini ? 'gemini' : envOpenAI ? 'openai' : '');
  const aiKey = body.aiKey || (aiProvider === 'gemini' ? envGemini : aiProvider === 'openai' ? envOpenAI : '');

  if (aiProvider && aiKey && words.length > 0) {
    const compact = words.map(w => ({
      id: w.id,
      en: w.en,
      es: w.es,
      prepositions: w.prepositions || []
    }));
    const prompt = `Generate natural workplace or everyday English fill-in-the-blank sentences ("___") for each vocabulary item below.
Mode: ${mode}.
If mode is "prepositions", blank ONLY the target preposition right after the word (e.g. "We rely ___ your feedback.").
Otherwise, blank the target English word itself.
Items: ${JSON.stringify(compact)}
Return JSON: { "items": [ { "id": "...", "sentence": "...", "answer": "...", "translationEs": "..." } ] }`;
    const aiRes = await callAI({ provider: aiProvider, apiKey: aiKey, prompt });
    if (aiRes && Array.isArray(aiRes.items)) {
      return { source: `ai:${aiProvider}`, items: aiRes.items };
    }
  }

  const items = words.map(w => {
    const preps = Array.isArray(w.prepositions) ? w.prepositions : [];
    if (mode === 'prepositions' && preps.length > 0) {
      const targetPrep = preps[0];
      let sentence = w.exampleEn || '';
      const regex = new RegExp(`\\b(${w.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|ed|ing)?)\\s+(${targetPrep})\\b`, 'i');
      if (sentence && regex.test(sentence)) {
        sentence = sentence.replace(regex, `$1 ___`);
      } else {
        sentence = `In daily work, we often ${w.en} ___ clear communication.`;
      }
      return {
        id: w.id,
        sentence,
        answer: targetPrep,
        translationEs: w.exampleEs || `${w.en} + ${targetPrep}`
      };
    }
    const wordRegex = new RegExp(`\\b${w.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const sentence = w.exampleEn && wordRegex.test(w.exampleEn)
      ? w.exampleEn.replace(wordRegex, '___')
      : `In this context, "___" means "${w.es}".`;
    return {
      id: w.id,
      sentence,
      answer: w.en,
      translationEs: w.exampleEs || w.es
    };
  });

  return { source: 'local-examples', items };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    fs.readFile(INDEX_FILE, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(500);
        return res.end('index.html not found');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      mode: 'live-api',
      aiConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY)
    });
  }

  if (req.method === 'GET' && pathname === '/api/data') {
    return sendJson(res, 200, readData());
  }

  if (req.method === 'POST' && pathname === '/api/data') {
    try {
      const body = await readBody(req);
      const saved = writeData(body);
      return sendJson(res, 200, { ok: true, data: saved });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/translate') {
    try {
      const body = await readBody(req);
      const result = await handleTranslate(body);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/practice') {
    try {
      const body = await readBody(req);
      const result = await handlePractice(body);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, () => {
  ensureDataFile();
  console.log(`Lector Bilingüe EN⇄ES escuchando en http://localhost:${PORT}`);
});
