import sqlite3

conn = sqlite3.connect('sqlite.db')
cursor = conn.cursor()

cols_to_add = [
    ("orders", "separated_at", "TEXT"),
    ("products", "box_barcodes", "TEXT"),
]

for table, col, type_ in cols_to_add:
    try:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col} {type_}")
        print(f"Added {table}.{col}")
    except Exception as e:
        print(f"Skipped {table}.{col}: {e}")

conn.commit()
conn.close()
print("Done.")
