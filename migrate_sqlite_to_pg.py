#!/usr/bin/env python3
"""
migrate_sqlite_to_pg.py
Migra dados do SQLite (database.db) para PostgreSQL (data_stoker).
FONTE: database.db (somente leitura — não será modificado)
DESTINO: postgresql://postgres:1234@127.0.0.1:5435/data_stoker
"""

import sqlite3
import psycopg2
import json
import sys
from datetime import datetime

# ─── Configurações ────────────────────────────────────────────────────────────
SQLITE_FILE = "database.db"
PG_DSN = "host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234"

# Ordem que respeita dependências de FK
TABLE_ORDER = [
    "users",
    "routes",
    "sections",
    "pickup_points",
    "section_groups",
    "products",
    "orders",
    "order_items",
    "picking_sessions",
    "work_units",
    "exceptions",
    "audit_logs",
    "order_volumes",
    "sessions",
    "manual_qty_rules",
    "db2_mappings",
    "product_company_stock",
    "wms_addresses",
    "pallets",
    "pallet_items",
    "pallet_movements",
    "nf_cache",
    "nf_items",
    "counting_cycles",
    "counting_cycle_items",
    "cache_orcamentos",
]

# Colunas booleanas por tabela (SQLite armazena como 0/1)
BOOLEAN_COLS = {
    "users":                 {"active"},
    "routes":                {"active"},
    "pickup_points":         {"active"},
    "orders":                {"is_launched"},
    "manual_qty_rules":      {"active"},
    "db2_mappings":          {"is_active"},
    "wms_addresses":         {"active"},
    "pallets":               set(),
    "pallet_items":          {"fefo_enabled"},
    "products":              set(),
    "picking_sessions":      set(),
    "work_units":            set(),
    "exceptions":            set(),
    "audit_logs":            set(),
    "order_volumes":         set(),
    "sessions":              set(),
    "product_company_stock": set(),
    "pallet_movements":      set(),
    "nf_cache":              set(),
    "nf_items":              set(),
    "counting_cycles":       set(),
    "counting_cycle_items":  set(),
    "section_groups":        set(),
    "cache_orcamentos":      set(),
}


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


def get_sqlite_tables(sq_cur) -> list[str]:
    sq_cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    return [row[0] for row in sq_cur.fetchall()]


def get_sqlite_columns(sq_cur, table: str) -> list[str]:
    sq_cur.execute(f"PRAGMA table_info({table})")
    return [row[1] for row in sq_cur.fetchall()]


def get_pg_columns(pg_cur, table: str) -> set[str]:
    pg_cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = %s", (table,))
    return {row[0] for row in pg_cur.fetchall()}


def convert_value(col: str, val, bool_cols: set):
    """Converte valores SQLite para tipos PostgreSQL."""
    if val is None:
        return None
    if col in bool_cols:
        return bool(val)
    return val


def migrate_table(sq_cur, pg_cur, table: str) -> tuple[int, int]:
    """Migra uma tabela. Retorna (rows_read, rows_inserted)."""
    # Verifica se a tabela existe no SQLite
    sq_cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
    if not sq_cur.fetchone():
        log(f"  ⚠  Tabela '{table}' não existe no SQLite — pulando.")
        return 0, 0

    cols = get_sqlite_columns(sq_cur, table)
    pg_cols = get_pg_columns(pg_cur, table)
    bool_cols = BOOLEAN_COLS.get(table, set())

    # Map for renamed columns
    COLUMN_MAPPINGS = {}
    table_mappings = COLUMN_MAPPINGS.get(table, {})

    sq_cur.execute(f"SELECT COUNT(*) FROM {table}")
    total = sq_cur.fetchone()[0]
    log(f"  → Tabela '{table}': {total} registros")

    if total == 0:
        return 0, 0

    insert_cols_sqlite = []
    insert_cols_pg = []
    
    # Criar dict case-insensitive das colunas do PG para evitar miss de quoting
    pg_cols_ci = {c.lower(): c for c in pg_cols}
    seen_pg = set()

    for sq_c in cols:
        target_c = table_mappings.get(sq_c, sq_c)
        pg_c_low = target_c.lower()
        if pg_c_low in pg_cols_ci and pg_c_low not in seen_pg:
            if table == "cache_orcamentos" and sq_c.lower() == "id":
                continue # Pula o ID serial do cache_orcamentos
            insert_cols_sqlite.append(sq_c)
            insert_cols_pg.append(pg_cols_ci[pg_c_low])
            seen_pg.add(pg_c_low)

    col_list   = ", ".join(f'"{c}"' for c in insert_cols_pg)
    placeholders = ", ".join(["%s"] * len(insert_cols_pg))
    insert_sql = f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'

    sq_cur.execute(f'SELECT {", ".join(cols)} FROM "{table}"')
    rows = sq_cur.fetchall()

    inserted = 0
    errors   = 0
    for row in rows:
        row_dict = dict(zip(cols, row))
        values = [convert_value(sq_c, row_dict[sq_c], bool_cols) for sq_c in insert_cols_sqlite]
        try:
            pg_cur.execute(insert_sql, values)
            inserted += 1
        except Exception as e:
            errors += 1
            if errors <= 3:  # mostra só os 3 primeiros erros por tabela
                log(f"    ✗ Erro em '{table}': {e}")

    if errors > 0:
        log(f"    ⚠  {errors} erros na tabela '{table}'")

    return total, inserted


