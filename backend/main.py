import os
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import db
import agent

load_dotenv()

app = FastAPI(title="Nykaa BI Dashboard API", version="1.0.0")

# CORS — allow Next.js dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize DB on startup
@app.on_event("startup")
async def startup_event():
    db.get_connection()
    print("[API] Database initialized.")


# ─── Request/Response Models ────────────────────────────────────────────────

class QueryRequest(BaseModel):
    query: str
    conversation_history: list[dict] = []
    custom_schema: str | None = None


class UploadResponse(BaseModel):
    success: bool
    db_schema: str
    table_name: str
    row_count: int


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "db_tables": db.get_table_names()}


@app.get("/api/schema")
async def get_schema():
    """Return the current database schema for the frontend to display."""
    schema = db.get_schema()
    tables = db.get_table_names()
    return {"schema": schema, "tables": tables}


@app.post("/api/query")
async def run_query(request: QueryRequest):
    """
    Main endpoint: Accept a natural language query and return chart data.
    """
    if not request.query or len(request.query.strip()) == 0:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    result = await agent.run_query_agent(
        user_query=request.query,
        conversation_history=request.conversation_history,
        custom_schema=request.custom_schema,
    )
    return result


@app.post("/api/upload")
async def upload_csv(file: UploadFile = File(...)):
    """
    Bonus: Upload a custom CSV file and make it queryable.
    Returns the auto-detected schema.
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")

    content = await file.read()
    csv_text = content.decode("utf-8")

    # Derive table name from filename
    table_name = file.filename.replace(".csv", "").replace(" ", "_").replace("-", "_").lower()
    table_name = "".join(c for c in table_name if c.isalnum() or c == "_")
    if not table_name:
        table_name = "uploaded_data"

    schema = db.load_csv_from_content(csv_text, table_name)

    # Count rows
    df = db.execute_query(f"SELECT COUNT(*) as cnt FROM {table_name}")
    row_count = int(df["cnt"].iloc[0]) if not df.empty else 0

    return UploadResponse(
        success=True,
        db_schema=schema,
        table_name=table_name,
        row_count=row_count,
    )


@app.get("/")
async def root():
    return {"message": "Nykaa BI Dashboard API is running 🚀"}
