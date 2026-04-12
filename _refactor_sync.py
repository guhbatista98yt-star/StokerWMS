import re
import os

with open("sync_db2.py", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Imports and Connection
content = content.replace("import sqlite3", "import psycopg2\nimport psycopg2.extras")
content = content.replace("DATABASE_PATH", '"host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234"')
content = re.sub(r'conn_sqlite\s*:\s*sqlite3\.Connection', 'conn_sqlite', content)
content = re.sub(r'def\s+transform_data\(conn_sqlite\s*:\s*sqlite3\.Connection\):', 'def transform_data(conn_sqlite):', content)

# Remove inicializar_sqlite logic entirely (leave as pass since schema is pushed via Drizzle)
# Find inicializar_sqlite body and replace with pass
pattern_init = r'def inicializar_sqlite\(\):.*?def gerar_sql_orcamentos\(\)'
# Wait, let's just replace the call inside sincronizar and main instead of removing the whole func.
content = content.replace("inicializar_sqlite()", "# inicializar_sqlite() (Handled via Drizzle)")

# 2. Connection instantiation
content = re.sub(r'conn(?:_sqlite)?\s*=\s*sqlite3\.connect\([^)]+\)', "conn_sqlite = psycopg2.connect('host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234')", content)
content = content.replace('cursor.execute("PRAGMA journal_mode = WAL")', '')
content = content.replace('cursor.execute("PRAGMA busy_timeout = 5000")', '')

# Replace cursor execution parameters from ? to %s
# Only in execute and executemany statements
def replacer(match):
    stmt = match.group(0)
    # Be careful not to replace ? inside standard logic, but in SQL strings
    # We can just replace ? with %s inside the string if we assume all ? are markers.
    new_stmt = stmt.replace("?", "%s")
    
    # Specific SQLite to Postgres conversions:
    new_stmt = new_stmt.replace("INSERT OR REPLACE INTO pickup_points (id, name, active) VALUES (%s, %s, 1)", "INSERT INTO pickup_points (id, name, active) VALUES (%s, %s, 1) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, active=1")
    new_stmt = new_stmt.replace("INSERT OR REPLACE INTO sections (id, name) VALUES (%s, %s)", "INSERT INTO sections (id, name) VALUES (%s, %s) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name")
    
    # cache_orcamentos INSERT OR REPLACE
    if "INSERT OR REPLACE INTO cache_orcamentos" in new_stmt:
        # Generate the ON CONFLICT block
        # Find the column list
        cols_match = re.search(r'\((CHAVE,.*?)\)', new_stmt, re.DOTALL)
        if cols_match:
            cols_str = cols_match.group(1)
            cols = [c.strip() for c in cols_str.split(',')]
            updates = ",\n                    ".join([f'"{c}" = EXCLUDED."{c}"' for c in cols if c != 'CHAVE'])
            
            new_stmt = new_stmt.replace("INSERT OR REPLACE", "INSERT")
            new_stmt = new_stmt + f"\n                ON CONFLICT (chave) DO UPDATE SET \n                    {updates}"
            
    # orders Upsert syntax fix
    new_stmt = new_stmt.replace("ON CONFLICT(erp_order_id) DO UPDATE SET", 'ON CONFLICT (erp_order_id) DO UPDATE SET')
    new_stmt = new_stmt.replace("ON CONFLICT(erp_code) DO UPDATE SET", 'ON CONFLICT (erp_code) DO UPDATE SET')
    
    # Date time functions
    new_stmt = new_stmt.replace("date('now', '-31 days')", "NOW() - INTERVAL '31 days'")
    new_stmt = new_stmt.replace("datetime('now')", "NOW()")
    
    return new_stmt

# We will just do a global ? replacement in cursor.execute lines or raw queries
content = re.sub(r'cursor\.execute(?:many)?\(\s*(?:""|".*?"|""".*?""")[\s\S]*?(?:,\s*\(.*?\)|,\s*\[.*?\]|,\s*[a-zA-Z_0-9]+)?\)', replacer, content)

# Or safer: manually fix the main queries without regex
content = content.replace("?", "%s")
content = content.replace("INSERT OR REPLACE INTO pickup_points (id, name, active) VALUES (%s, %s, 1)", "INSERT INTO pickup_points (id, name, active) VALUES (%s, %s, 1) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, active=1")
content = content.replace("INSERT OR REPLACE INTO sections (id, name) VALUES (%s, %s)", "INSERT INTO sections (id, name) VALUES (%s, %s) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name")
content = content.replace("date('now', '-31 days')", "CURRENT_DATE - INTERVAL '31 days'")
content = content.replace("datetime('now')", "CURRENT_TIMESTAMP")
content = content.replace("sqlite_master", "pg_tables")

# Fix cache_orcamentos insert
cache_orc_sql = """INSERT OR REPLACE INTO cache_orcamentos (
                    CHAVE, IDEMPRESA, IDORCAMENTO, IDPRODUTO, IDSUBPRODUTO, NUMSEQUENCIA,
                    QTDPRODUTO, UNIDADE, FABRICANTE, VALUNITBRUTO, VALTOTLIQUIDO, DESCRRESPRODUTO,
                    IDVENDEDOR, IDLOCALRETIRADA, IDSECAO, DESCRSECAO,
                    TIPOENTREGA, NOMEVENDEDOR, TIPOENTREGA_DESCR, LOCALRETESTOQUE,
                    FLAGCANCELADO, IDCLIFOR, DESCLIENTE, DTMOVIMENTO,
                    IDRECEBIMENTO, DESCRRECEBIMENTO, FLAGPRENOTAPAGA,
                    CODBARRAS, CODBARRAS_CAIXA,
                    OBSERVACAO, OBSERVACAO2, DESCRCIDADE, UF, IDCEP, ENDERECO, BAIRRO, CNPJCPF, NUMERO
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"""

cache_orc_pg = """INSERT INTO cache_orcamentos (
                    CHAVE, IDEMPRESA, IDORCAMENTO, IDPRODUTO, IDSUBPRODUTO, NUMSEQUENCIA,
                    QTDPRODUTO, UNIDADE, FABRICANTE, VALUNITBRUTO, VALTOTLIQUIDO, DESCRRESPRODUTO,
                    IDVENDEDOR, IDLOCALRETIRADA, IDSECAO, DESCRSECAO,
                    TIPOENTREGA, NOMEVENDEDOR, TIPOENTREGA_DESCR, LOCALRETESTOQUE,
                    FLAGCANCELADO, IDCLIFOR, DESCLIENTE, DTMOVIMENTO,
                    IDRECEBIMENTO, DESCRRECEBIMENTO, FLAGPRENOTAPAGA,
                    CODBARRAS, CODBARRAS_CAIXA,
                    OBSERVACAO, OBSERVACAO2, DESCRCIDADE, UF, IDCEP, ENDERECO, BAIRRO, CNPJCPF, NUMERO
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (chave) DO UPDATE SET
                    IDEMPRESA=EXCLUDED.IDEMPRESA, IDORCAMENTO=EXCLUDED.IDORCAMENTO, IDPRODUTO=EXCLUDED.IDPRODUTO,
                    IDSUBPRODUTO=EXCLUDED.IDSUBPRODUTO, NUMSEQUENCIA=EXCLUDED.NUMSEQUENCIA, QTDPRODUTO=EXCLUDED.QTDPRODUTO,
                    UNIDADE=EXCLUDED.UNIDADE, FABRICANTE=EXCLUDED.FABRICANTE, VALUNITBRUTO=EXCLUDED.VALUNITBRUTO,
                    VALTOTLIQUIDO=EXCLUDED.VALTOTLIQUIDO, DESCRRESPRODUTO=EXCLUDED.DESCRRESPRODUTO,
                    IDVENDEDOR=EXCLUDED.IDVENDEDOR, IDLOCALRETIRADA=EXCLUDED.IDLOCALRETIRADA, IDSECAO=EXCLUDED.IDSECAO,
                    DESCRSECAO=EXCLUDED.DESCRSECAO, TIPOENTREGA=EXCLUDED.TIPOENTREGA, NOMEVENDEDOR=EXCLUDED.NOMEVENDEDOR,
                    TIPOENTREGA_DESCR=EXCLUDED.TIPOENTREGA_DESCR, LOCALRETESTOQUE=EXCLUDED.LOCALRETESTOQUE,
                    FLAGCANCELADO=EXCLUDED.FLAGCANCELADO, IDCLIFOR=EXCLUDED.IDCLIFOR, DESCLIENTE=EXCLUDED.DESCLIENTE,
                    DTMOVIMENTO=EXCLUDED.DTMOVIMENTO, IDRECEBIMENTO=EXCLUDED.IDRECEBIMENTO, DESCRRECEBIMENTO=EXCLUDED.DESCRRECEBIMENTO,
                    FLAGPRENOTAPAGA=EXCLUDED.FLAGPRENOTAPAGA, CODBARRAS=EXCLUDED.CODBARRAS, CODBARRAS_CAIXA=EXCLUDED.CODBARRAS_CAIXA,
                    OBSERVACAO=EXCLUDED.OBSERVACAO, OBSERVACAO2=EXCLUDED.OBSERVACAO2, DESCRCIDADE=EXCLUDED.DESCRCIDADE,
                    UF=EXCLUDED.UF, IDCEP=EXCLUDED.IDCEP, ENDERECO=EXCLUDED.ENDERECO, BAIRRO=EXCLUDED.BAIRRO,
                    CNPJCPF=EXCLUDED.CNPJCPF, NUMERO=EXCLUDED.NUMERO"""

content = content.replace(cache_orc_sql, cache_orc_pg)

with open("sync_db2.py", "w", encoding="utf-8") as f:
    f.write(content)

print("Conversão concluída com script!")
