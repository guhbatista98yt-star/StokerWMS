import sqlite3
import json

conn = sqlite3.connect('database.db')
c = conn.cursor()
c.execute("SELECT name, erp_code, box_barcodes FROM products WHERE erp_code='313' OR name LIKE '%ADESIVO P/TUBO 75G%'")
rows = c.fetchall()
for row in rows:
    print(f"Product: {row[0]}")
    print(f"ERP Code: {row[1]}")
    print(f"Box Barcodes: {row[2]}")
