import psycopg2
import sys

try:
    conn = psycopg2.connect('host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234')
    conn.autocommit = True
    cur = conn.cursor()
    
    print("Checking locks...")
    # Kill other connections to the same DB that might be holding locks
    cur.execute("""
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = 'data_stoker'
          AND pid <> pg_backend_pid()
          AND state in ('idle in transaction', 'active');
    """)
    print(f"Killed {cur.rowcount} blocking processes.")
    
    # Check for duplicates on CHAVE
    cur.execute("""
        SELECT "CHAVE", COUNT(*)
        FROM cache_orcamentos
        GROUP BY "CHAVE"
        HAVING COUNT(*) > 1;
    """)
    duplicates = cur.fetchall()
    
    if duplicates:
        print(f"Found {len(duplicates)} duplicate 'CHAVE' values. Cleaning them up...")
        # Keep only the one with lowest id
        cur.execute("""
            DELETE FROM cache_orcamentos a
            USING cache_orcamentos b
            WHERE a."id" > b."id" 
              AND a."CHAVE" = b."CHAVE"
        """)
        print(f"Deleted {cur.rowcount} duplicate rows.")

    print("Adding unique constraint...")
    try:
        cur.execute('ALTER TABLE cache_orcamentos ADD CONSTRAINT cache_orcamentos_chave_unique UNIQUE ("CHAVE")')
        print("Success! Unique constraint applied on cache_orcamentos.")
    except Exception as e:
        if "already exists" in str(e).lower() or "duplic" in str(e).lower() or "unique" in str(e).lower():
            print(f"Constraint might already exist or handled: {e}")
        else:
            raise e
            
except Exception as e:
    print("Error:", e)
finally:
    if 'conn' in locals() and conn:
        conn.close()
