import psycopg2
import json

try:
    conn = psycopg2.connect("host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234")
    cursor = conn.cursor()
    cursor.execute("SELECT erp_order_id, pickup_points FROM orders LIMIT 20")
    rows = cursor.fetchall()
    for row in rows:
        print(f"Order: {row[0]}, PickupPoints: {row[1]}, Type: {type(row[1])}")
        
    cursor.execute("SELECT DISTINCT jsonb_typeof(pickup_points) FROM orders")
    types = cursor.fetchall()
    print("Types in DB:", types)
    
except Exception as e:
    print("Error:", e)
