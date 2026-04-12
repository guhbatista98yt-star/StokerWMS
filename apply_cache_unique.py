import os
import psycopg2

DEF_DB = "host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234"

def setup_constraints():
    try:
        conn = psycopg2.connect(DEF_DB)
        conn.autocommit = True
        cursor = conn.cursor()

        print("Limpando duplicatas em cache_orcamentos...")
        cursor.execute("""
            DELETE FROM cache_orcamentos
            WHERE id NOT IN (
                SELECT MIN(id)
                FROM cache_orcamentos
                GROUP BY "CHAVE"
            )
        """)
        print(f"  Removidas {cursor.rowcount} duplicatas de cache_orcamentos.")

        print("Adicionando UNIQUE constraint em CHAVE...")
        try:
            cursor.execute('ALTER TABLE cache_orcamentos ADD CONSTRAINT cache_orcamentos_chave_unique UNIQUE ("CHAVE")')
            print("  Constraint adicionada com sucesso!")
        except psycopg2.errors.DuplicateTable:
            print("  Constraint já existe ou erro ignorável.")
        except Exception as e:
            if "already exists" in str(e):
                print("  Constraint já existe.")
            else:
                print(f"  Erro ao adicionar constraint: {e}")

        conn.close()

    except Exception as e:
        print(f"Erro fatal: {e}")

if __name__ == "__main__":
    setup_constraints()
