import sqlite3
import os

DATABASE_PATH = "database.db"

def inspect():
    if not os.path.exists(DATABASE_PATH):
        print(f"Database not found at {DATABASE_PATH}")
        return

    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    target_ids = ['469454', '469453']
    
    print(f"Inspecting orders: {target_ids}")
    
    try:
        # Check if they exist and show details
        query = f"SELECT id, erp_order_id, status, created_at, financial_status FROM orders WHERE erp_order_id IN ({','.join(repr(x) for x in target_ids)})"
        cursor.execute(query)
        rows = cursor.fetchall()
        
        print(f"Found {len(rows)} matching orders.")
        for row in rows:
            print(f"Order: {row}")
            
        # Check the logic used in sync_db2.py
        print("\n--- Simulation of Deletion Logic ---")
        
        # 1. Check if they are in the 'last 31 days' window according to SQLite
        cursor.execute("SELECT date('now', '-31 days')")
        cutoff = cursor.fetchone()[0]
        print(f"SQLite cutoff date ('now', '-31 days'): {cutoff}")
        
        for row in rows:
            created_at = row[3]
            # Simple string comparison as used in SQL
            is_in_window = created_at >= cutoff
            print(f"Order {row[1]} created_at '{created_at}' >= '{cutoff}'? {is_in_window}")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    inspect()
