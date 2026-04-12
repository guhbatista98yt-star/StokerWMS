import psycopg2
import json

DATABASE_PATH = "host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234"

def check_stock():
    try:
        conn = psycopg2.connect(DATABASE_PATH)
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM product_company_stock")
        count = cursor.fetchone()[0]
        print(f"Total rows in product_company_stock: {count}")
        
        cursor.execute("SELECT product_id, company_id, stock_qty, erp_updated_at FROM product_company_stock LIMIT 10")
        rows = cursor.fetchall()
        for r in rows:
            print(f"Prod: {r[0]}, Comp: {r[1]}, Qty: {r[2]}, Updated: {r[3]}")
            
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_stock()
