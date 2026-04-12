import psycopg2

try:
    conn = psycopg2.connect("host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234")
    cursor = conn.cursor()
    
    print("Checking Orders:")
    cursor.execute("SELECT company_id, count(*) FROM orders GROUP BY company_id")
    rows = cursor.fetchall()
    for row in rows:
        print(f"Company ID: {row[0]}, Count: {row[1]}")
        
    print("\nChecking Work Units:")
    cursor.execute("SELECT company_id, count(*) FROM work_units GROUP BY company_id")
    rows = cursor.fetchall()
    for row in rows:
        print(f"Company ID: {row[0]}, Count: {row[1]}")
    
except Exception as e:
    print("Error:", e)
