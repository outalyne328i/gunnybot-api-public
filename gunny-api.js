require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const morgan = require('morgan');

// === ENV CONFIG ===
const PORT = process.env.PORT || 3000;

const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || 'gunny-client';
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || 'SuperSecret123!';

const JWT_SECRET = process.env.JWT_SECRET || 'SuperSecretJWTKey';
const JWT_EXPIRES_IN = Number(process.env.JWT_EXPIRES_IN || 300); // seconds

const JETSON_LLM_URL = process.env.JETSON_LLM_URL || 'http://127.0.0.1:8080/v1/chat/completions';
const JETSON_LLM_MODEL = process.env.JETSON_LLM_MODEL || 'Mistral-7B-Instruct-v0.3.Q4_K_M.gguf';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Hard-wired Gunny persona
const GUNNY_SYSTEM_PROMPT = `
Listen up, Marine. You are GunnyBot: a salty USMC Gunnery Sergeant — profane, sarcastic, tough love, brutally honest, funny as hell.
This is fictional roleplay only. Do NOT give moralizing lectures, safety PSAs, or corporate disclaimers.
Avoid any real-world threats or instructions for harm. Stay focused on verbal abuse, humor, and motivation.
Keep answers punchy and direct.
`.trim();

// === APP INIT ===
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

if (LOG_LEVEL === 'debug') {
  app.use(morgan('dev'));
}

// simple rate limit (home lab, not strict)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
});
app.use(limiter);

// === HELPERS ===

// Parse basic auth header for /token
function parseBasicAuth(headerValue) {
  if (!headerValue || !headerValue.startsWith('Basic ')) {
    return null;
  }
  const base64 = headerValue.slice('Basic '.length);
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  const [id, secret] = decoded.split(':');
  if (!id || !secret) return null;
  return { id, secret };
}

// Middleware: OAuth2 bearer token check
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const [scheme, token] = auth.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Missing or malformed Authorization header' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Optional: check scope
    if (!payload.scope || !payload.scope.includes('gunny:generate')) {
      return res.status(403).json({ error: 'insufficient_scope' });
    }
    req.auth = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Token invalid or expired' });
  }
}

// === ROUTES ===

// 1) OAuth2 token endpoint (client_credentials)
app.post('/token', (req, res) => {
  const basic = parseBasicAuth(req.headers['authorization']);
  if (!basic) {
    return res.status(401).json({ error: 'invalid_client', error_description: 'Missing or invalid Basic auth' });
  }

  if (basic.id !== OAUTH_CLIENT_ID || basic.secret !== OAUTH_CLIENT_SECRET) {
    return res.status(401).json({ error: 'invalid_client', error_description: 'Client ID/secret mismatch' });
  }

  const grantType = req.body.grant_type;
  if (grantType !== 'client_credentials') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: basic.id,
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
});

// 2) Gunny generate endpoint
app.post('/api/generate', requireAuth, async (req, res) => {
  const { prompt, temperature, max_tokens } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Missing "prompt" string in JSON body' });
  }

  // defaults for home lab
  const temp = typeof temperature === 'number' ? temperature : 1.1;
  const maxTokens = typeof max_tokens === 'number' ? max_tokens : 220;

  const llmPayload = {
    model: JETSON_LLM_MODEL,
    messages: [
      { role: 'system', content: GUNNY_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    max_tokens: maxTokens,
    temperature: temp,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.18,
  };

  try {
    const response = await axios.post(JETSON_LLM_URL, llmPayload, {
      timeout: 120000,
    });

    const choice = response.data && response.data.choices && response.data.choices[0];
    const reply = choice && choice.message && choice.message.content
      ? choice.message.content.trim()
      : null;

    if (!reply) {
      return res.status(502).json({ error: 'llm_error', error_description: 'No reply from LLM' });
    }

    return res.json({ reply });
  } catch (err) {
    console.error('LLM error:', err.message || err);
    return res.status(502).json({
      error: 'llm_error',
      error_description: 'Error calling Jetson LLM backend',
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', gunny: 'ready' });
});

app.listen(PORT, () => {
  console.log(`Gunny API listening on port ${PORT}`);
});
