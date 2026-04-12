import psycopg2

try:
    conn = psycopg2.connect('host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234')
    conn.autocommit = True
    cur = conn.cursor()
    
    cols_to_add = [
        "OBSERVACAO", "OBSERVACAO2", "DESCRCIDADE", "UF", "IDCEP",
        "ENDERECO", "BAIRRO", "CNPJCPF", "NUMERO"
    ]
    
    for col in cols_to_add:
        try:
            cur.execute(f'ALTER TABLE cache_orcamentos ADD COLUMN "{col}" TEXT')
            print(f'Added column "{col}"')
        except Exception as e:
            print(f'Error adding column "{col}": {e}')
            
except Exception as e:
    print("Connection error:", e)
finally:
    if 'conn' in locals() and conn:
        conn.close()
