cat > package.json << 'EOF'
{
  "name": "gunnybot-api",
  "version": "1.0.0",
  "description": "GunnyBot API - OAuth2-protected proxy for llama.cpp",
  "main": "gunny-api.js",
  "scripts": {
    "start": "node gunny-api.js"
  },
  "dependencies": {
    "axios": "^1.7.0",
    "cors": "^2.8.5",
    "dotenv": "^17.2.3",
    "express": "^4.21.0",
    "express-rate-limit": "^7.4.0",
    "helmet": "^8.0.0",
    "jsonwebtoken": "^9.0.2",
    "morgan": "^1.10.0"
  }
}
EOF

cat > gunny-api.js << 'EOF'
/**
 * GunnyBot API - Secure, OAuth2 Client Credentials wrapper around llama.cpp
 * Sanitized version (no IPs, no secrets, no hostnames)
 */

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const axios = require("axios");
require("dotenv").config();

const PORT = process.env.PORT || 3000;

const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = parseInt(process.env.JWT_EXPIRES_IN || "300", 10);

const LLM_URL = process.env.LLM_URL;
const LLM_MODEL = process.env.LLM_MODEL;

const LLM_TEMPERATURE = parseFloat(process.env.LLM_TEMPERATURE || "1.1");
const LLM_TOP_P = parseFloat(process.env.LLM_TOP_P || "0.9");
const LLM_TOP_K = parseInt(process.env.LLM_TOP_K || "40");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined"));

app.use(
  rateLimit({
    windowMs: 60000,
    max: 60,
  })
);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

function validateClient(req) {
  const header = req.headers["authorization"];
  if (!header || !header.startsWith("Basic ")) return false;

  const raw = Buffer.from(header.replace("Basic ", ""), "base64")
    .toString("utf8");
  const [id, secret] = raw.split(":");

  return id === OAUTH_CLIENT_ID && secret === OAUTH_CLIENT_SECRET;
}

app.post("/token", (req, res) => {
  if (!validateClient(req)) {
    return res.status(401).json({ error: "invalid_client" });
  }

  if (req.body?.grant_type !== "client_credentials") {
    return res.status(400).json({ error: "unsupported_grant_type" });
  }

  const payload = { sub: OAUTH_CLIENT_ID };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  res.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: JWT_EXPIRES_IN,
  });
});

function validateBearer(req, res, next) {
  const header = req.headers["authorization"];
  if (!header) return res.status(401).json({ error: "invalid_token" });

  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token)
    return res.status(401).json({ error: "invalid_token" });

  try {
    req.jwt = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}

app.post("/api/generate", validateBearer, async (req, res) => {
  const prompt = req.body?.prompt;
  if (!prompt) return res.status(400).json({ error: "missing_prompt" });

  try {
    const result = await axios.post(LLM_URL, {
      model: LLM_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are GunnyBot, a fictional Gunnery Sergeant persona. Salty, intense, tough love. Always safe.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 256,
      temperature: LLM_TEMPERATURE,
      top_p: LLM_TOP_P,
      top_k: LLM_TOP_K,
    });

    res.json({
      reply:
        result.data?.choices?.[0]?.message?.content ||
        result.data?.choices?.[0]?.text ||
        "",
    });
  } catch (err) {
    return res.status(502).json({ error: "upstream_error" });
  }
});

app.use((req, res) => res.status(404).json({ error: "not_found" }));

app.listen(PORT, () => console.log("Gunny API listening on port", PORT));
EOF

cat > .env.example << 'EOF'
PORT=3000

OAUTH_CLIENT_ID=client_id_here
OAUTH_CLIENT_SECRET=client_secret_here

JWT_SECRET=jwt_secret_here
JWT_EXPIRES_IN=300

LLM_URL=http://<YOUR_LLM_SERVER>/v1/chat/completions
LLM_MODEL=<YOUR_MODEL_NAME>.gguf

LLM_TEMPERATURE=1.1
LLM_TOP_P=0.9
LLM_TOP_K=40
EOF

cat > README.md << 'EOF'
# GunnyBot API (Public)


---

## Features

- OAuth2 Client Credentials `/token`
- JWT access tokens
- Protected `/api/generate`
- Proxy to llama.cpp's `/v1/chat/completions`
- Rate limiting, Helmet, CORS, Morgan logging

---

## Get Token
curl -u "<CLIENT_ID>:<CLIENT_SECRET>" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  http://localhost:3000/token



## Generate Reply
curl -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Hello Gunny"}' \
  http://localhost:3000/api/generate