def reset_sequences(pg_cur):
    """Reseta sequences do PostgreSQL para max(id)+1 nas tabelas com serial."""
    serial_tables = [("cache_orcamentos", "id", "cache_orcamentos_id_seq")]
    for table, col, seq in serial_tables:
        try:
            pg_cur.execute(f'SELECT MAX("{col}") FROM "{table}"')
            max_id = pg_cur.fetchone()[0] or 0
            pg_cur.execute(f"SELECT setval('{seq}', {max_id + 1}, false)")
            log(f"  ✓ Sequence '{seq}' ajustada para {max_id + 1}")
        except Exception as e:
            log(f"  ⚠  Não foi possível ajustar sequence '{seq}': {e}")


def main():
    log("=" * 60)
    log("MIGRAÇÃO SQLite → PostgreSQL")
    log(f"Fonte  : {SQLITE_FILE}")
    log(f"Destino: data_stoker @ 127.0.0.1:5435")
    log("=" * 60)

    # Conexão SQLite (somente leitura)
    try:
        sq_conn = sqlite3.connect(f"file:{SQLITE_FILE}?mode=ro", uri=True)
        sq_conn.row_factory = sqlite3.Row
        sq_cur = sq_conn.cursor()
        sq_cur.execute("SELECT sqlite_version()")
        log(f"✓ SQLite conectado (v{sq_cur.fetchone()[0]})")
    except Exception as e:
        log(f"✗ Falha ao conectar no SQLite: {e}")
        sys.exit(1)

    # Conexão PostgreSQL
    try:
        pg_conn = psycopg2.connect(PG_DSN)
        pg_conn.autocommit = False
        pg_cur = pg_conn.cursor()
        pg_cur.execute("SELECT version()")
        ver = pg_cur.fetchone()[0].split(",")[0]
        log(f"✓ PostgreSQL conectado ({ver})")
    except Exception as e:
        log(f"✗ Falha ao conectar no PostgreSQL: {e}")
        sq_conn.close()
        sys.exit(1)

    # Migrando tabelas
    log("\nIniciando migração de dados...\n")
    summary = {}

    # Desabilitar FK checks temporariamente para inserção em lote
    pg_cur.execute("SET session_replication_role = 'replica'")

    for table in TABLE_ORDER:
        try:
            read, inserted = migrate_table(sq_cur, pg_cur, table)
            summary[table] = {"read": read, "inserted": inserted}
            pg_conn.commit()
        except Exception as e:
            pg_conn.rollback()
            log(f"  ✗ ERRO GRAVE na tabela '{table}': {e}")
            summary[table] = {"read": 0, "inserted": 0, "error": str(e)}

    # Reabilitar FK checks
    pg_cur.execute("SET session_replication_role = 'origin'")
    pg_conn.commit()

    # Ajustar sequences
    log("\nAjustando sequences...\n")
    reset_sequences(pg_cur)
    pg_conn.commit()

    # Relatório final
    log("\n" + "=" * 60)
    log("RELATÓRIO FINAL")
    log("=" * 60)
    total_read = 0
    total_inserted = 0
    for table, stats in summary.items():
        r = stats.get("read", 0)
        i = stats.get("inserted", 0)
        err = stats.get("error", "")
        if r > 0 or err:
            status = "✓" if not err and i == r else ("⚠" if i > 0 else "✗")
            msg = f"  {status} {table:<35} {i}/{r} registros"
            if err:
                msg += f" [{err[:50]}]"
            log(msg)
        total_read += r
        total_inserted += i

    log(f"\n  TOTAL: {total_inserted}/{total_read} registros migrados")

    sq_conn.close()
    pg_cur.close()
    pg_conn.close()

    if total_inserted < total_read:
        log(f"\n⚠  Atenção: {total_read - total_inserted} registros não foram migrados.")
        sys.exit(1)
    else:
        log("\n✓ Migração concluída com sucesso!")
        sys.exit(0)


if __name__ == "__main__":
    main()
