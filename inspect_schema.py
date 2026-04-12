import sqlite3

conn = sqlite3.connect('database.db')
cursor = conn.cursor()

cursor.execute("PRAGMA table_info(cache_orcamentos)")
columns = cursor.fetchall()

print("cache_orcamentos columns:")
for col in columns:
    print(col)

conn.close()
