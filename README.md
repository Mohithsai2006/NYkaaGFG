# 🌸 Nykaa BI — Conversational AI Business Intelligence Dashboard

> Ask business questions in plain English → Get instant interactive charts powered by Google Gemini AI.

## ✨ Features
- 💬 **Conversational Chat UI** — real-time message interface
- 📊 **AI-Driven Charts** — Gemini selects the best chart type automatically
- 🔄 **Follow-up Queries** — "Now filter to Hindi campaigns only"
- 📎 **CSV Upload** — upload any CSV and start querying it
- 🛡️ **Hallucination Guard** — graceful handling when data isn't available
- 🎨 **Dark Glassmorphism UI** — stunning modern design

---

## 🚀 Quick Start

### Step 1: Set up Gemini API Key

1. Go to **https://aistudio.google.com/app/apikey**
2. Click **"Create API Key"**
3. Create the `.env` file in the `backend/` folder:

```sh
# backend/.env
GEMINI_API_KEY=your_key_here
```

### Step 2: Start the Backend

```powershell
# Terminal 1
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Step 3: Start the Frontend

```powershell
# Terminal 2
cd frontend
npm install
npm run dev
```

### Step 4: Open the App

Open **http://localhost:3000** in your browser 🎉

---

## 📁 Project Structure

```
GFG/
├── backend/
│   ├── main.py         # FastAPI app + endpoints
│   ├── agent.py        # Gemini AI pipeline (NL → SQL → Chart)
│   ├── db.py           # SQLite + CSV loader
│   ├── prompts.py      # System prompts + prompt engineering
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx    # Main app with state management
│   │   └── globals.css # Dark glassmorphism theme
│   ├── components/
│   │   ├── ChatPanel.tsx      # Conversational chat UI
│   │   ├── DashboardPanel.tsx # Chart display + insights
│   │   └── ChartRenderer.tsx  # All Recharts chart types
│   └── lib/
│       ├── api.ts      # Backend API client
│       └── types.ts    # TypeScript interfaces
├── Nykaa Digital Marketing.csv
└── README.md
```

---

## 🎯 Demo Queries

Try these in the chat:

| Complexity | Query |
|---|---|
| Simple | *"Show total revenue by campaign type"* |
| Medium | *"Monthly ROI trend for 2025 broken down by channel"* |
| Complex | *"Compare ROI vs Acquisition Cost by target audience"* |
| Follow-up | *"Now show only Hindi campaigns"* |

---

## 🏗️ Architecture

```
Chat Input → FastAPI → Gemini (NL→SQL + Chart Type) → SQLite → Recharts → Dashboard
```

## Tech Stack
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, Recharts, Framer Motion
- **Backend**: Python FastAPI, Google Gemini 1.5 Flash
- **Database**: SQLite (loaded from CSV)
