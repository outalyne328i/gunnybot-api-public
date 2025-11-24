# GunnyBot Project README – The Full Saga (v1.0 → v3.0)

### The Mission
Build the angriest, most motivational small language model on earth: a drill-instructor AI that screams Full Metal Jacket / Heartbreak Ridge-style rants on demand. Goal was never just a chatbot – it was a battle-tested, secure, API-first SLM that can be dropped into Boomi integration flows for hilarious, high-energy demos and agentic processes.

### Phase 1 – Birth of the Beast (Windows + RTX 2080 Ti)
- Took pristine Qwen2-0.5B-Instruct
- Fed it ~20 hand-crafted, profanity-laced, motivational rants written in the sacred style of Gunnery Sergeant Hartman and Highway
- Fine-tuned locally with `train_gunnybot.py`
- Result: `./gunnybot` – a 0.5B monster that speaks only in caps-lock fury and push-ups

### Phase 2 – First Deployment (Raspberry Pi 5 – v2.0)
- Transferred model via scp to Pi 5 (ARM64)
- Imported into Ollama: `ollama create gunnybot -f gunnybot.Modelfile`
- Built a production-grade Node.js HTTPS API with:
  - Self-signed certs (`key.pem` + `cert.pem`)
  - JWT authentication (OAuth 2.0 Client Credentials flow)
  - Proper logging
  - High randomness (temperature 1.5, top_p 0.95, repeat_penalty 1.2)
  - Fallback static rants if the model ever goes soft
  - Returns 3 different rants per request for maximum chaos
- Endpoint: `https://mylocal/api/generate`
- Fully Boomi-ready (ignores SSL warnings, speaks pure JSON, OAuth2 compatible)
- Entire stack backed up to private GitHub repo

v2.0 was declared combat effective and terrifyingly funny.

### Phase 3 – Evolution to Jetson Nano (v3.0 – Current)
Realizing the Raspberry Pi 5 was “adequate but not motivational enough,” the project moved to NVIDIA Jetson Nano for raw GPU acceleration (128 CUDA cores).

Migration was almost trivial because:
- Both platforms are ARM64
- Ollama has native Jetson support
- Same Modelfile, same Node.js API code

Quick-start executed exactly as planned:
1. Installed Ollama on Jetson
2. SCP’d model from Pi → Jetson
3. `ollama create gunnybot` again
4. Installed Node.js/npm
5. SCP’d entire `gunnybot-api` folder
6. Launched secure API – instantly faster inference

### Current State (v3.0 – Jetson Nano)
- Fastest, loudest, most secure version yet
- 128-core GPU makes rants fly
- Same battle-proven API, now with real CUDA muscle
- Ready for next-level Boomi agentic demos (e.g., trigger rants from Salesforce cases, ServiceNow tickets, Slack bots, or when CI builds fail)

### Why This Project Rules
- Took pristine Qwen2-0.5B-Instruct and upgraded
- Mistral-7B-Instruct-v0.3.Q4_K_M.gguf model, make it terrifyingly specialized, and productionize it on edge hardware in days
- End-to-end example of fine-tune → Ollama → secure API → Boomi integration
- Perfect demo material: “Watch this integration platform get screamed at by an AI drill sergeant"

### Final Declaration
From Windows GPU → Raspberry Pi → Jetson Nano, GunnyBot has evolved from prototype to weaponized motivational SLM.

This thing works.  
It’s fast.  
It’s secure.  
It will make you drop and give it twenty.

**GUNNYBOT V3.0 ON JETSON NANO – LOCKED, COCKED, AND READY TO ROCK.**
