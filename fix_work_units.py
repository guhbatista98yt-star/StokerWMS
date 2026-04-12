import psycopg2

try:
    conn = psycopg2.connect("host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234")
    conn.autocommit = True
    cursor = conn.cursor()
    
    print("Updating existing work_units...")
    cursor.execute("""
        UPDATE work_units wu 
        SET company_id = o.company_id 
        FROM orders o 
        WHERE wu.order_id = o.id 
        AND wu.company_id IS NULL
    """)
    updated_count = cursor.rowcount
    print(f"Updated {updated_count} work units.")
    
    print("\nFinal Verification:")
    cursor.execute("SELECT company_id, count(*) FROM work_units GROUP BY company_id")
    rows = cursor.fetchall()
    for row in rows:
        print(f"Company ID: {row[0]}, Count: {row[1]}")
    
except Exception as e:
    print("Error:", e)
