import sqlite3
import pandas as pd
import os
from io import StringIO
from pathlib import Path

DB_PATH = ":memory:"
_connection: sqlite3.Connection | None = None
_current_schema: str = ""

CSV_PATH = Path(__file__).parent.parent / "Nykaa Digital Marketing.csv"
TABLE_NAME = "campaigns"


def get_connection() -> sqlite3.Connection:
    global _connection
    if _connection is None:
        _connection = sqlite3.connect(DB_PATH, check_same_thread=False)
        _load_default_csv()
    return _connection


def _read_csv_with_fallback(path: Path) -> pd.DataFrame:
    """Try multiple encodings to read the CSV robustly."""
    encodings = ["utf-8", "utf-8-sig", "latin-1", "cp1252", "iso-8859-1"]
    last_err = None
    for enc in encodings:
        try:
            df = pd.read_csv(path, encoding=enc)
            print(f"[DB] Loaded CSV with encoding: {enc}")
            return df
        except (UnicodeDecodeError, Exception) as e:
            last_err = e
            continue
    raise ValueError(f"Could not read CSV with any known encoding: {last_err}")


def _load_default_csv():
    global _current_schema
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"Default CSV not found at {CSV_PATH}")
    df = _read_csv_with_fallback(CSV_PATH)
    df = _clean_dataframe(df)
    conn = get_connection()
    df.to_sql(TABLE_NAME, conn, if_exists="replace", index=False)
    _current_schema = _build_schema(TABLE_NAME, df)
    print(f"[DB] Loaded {len(df)} rows into '{TABLE_NAME}' table.")


def load_csv_from_content(csv_content: str, table_name: str = "user_data") -> str:
    """Load a CSV string into the DB and return the schema."""
    global _current_schema
    # Try utf-8 first, then latin-1
    try:
        df = pd.read_csv(StringIO(csv_content))
    except UnicodeDecodeError:
        df = pd.read_csv(StringIO(csv_content.encode("latin-1").decode("latin-1")))
    df = _clean_dataframe(df)
    conn = get_connection()
    df.to_sql(table_name, conn, if_exists="replace", index=False)
    schema = _build_schema(table_name, df)
    _current_schema = schema
    return schema


def _clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize column names and handle basic type issues."""
    df.columns = [c.strip().replace(" ", "_").replace("-", "_") for c in df.columns]
    for col in df.columns:
        if "date" in col.lower():
            try:
                df[col] = pd.to_datetime(df[col], dayfirst=True)
                df[col] = df[col].dt.strftime("%Y-%m-%d")
            except Exception:
                pass
    return df


def _build_schema(table_name: str, df: pd.DataFrame) -> str:
    """Build a human-readable schema string for the LLM."""
    lines = [f"Table: {table_name}"]
    lines.append("Columns:")
    for col, dtype in zip(df.columns, df.dtypes):
        sample_vals = df[col].dropna().head(3).tolist()
        sample_str = ", ".join([str(v) for v in sample_vals])
        lines.append(f"  - {col} ({dtype}): e.g. {sample_str}")
    return "\n".join(lines)


def get_schema() -> str:
    get_connection()
    return _current_schema


def execute_query(sql: str) -> pd.DataFrame:
    """Execute a SELECT SQL query and return a DataFrame."""
    conn = get_connection()
    try:
        df = pd.read_sql_query(sql, conn)
        return df
    except Exception as e:
        raise ValueError(f"SQL execution error: {e}")


def get_table_names() -> list[str]:
    conn = get_connection()
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table';")
    return [row[0] for row in cursor.fetchall()]
