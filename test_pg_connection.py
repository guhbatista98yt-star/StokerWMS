#!/usr/bin/env python3
"""
test_pg_connection.py
Testa a conexão com o PostgreSQL (data_stoker) e lista tabelas existentes.
"""

import psycopg2
import sys
from datetime import datetime

PG_DSN = "host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234"


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


def main():
    log("=" * 55)
    log("TESTE DE CONEXÃO — PostgreSQL data_stoker")
    log("=" * 55)
    log(f"  Host : 127.0.0.1")
    log(f"  Porta: 5435")
    log(f"  Banco: data_stoker")
    log(f"  User : postgres")

    try:
        conn = psycopg2.connect(PG_DSN, connect_timeout=5)
        cur = conn.cursor()

        # Versão do PostgreSQL
        cur.execute("SELECT version()")
        ver = cur.fetchone()[0].split(",")[0]
        log(f"\n✓ Conexão OK — {ver}")

        # Banco atual
        cur.execute("SELECT current_database()")
        db = cur.fetchone()[0]
        log(f"✓ Banco ativo: {db}")

        # Listar tabelas
        cur.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """)
        tables = [row[0] for row in cur.fetchall()]
        log(f"\n  Tabelas encontradas ({len(tables)}):")
        if tables:
            for t in tables:
                cur.execute(f'SELECT COUNT(*) FROM "{t}"')
                count = cur.fetchone()[0]
                log(f"    • {t:<35} {count:>8} registros")
        else:
            log("    (nenhuma tabela criada ainda)")

        cur.close()
        conn.close()

        log("\n✓ Teste concluído com sucesso!")
        sys.exit(0)

    except psycopg2.OperationalError as e:
        log(f"\n✗ FALHA DE CONEXÃO: {e}")
        log("\nVerifique:")
        log("  1. PostgreSQL está rodando na porta 5435")
        log("  2. Banco 'data_stoker' existe")
        log("  3. Usuário/senha corretos")
        sys.exit(1)
    except Exception as e:
        log(f"\n✗ Erro inesperado: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
