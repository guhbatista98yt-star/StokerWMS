import sqlite3
import json

try:
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    
    # Query for the product seen in screenshot "GESSO 1KG IBRAS"
    print("--- Searching for GESSO ---")
    cursor.execute("SELECT id, name, barcode, box_barcode FROM products WHERE name LIKE '%GESSO%' LIMIT 5")
    rows = cursor.fetchall()
    for row in rows:
        print(f"Product: {row[1]}")
        print(f"  Barcode: {row[2]}")
        print(f"  Box Barcode: {row[3]}")
    
    if not rows:
        print("No products found containing 'GESSO'")

    conn.close()
except Exception as e:
    print(f"Error: {e}")
