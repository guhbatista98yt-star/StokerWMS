
import sqlite3
import json
import os

db_path = "database.db"
if not os.path.exists(db_path):
    print(f"Database not found at {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("Analyzing order items...")
# Get orders with their items' pickup points
cursor.execute("""
    SELECT order_id, pickup_point 
    FROM order_items 
    WHERE pickup_point IS NOT NULL
""")
rows = cursor.fetchall()

order_points = {}
for oid, pp in rows:
    if oid not in order_points:
        order_points[oid] = set()
    order_points[oid].add(pp)

print(f"Found {len(order_points)} orders with items.")

updated = 0
for oid, points in order_points.items():
    points_list = list(points)
    points_json = json.dumps(points_list)
    # Check if needs update
    cursor.execute("SELECT pickup_points FROM orders WHERE id = ?", (oid,))
    current = cursor.fetchone()
    
    if current and current[0] != points_json:
        cursor.execute("UPDATE orders SET pickup_points = ? WHERE id = ?", (points_json, oid))
        updated += 1

conn.commit()
print(f"Updated {updated} orders with pickup points.")
conn.close()
