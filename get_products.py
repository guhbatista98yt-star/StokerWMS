import psycopg2
DATABASE_PATH = "host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234"
try:
    conn = psycopg2.connect(DATABASE_PATH)
    cur = conn.cursor()
    cur.execute("SELECT id, name, erp_code FROM products LIMIT 5")
    rows = cur.fetchall()
    print(rows)
    conn.close()
except Exception as e:
    print(e)
