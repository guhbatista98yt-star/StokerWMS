import sqlite3

# Conecta no WAL mode para não conflitar com o servidor
conn = sqlite3.connect('database.db', timeout=30)
conn.execute("PRAGMA journal_mode=WAL")

cursor = conn.cursor()

migrations = [
    ("orders", "separated_at", "TEXT"),
]

for table, col, col_type in migrations:
    try:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
        print(f"[OK] {table}.{col} adicionada")
    except sqlite3.OperationalError as e:
        if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
            print(f"[SKIP] {table}.{col} já existe")
        else:
            print(f"[ERRO] {table}.{col}: {e}")

conn.commit()
conn.close()
print("Migração concluída.")
