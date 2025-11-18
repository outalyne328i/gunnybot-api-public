# GunnyBot API – Jetson Orin Nano (8GB)

This system runs a local USMC-style persona ("GunnyBot") powered by:

- llama.cpp + Mistral-7B-Instruct-v0.3.Q4_K_M.gguf  
- llama-server on 127.0.0.1:8080  
- Node.js OAuth2 API on 127.0.0.1:3000  
- HTTPS public access using DuckDNS + NGINX + Let’s Encrypt  
- UFW firewall + SSH key-only login  

---

## 1. llama-server

Model path:
/home/jarheadjet1/models/Mistral-7B-Instruct-v0.3.Q4_K_M.gguf


Service script:
/usr/local/bin/run-gunny-llama.sh


Systemd unit:
/etc/systemd/system/gunny-llama.service


---

## 2. Gunny API (Node.js)

Main file:
~/gunny-api/gunny-api.js


Environment:
PORT=3000
OAUTH_CLIENT_ID=gunny-client
OAUTH_CLIENT_SECRET=SuperSecret123!
JWT_SECRET=ChangeThisSecret
JWT_EXPIRES_IN=300
JETSON_LLM_URL=http://127.0.0.1:8080/v1/chat/completions

JETSON_LLM_MODEL=Mistral-7B-Instruct-v0.3.Q4_K_M.gguf


Systemd service:
/etc/systemd/system/gunny-api.service


---

## 3. Endpoints

### Get Token
POST /token
Auth: Basic (client:secret)
Body: grant_type=client_credentials JSON


### Generate GunnyBot Response
POST /api/generate
Auth: Bearer <access_token>
Body: { "prompt": "..." }


---

## 4. Public Access (NGINX + HTTPS)

Domain:
gunnybot.duckdns.org


Routes 80/443 → Node API (localhost:3000)

SSL: Let’s Encrypt (certbot)

---

## 5. Local CLI Helper

Command:
gunny "Your message"


Automatically:
- fetches token  
- calls /api/generate  
- prints JSON reply  

---

## 6. Pitfalls Fixed

- Node 12 too old → upgraded to Node 20  
- grant_type must be x-www-form-urlencoded  
- Certbot failed until DuckDNS + router ports fixed  
- 502 fixed by correcting gunny-api.service  
- UFW configured & SSH hardened  

