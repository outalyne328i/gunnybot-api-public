# GunnyBot API — Secure Local LLM on Jetson Orin (OAuth2 + llama.cpp)

GunnyBot API is a fully local, OWASP-aligned, secure home-lab deployment of a
USMC Gunnery Sergeant persona (“GunnyBot”) running on:

- Jetson Orin 8GB  
- llama.cpp (Mistral-7B-Instruct-v0.3 Q4_K_M)  
- OAuth2 Client Credentials  
- Node.js v20  
- Systemd services for 24/7 uptime  

This repository documents:
- Architecture
- Setup steps
- Working systemd services
- CLI for quick terminal usage
- Pitfalls and fixes from the deployment

---

# Architecture

```
POSTMAN / APP
      │
      ▼   (Bearer Token)
┌──────────────┐
│  Gunny API   │  ← Node.js + OAuth2
└──────┬───────┘
       │ localhost:8080
       ▼
┌──────────────┐
│ llama-server │  ← Mistral 7B Q4_K_M
└──────┬───────┘
       │ GPU
       ▼
  Jetson Orin 8GB
```

---

# Features

### ✔ Secure OAuth2 Local API  
- `/token` issues JWT  
- `/api/generate` forwards prompts to LLaMA  

### ✔ llama-server as systemd service  
- Auto-starts on boot  
- Restarts on failure  

### ✔ CLI Tool  
Run GunnyBot anywhere on the device:

```
gunny "Gunny, sound off!"
```

### ✔ Works with Postman  
1️⃣ Request token  
2️⃣ Call generate endpoint  

---

# Installation Summary

### Clone the repo:

```bash
git clone https://github.com/outalyne328i/gunnybot-api.git
cd gunnybot-api
```

### Install dependencies:

```bash
npm install
```

### Create `.env` based on `.env.example`:

```bash
cp .env.example .env
```

### Enable systemd services:

```bash
sudo cp systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gunny-llama.service
sudo systemctl enable --now gunny-api.service
```

---

# Pitfalls & Fixes

### Node.js Too Old  
Needed v20 → installed via NodeSource.

### llama.cpp CUDA Errors  
Use `-DGGML_CUDA=ON` not deprecated `LLAMA_CUBLAS`.

### Jetson OOM Errors  
Fixed using:

```
-ngl 2
```

### OAuth Errors  
Use x-www-form-urlencoded, not JSON.

---

# License  
MIT  

# Server
PORT=3000

# OAuth2 client credentials
OAUTH_CLIENT_ID=gunny-client
OAUTH_CLIENT_SECRET=CHANGE_ME_SECRET

# JWT
JWT_SECRET=CHANGE_ME_JWT
JWT_EXPIRES_IN=300

# Llama server URL
JETSON_LLM_URL=http://127.0.0.1:8080/v1/chat/completions
JETSON_LLM_MODEL=Mistral-7B-Instruct-v0.3.Q4_K_M.gguf

LOG_LEVEL=info
[Unit]
Description=GunnyBot LLaMA Server (Mistral 7B)
After=network.target

[Service]
User=jarheadjet1
ExecStart=/usr/local/bin/run-gunny-llama.sh
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
[Unit]
Description=GunnyBot OAuth2 + API server
After=network.target

[Service]
WorkingDirectory=/home/jarheadjet1/gunny-api
ExecStart=/usr/bin/node /home/jarheadjet1/gunny-api/gunny-api.js
Restart=always
User=jarheadjet1
Environment=NODE_ENV=production
RestartSec=2

[Install]
WantedBy=multi-user.target
#!/usr/bin/env bash
set -euo pipefail

/home/jarheadjet1/llama.cpp/build/bin/llama-server \
  -m /home/jarheadjet1/models/Mistral-7B-Instruct-v0.3.Q4_K_M.gguf \
  -c 1536 \
  -b 256 \
  -t "$(nproc)" \
  -ngl 2 \
  --host 0.0.0.0 \
  --port 8080
# make executable

sudo chmod +x scripts/run-gunny-llama.sh
sudo cp scripts/run-gunny-llama.sh /usr/local/bin/

# cli/gunny
#!/usr/bin/env bash

PROMPT="$*"
TOKEN=$(curl -s -u gunny-client:SuperSecret123! -d "grant_type=client_credentials" http://127.0.0.1:3000/token | jq -r '.access_token')

curl -s http://127.0.0.1:3000/api/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"${PROMPT}\"}"
#make executable

chmod +x cli/gunny
sudo cp cli/gunny /usr/local/bin/

#gunny-api.js (final working version)

const express = require("express");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();

const {
  PORT,
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  JETSON_LLM_URL,
  JETSON_LLM_MODEL
} = process.env;

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function issueToken(clientId) {
  return jwt.sign(
    { sub: clientId, scope: "gunny:generate" },
    JWT_SECRET,
    { expiresIn: Number(JWT_EXPIRES_IN) }
  );
}

app.post("/token", (req, res) => {
  const auth = req.headers.authorization || "";
  const base64 = auth.replace("Basic ", "");
  const decoded = Buffer.from(base64, "base64").toString("utf8");
  const [clientId, clientSecret] = decoded.split(":");

  if (clientId !== OAUTH_CLIENT_ID || clientSecret !== OAUTH_CLIENT_SECRET) {
    return res.status(401).json({ error: "invalid_client" });
  }

  if (req.body.grant_type !== "client_credentials") {
    return res.status(400).json({ error: "unsupported_grant_type" });
  }

  const token = issueToken(clientId);
  return res.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: Number(JWT_EXPIRES_IN)
  });
});

app.post("/api/generate", async (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.replace("Bearer ", "");

  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }

  const userPrompt = req.body.prompt || "";
  const messages = [
    {
      role: "system",
      content: "Listen up, Marine. You are GunnyBot..."
    },
    { role: "user", content: userPrompt }
  ];

  try {
    const response = await axios.post(JETSON_LLM_URL, {
      model: JETSON_LLM_MODEL,
      messages,
      max_tokens: 200,
      temperature: 1.18
    });

    const text = response.data.choices?.[0]?.message?.content || "";
    return res.json({ reply: text });
  } catch (err) {
    return res.status(500).json({
      error: "llm_error",
      detail: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Gunny API running on port ${PORT}`);
});

#.gitignore

node_modules/
.env
logs/
*.log
.DS_Store



