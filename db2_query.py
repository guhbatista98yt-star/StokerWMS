#!/usr/bin/env python3
import sys
import json
import time
import os
import re
from decimal import Decimal
from datetime import date, datetime

try:
    import pyodbc
except ImportError:
    print(json.dumps({"error": "pyodbc não está instalado. Instale com: pip install pyodbc"}))
    sys.exit(1)

STRING_CONEXAO_DB2 = os.environ.get("DB2_CONNECTION_STRING", (
    "DSN=CISSODBC;UID=CONSULTA;PWD=qazwsx@123;"
    "MODE=SHARE;CLIENTENCALG=2;PROTOCOL=TCPIP;"
    "TXNISOLATION=1;SERVICENAME=50000;HOSTNAME=192.168.1.200;"
    "DATABASE=CISSERP;"
))

BLOCKED_KEYWORDS = [
    "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
    "TRUNCATE", "GRANT", "REVOKE", "MERGE", "CALL", "EXEC",
    "RENAME", "COMMENT", "LOCK", "INTO"
]

BLOCKED_PATTERNS = [
    r"\bSELECT\b.*\bINTO\b",
    r"\bFOR\s+UPDATE\b",
    r"\bCREATE\b",
    r"\bINSERT\b",
    r"\bUPDATE\b.*\bSET\b",
    r"\bDELETE\b\s+FROM\b",
]

def sanitize_value(val):
    if val is None:
        return None
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, (date, datetime)):
        return val.isoformat()
    if isinstance(val, bytes):
        return val.decode("utf-8", errors="replace")
    return val

def strip_string_literals(sql: str) -> str:
    return re.sub(r"'[^']*'", "''", sql)

def validate_query(raw_query: str) -> tuple:
    lines = raw_query.strip().split("\n")
    schema_cmd = None
    query_lines = []

    for line in lines:
        stripped = line.strip().rstrip(";").strip()
        if re.match(r"^SET\s+CURRENT\s+SCHEMA\s+\w+$", stripped, re.IGNORECASE):
            schema_cmd = stripped
        elif stripped:
            query_lines.append(line)

    query = "\n".join(query_lines).strip().rstrip(";").strip()

    if not query:
        return None, None, "Query vazia após remover SET CURRENT SCHEMA."

    if ";" in query:
        return None, None, "Apenas uma consulta por vez é permitida. Remova pontos-e-vírgula extras."

    cleaned = strip_string_literals(query)
    combined = re.sub(r"\s+", " ", cleaned).upper().strip()
    first_word = combined.split()[0] if combined.split() else ""

    if first_word not in ("SELECT", "WITH", "EXPLAIN", "VALUES"):
        return None, None, f'Comando "{first_word}" não permitido. Apenas SELECT, WITH e EXPLAIN são aceitos.'

    for kw in BLOCKED_KEYWORDS:
        pattern = r'\b' + kw + r'\b'
        if kw == "INTO" and re.search(r'\bSELECT\b.*\bINTO\b', combined):
            return None, None, 'SELECT INTO não é permitido. Apenas consultas de leitura são aceitas.'
        elif kw not in ("INTO",) and kw != first_word and re.search(pattern, combined):
            return None, None, f'Comando "{kw}" detectado. Operações de escrita não são permitidas.'

    for pat in BLOCKED_PATTERNS:
        if re.search(pat, combined):
            return None, None, f'Padrão bloqueado detectado. Apenas consultas de leitura são permitidas.'

    if first_word == "WITH":
        depth = 0
        main_keyword = None
        tokens = re.findall(r'\(|\)|\b\w+\b', combined)
        for token in tokens:
            if token == '(':
                depth += 1
            elif token == ')':
                depth -= 1
            elif depth == 0 and token in ("SELECT", "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "MERGE", "TRUNCATE"):
                main_keyword = token
                break
        if main_keyword and main_keyword != "SELECT":
            return None, None, f'WITH...{main_keyword} não permitido. Apenas WITH...SELECT é aceito.'

    return schema_cmd, query, None

def main():
    raw_query = sys.stdin.read()
    if not raw_query.strip():
        print(json.dumps({"error": "Nenhuma query fornecida."}))
        return

    schema_cmd, query, error = validate_query(raw_query)
    if error:
        print(json.dumps({"error": error}))
        return

    conn = None
    try:
        conn = pyodbc.connect(STRING_CONEXAO_DB2, timeout=30)
        conn.setdecoding(pyodbc.SQL_CHAR, encoding='latin-1')
        conn.setdecoding(pyodbc.SQL_WCHAR, encoding='latin-1')
        cursor = conn.cursor()

        if schema_cmd:
            cursor.execute(schema_cmd)
        else:
            cursor.execute("SET CURRENT SCHEMA DBA")

        start = time.time()
        cursor.execute(query)
        elapsed = int((time.time() - start) * 1000)

        if cursor.description is None:
            print(json.dumps({"columns": [], "rows": [], "rowCount": 0, "elapsed": elapsed}))
            return

        columns = [col[0].strip() for col in cursor.description]

        MAX_ROWS = 5000
        raw_rows = cursor.fetchmany(MAX_ROWS)
        rows = []
        for row in raw_rows:
            obj = {}
            for i, col in enumerate(columns):
                obj[col] = sanitize_value(row[i])
            rows.append(obj)

        truncated = len(raw_rows) == MAX_ROWS

        result = {
            "columns": columns,
            "rows": rows,
            "rowCount": len(rows),
            "elapsed": elapsed,
        }
        if truncated:
            result["warning"] = f"Resultado limitado a {MAX_ROWS} linhas."

        print(json.dumps(result, ensure_ascii=False, default=str))

    except pyodbc.Error as e:
        error_msg = str(e)
        if "[08001]" in error_msg or "Communication" in error_msg:
            error_msg = "Não foi possível conectar ao DB2. Verifique se o servidor está acessível na rede."
        elif "[42" in error_msg:
            error_msg = f"Erro de sintaxe SQL: {error_msg}"
        print(json.dumps({"error": error_msg}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass

if __name__ == "__main__":
    main()
