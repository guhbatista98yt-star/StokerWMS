import psycopg2

try:
    conn = psycopg2.connect('host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234')
    cur = conn.cursor()
    cur.execute("SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_name = 'cache_orcamentos'")
    for row in cur.fetchall():
        print(row)
except Exception as e:
    print("Error:", e)
finally:
    if 'conn' in locals() and conn:
        conn.close()
