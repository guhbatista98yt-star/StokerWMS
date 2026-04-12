
import sqlite3

def run_fix():
    print("Fixing database schema manually...")
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()

    try:
        # 1. Orders: Add unique index for erp_order_id
        print("Adding unique index to orders.erp_order_id...")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS orders_erp_order_id_unique ON orders(erp_order_id)")
        
        # 2. Products: Add unique index for erp_code (optional but good)
        print("Adding unique index to products.erp_code...")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS products_erp_code_unique ON products(erp_code)")

        conn.commit()
        print("Schema fixed successfully.")
    except Exception as e:
        print(f"Error fixing schema: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    run_fix()
