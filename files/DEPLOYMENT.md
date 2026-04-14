# ExamForge — Deployment Guide

## Project Structure

```
examforge/
├── frontend/
│   └── index.html          ← Deploy to Vercel / Netlify (static)
└── backend/
    ├── server.js            ← Node.js + Express API
    ├── package.json
    ├── .env.example         ← Copy to .env and fill in keys
    └── .env                 ← YOUR SECRETS (never commit this)
```

---

## ① Get Free API Keys

### Option A — Groq (RECOMMENDED — fastest inference, most generous free tier)
1. Go to https://console.groq.com
2. Sign up → Dashboard → "Create API Key"
3. Copy key → paste as `GROQ_API_KEY` in `.env`
4. Best free models: `llama3-70b-8192` (default), `mixtral-8x7b-32768`

### Option B — OpenRouter (access to many free models)
1. Go to https://openrouter.ai
2. Sign up → Keys → "Create Key"
3. Copy key → paste as `OPENROUTER_API_KEY` in `.env`
4. Set `LLM_PROVIDER=openrouter`
5. Free models: `mistralai/mistral-7b-instruct:free`, `meta-llama/llama-3-8b-instruct:free`

---

## ② Local Development

```bash
# 1. Backend setup
cd backend
cp .env.example .env
# Edit .env with your API key

npm install
npm run dev      # starts on http://localhost:3001

# 2. Frontend
# Open frontend/index.html in browser
# Set Backend URL to: http://localhost:3001
```

Test the backend is working:
```bash
curl http://localhost:3001/health
# → {"status":"ok","provider":"groq","time":"..."}
```

---

## ③ Deploy Backend to Render (Free)

1. Push `backend/` folder to a GitHub repo
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Name**: examforge-api
   - **Root Directory**: backend
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Environment Variables (in Render dashboard):
   ```
   LLM_PROVIDER=groq
   GROQ_API_KEY=your_key_here
   GROQ_MODEL=llama3-70b-8192
   ALLOWED_ORIGIN=https://your-frontend.vercel.app
   PORT=3001
   ```
6. Deploy → copy your Render URL (e.g. `https://examforge-api.onrender.com`)

> **Note:** Free Render instances sleep after 15min of inactivity. First request after sleep takes ~30s. Upgrade to paid ($7/mo) to avoid cold starts.

### Alternative: Railway
1. https://railway.app → New Project → Deploy from GitHub
2. Add same environment variables
3. Railway gives $5/mo free credit — enough for light usage

### Alternative: Fly.io
```bash
cd backend
fly launch
fly secrets set GROQ_API_KEY=your_key LLM_PROVIDER=groq
fly deploy
```

---

## ④ Deploy Frontend to Vercel (Free)

1. Go to https://vercel.com → New Project
2. Import your GitHub repo (or drag-drop the `frontend/` folder)
3. No build step needed — it's pure HTML
4. After deploy, open the live URL
5. Set Backend URL in the app to your Render URL

### Alternative: Netlify
1. Drag `frontend/` folder to https://app.netlify.com/drop
2. Done — instant deploy

---

## ⑤ Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | 3001 | Server port |
| `LLM_PROVIDER` | Yes | groq | `groq` or `openrouter` |
| `GROQ_API_KEY` | If using Groq | — | From console.groq.com |
| `GROQ_MODEL` | No | llama3-70b-8192 | Groq model name |
| `OPENROUTER_API_KEY` | If using OR | — | From openrouter.ai |
| `OPENROUTER_MODEL` | No | mistral-7b-instruct:free | OpenRouter model |
| `ALLOWED_ORIGIN` | Yes (prod) | * | Your frontend URL for CORS |

---

## ⑥ PDF Tips for Best Results

- **Text PDFs work best** — PDFs with selectable text extract perfectly
- **Scanned PDFs** (images) will fail text extraction — convert to text PDF first using Adobe/Smallpdf
- **Question format** — Works with standard MCQ formats: Q1., 1., (1), etc.
- **Answer keys** — Include them in the same PDF for answer auto-detection
- **File size** — Keep under 10MB for best performance

---

## ⑦ Cost Estimate

| Service | Free Tier | Paid |
|---|---|---|
| Groq API | 14,400 reqs/day | $0.27/M tokens |
| OpenRouter | Varies by model | From $0/M (free models) |
| Render | 750 hrs/mo | $7/mo for always-on |
| Vercel | Unlimited static | Free |
| **Total** | **$0/month** | ~$7/month for reliability |

---

## ⑧ Architecture Overview

```
User Browser
    │
    ├─► PDF.js (client-side)
    │       Extract raw text from PDF
    │
    └─► Your Backend (Render/Railway)
            │
            ├─► /parse-pdf
            │       Send text → Groq/OpenRouter LLM
            │       Returns structured JSON questions
            │
            └─► /translate
                    Send questions → LLM
                    Returns Hindi translations
```

No API keys in frontend. No PDF stored anywhere.
