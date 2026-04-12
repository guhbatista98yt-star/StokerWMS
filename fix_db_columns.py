import sqlite3
import os

DB_PATH = "database.db"

def add_column(cursor, table, col_def):
    try:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col_def}")
        print(f"Added column {col_def} to {table}")
    except sqlite3.OperationalError as e:
        if "duplicate column" in str(e).lower():
            print(f"Column {col_def} already exists in {table}")
        else:
            print(f"Error adding {col_def} to {table}: {e}")

if not os.path.exists(DB_PATH):
    print(f"Database not found at {DB_PATH}")
    exit(1)

print(f"Migrating database at {DB_PATH}...")
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Fix cache_orcamentos for sync_db2.py inserts
add_column(cursor, "cache_orcamentos", "CODBARRAS TEXT")
add_column(cursor, "cache_orcamentos", "CODBARRAS_CAIXA TEXT")

# Fix products for Drizzle ORM / Server
add_column(cursor, "products", "box_barcode TEXT")

conn.commit()
conn.close()
print("Migration completed.")
