#!/usr/bin/env python3
"""
validate_migration.py
Valida a migração comparando contagens entre database.db (SQLite) e data_stoker (PostgreSQL).
"""

import sqlite3
import psycopg2
import sys
from datetime import datetime

SQLITE_FILE = "database.db"
PG_DSN = "host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234"


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


def main():
    log("=" * 65)
    log("VALIDAÇÃO DE MIGRAÇÃO — SQLite vs PostgreSQL")
    log("=" * 65)

    # SQLite
    try:
        sq_conn = sqlite3.connect(f"file:{SQLITE_FILE}?mode=ro", uri=True)
        sq_cur = sq_conn.cursor()
        sq_cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        sq_tables = {row[0] for row in sq_cur.fetchall()}
        log(f"✓ SQLite: {len(sq_tables)} tabelas encontradas")
    except Exception as e:
        log(f"✗ Erro SQLite: {e}")
        sys.exit(1)

    # PostgreSQL
    try:
        pg_conn = psycopg2.connect(PG_DSN)
        pg_cur = pg_conn.cursor()
        pg_cur.execute("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        """)
        pg_tables = {row[0] for row in pg_cur.fetchall()}
        log(f"✓ PostgreSQL: {len(pg_tables)} tabelas encontradas")
    except Exception as e:
        log(f"✗ Erro PostgreSQL: {e}")
        sq_conn.close()
        sys.exit(1)

    log("\n" + f"{'Tabela':<35} {'SQLite':>10} {'PostgreSQL':>12} {'Status':>8}")
    log("-" * 68)

    ok = 0
    warn = 0
    missing = 0

    for table in sorted(sq_tables):
        # Conta no SQLite
        sq_cur.execute(f"SELECT COUNT(*) FROM \"{table}\"")
        sq_count = sq_cur.fetchone()[0]

        # Conta no PostgreSQL
        if table in pg_tables:
            try:
                pg_cur.execute(f"SELECT COUNT(*) FROM \"{table}\"")
                pg_count = pg_cur.fetchone()[0]
            except Exception:
                pg_count = -1
        else:
            pg_count = None

        if pg_count is None:
            status = "✗ AUSENTE"
            missing += 1
        elif pg_count == sq_count:
            status = "✓ OK"
            ok += 1
        elif pg_count > sq_count:
            status = "~ MAIOR"
            ok += 1
        else:
            status = "⚠ DIVERGE"
            warn += 1

        pg_display = str(pg_count) if pg_count is not None else "—"
        log(f"  {table:<33} {sq_count:>10} {pg_display:>12} {status:>8}")

    # Tabelas em PG que não estão no SQLite
    extras = pg_tables - sq_tables
    if extras:
        log(f"\n  Tabelas extras no PostgreSQL (não existem no SQLite):")
        for t in sorted(extras):
            log(f"    + {t}")

    log("\n" + "=" * 65)
    log(f"RESUMO: ✓ {ok} OK  |  ⚠ {warn} divergentes  |  ✗ {missing} ausentes")
    log("=" * 65)

    sq_conn.close()
    pg_cur.close()
    pg_conn.close()

    if missing > 0 or warn > 0:
        log("⚠  Há diferenças. Verifique antes de colocar em produção.")
        sys.exit(1)
    else:
        log("✓ Validação passou! Contagens idênticas em todas as tabelas.")
        sys.exit(0)


if __name__ == "__main__":
    main()
