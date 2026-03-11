import os
import json
import re
from dotenv import load_dotenv
from google import genai
from google.genai import types as gtypes
from db import get_schema, execute_query
from prompts import SYSTEM_PROMPT, FOLLOWUP_CONTEXT_PROMPT, AMBIGUITY_SYSTEM_NOTE

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY not set. Create backend/.env:\n  GEMINI_API_KEY=your_key_here")

# Force v1 stable API (not v1beta) so models like gemini-1.5-flash are found
client = genai.Client(
    api_key=GEMINI_API_KEY,
    http_options={"api_version": "v1"},
)

# Model order: try each one until one works
CANDIDATE_MODELS = [
    "gemini-1.5-flash",
    "gemini-1.5-flash-001",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro",
]

VAGUE_QUERIES = [
    "show me everything", "what's interesting", "what can you show",
    "anything", "something", "surprise me", "show me data",
]


def _is_vague(query: str) -> bool:
    q = query.strip().lower()
    return any(v in q for v in VAGUE_QUERIES) or len(q) < 10


def _extract_json(text: str) -> dict:
    """Strip markdown fences and parse JSON from Gemini response."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```\s*$",       "", text, flags=re.MULTILINE)
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Could not parse AI response as JSON: {e}\nRaw: {text[:400]}")


def _validate_sql(sql: str) -> bool:
    """Only allow safe SELECT queries."""
    normalized = sql.strip().upper()
    forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "EXEC"]
    if not normalized.startswith("SELECT"):
        return False
    return not any(re.search(rf"\b{w}\b", normalized) for w in forbidden)


def _format_data(df) -> list:
    if df.empty:
        return []
    rows = []
    for row in df.to_dict(orient="records"):
        clean = {}
        for k, v in row.items():
            clean[k] = v.item() if hasattr(v, "item") else v
        rows.append(clean)
    return rows


def _call_gemini(system: str, user_message: str) -> str:
    """Try each candidate model until one succeeds. Returns raw text."""
    # v1 API doesn't support system_instruction field — embed in message directly
    full_prompt = f"{system}\n\n---\n\n{user_message}"
    last_err = None
    for model_name in CANDIDATE_MODELS:
        try:
            resp = client.models.generate_content(
                model=model_name,
                contents=full_prompt,
                config=gtypes.GenerateContentConfig(temperature=0.1),
            )
            return resp.text
        except Exception as e:
            err = str(e)
            if "NOT_FOUND" in err or "404" in err:
                last_err = e
                continue  # try next model
            if "RESOURCE_EXHAUSTED" in err or "429" in err:
                raise RuntimeError("⏳ Rate limit hit — wait 30–60 s and retry.")
            raise  # unexpected error — propagate
    raise RuntimeError(
        f"No available Gemini model found. Tried: {CANDIDATE_MODELS}. Last error: {last_err}"
    )


async def run_query_agent(
    user_query: str,
    conversation_history: list | None = None,
    custom_schema: str | None = None,
) -> dict:
    schema = custom_schema or get_schema()

    if _is_vague(user_query):
        user_query = "Show top 5 campaign types by total revenue as a bar chart"

    # Build conversation context for follow-ups
    history_text = ""
    if conversation_history:
        lines = [f"{m['role'].upper()}: {m['content']}" for m in conversation_history[-6:]]
        history_text = "\n".join(lines)

    system = SYSTEM_PROMPT + AMBIGUITY_SYSTEM_NOTE
    if history_text:
        system += "\n\n" + FOLLOWUP_CONTEXT_PROMPT.format(history=history_text)

    user_message = (
        f"Database Schema:\n{schema}\n\n"
        f"User Question: {user_query}\n\n"
        f"Respond ONLY with the JSON object as specified."
    )

    # ── Call Gemini ──────────────────────────────────────────────────────────
    try:
        raw_text = _call_gemini(system, user_message)
    except RuntimeError as e:
        return {"success": False, "error": str(e), "data": []}
    except Exception as e:
        return {"success": False, "error": f"Gemini API error: {e}", "data": []}

    # ── Parse JSON ───────────────────────────────────────────────────────────
    try:
        ai = _extract_json(raw_text)
    except ValueError as e:
        return {"success": False, "error": str(e), "data": []}

    if ai.get("cannot_answer"):
        return {
            "success": False, "cannot_answer": True,
            "error": ai.get("cannot_answer_reason", "I can't answer this with the available data."),
            "data": [],
        }

    sql        = ai.get("sql", "")
    chart_type = ai.get("chart_type", "bar")
    x_axis     = ai.get("x_axis", "")
    y_axis     = ai.get("y_axis", "")
    title      = ai.get("title", user_query)
    insight    = ai.get("insight", "")

    if not _validate_sql(sql):
        return {"success": False, "error": "AI generated an unsafe SQL statement. Please rephrase.", "data": []}

    # ── Execute SQL ──────────────────────────────────────────────────────────
    try:
        df = execute_query(sql)
    except ValueError as e:
        return {"success": False, "error": str(e), "sql": sql, "data": []}

    if df.empty:
        return {
            "success": False, "cannot_answer": True,
            "error": "Query returned no rows — your filters may be too restrictive.",
            "sql": sql, "data": [],
        }

    return {
        "success":    True,
        "sql":        sql,
        "chart_type": chart_type,
        "x_axis":     x_axis,
        "y_axis":     y_axis,
        "title":      title,
        "insight":    insight,
        "data":       _format_data(df),
        "columns":    list(df.columns),
        "row_count":  len(df),
    }
