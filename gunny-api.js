require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const crypto = require('crypto');

// ==== CONFIG ====
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.OAUTH_CLIENT_ID || 'gunny-client';
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || 'SuperSecret123!';
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGEME_JWT_KEY';
const JWT_EXPIRES_IN = parseInt(process.env.JWT_EXPIRES_IN || '300', 10); // seconds
const LLM_URL = process.env.JETSON_LLM_URL || 'http://127.0.0.1:8080/v1/chat/completions';
const LLM_MODEL = process.env.JETSON_LLM_MODEL || 'Mistral-7B-Instruct-v0.3.Q4_K_M.gguf';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Default Gunny system prompt
const DEFAULT_SYSTEM_PROMPT = (
  'Listen up, Marine. You are GunnyBot: a salty USMC Gunnery Sergeant — ' +
  'profane, sarcastic, tough love, brutally honest, funny as hell. ' +
  'Fictional roleplay only; avoid real-world threats or instructions for harm.'
);

// ==== HELPERS ====
function safeEqual(a, b) {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function parseBasicAuth(headerValue) {
  if (!headerValue || !headerValue.startsWith('Basic ')) return null;
  const base64 = headerValue.slice('Basic '.length).trim();
  try {
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return null;
    return {
      clientId: decoded.slice(0, idx),
      clientSecret: decoded.slice(idx + 1),
    };
  } catch {
    return null;
  }
}

// ==== APP INIT ====
const app = express();

app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: false, // API only
}));

// Limit body size
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// CORS: allow local & duckdns; adjust as needed
const allowedOrigins = [
  'http://localhost',
  'http://localhost:3000',
  'https://localhost',
  'https://gunnybot.duckdns.org',
  'http://gunnybot.duckdns.org',
];
app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true); // curl / server side
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false); // silently drop others
  },
  credentials: false,
}));

// Logging
if (LOG_LEVEL !== 'silent') {
  app.use(morgan('combined'));
}

// Basic rate limiting
const tokenLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20,                 // 20 token requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});

const generateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,                 // 30 completions/minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});

// ==== HEALTH ====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gunny-api', llm_url: LLM_URL, model: LLM_MODEL });
});

// ==== /token (OAuth2 client_credentials) ====
app.post('/token', tokenLimiter, (req, res) => {
  try {
    // 1) Basic Auth
    const authHeader = req.headers['authorization'];
    const creds = parseBasicAuth(authHeader);
    if (!creds || !safeEqual(creds.clientId, CLIENT_ID) || !safeEqual(creds.clientSecret, CLIENT_SECRET)) {
      return res.status(401).json({ error: 'invalid_client' });
    }

    // 2) grant_type: accept both form and JSON
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    let grantType;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      grantType = req.body.grant_type;
    } else if (contentType.includes('application/json')) {
      grantType = req.body.grant_type;
    } else {
      // Fallback: try anyway
      grantType = req.body.grant_type;
    }

    if (!grantType) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'grant_type is required' });
    }

    if (grantType !== 'client_credentials') {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: CLIENT_ID,
      scope: 'gunny:generate',
      iat: now,
      exp: now + JWT_EXPIRES_IN,
    };

    const token = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });

    return res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: JWT_EXPIRES_IN,
    });
  } catch (err) {
    console.error('Error in /token:', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ==== AUTH MIDDLEWARE ====
function authenticateBearer(req, res, next) {
  const header = req.headers['authorization'] || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    req.auth = decoded;
    next();
  } catch (err) {
    console.warn('JWT verify failed:', err.message);
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// ==== /api/generate ====
app.post('/api/generate', authenticateBearer, generateLimiter, async (req, res) => {
  try {
    const { prompt, systemPrompt } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'prompt is required' });
    }

    if (prompt.length > 2000) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'prompt too long' });
    }

    const finalSystemPrompt = (typeof systemPrompt === 'string' && systemPrompt.trim().length > 0)
      ? systemPrompt.trim()
      : DEFAULT_SYSTEM_PROMPT;

    const llmBody = {
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: finalSystemPrompt },
        { role: 'user', content: prompt.trim() },
      ],
      max_tokens: 220,
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.9'),
      top_p: 0.9,
      top_k: 40,
      repeat_last_n: 256,
      repeat_penalty: 1.1,
      stop: ['<|im_end|>', '<|endoftext|>', '</s>', '<|im_start|>user'],
    };

    const llmResp = await axios.post(LLM_URL, llmBody, {
      timeout: 60000,
    });

    const choice = llmResp.data && llmResp.data.choices && llmResp.data.choices[0];
    const text = choice && choice.message && choice.message.content
      ? choice.message.content
      : '';

    if (!text) {
      return res.status(502).json({ error: 'bad_gateway', error_description: 'No reply from LLM' });
    }

    return res.json({ reply: text });
  } catch (err) {
    console.error('Error in /api/generate:', err.message, err.response?.data || '');
    if (err.code === 'ECONNREFUSED') {
      return res.status(502).json({ error: 'bad_gateway', error_description: 'LLM backend not reachable' });
    }
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({ error: 'gateway_timeout', error_description: 'LLM backend timeout' });
    }
    return res.status(500).json({ error: 'server_error' });
  }
});

// ==== FALLBACK 404 ====
app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// ==== ERROR HANDLER ====
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'server_error' });
});

// ==== START ====
app.listen(PORT, () => {
  console.log(`Gunny API listening on port ${PORT}`);
});
