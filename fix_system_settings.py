import psycopg2
import os
from datetime import datetime

DATABASE_URL = "postgresql://postgres:1234@127.0.0.1:5435/data_stoker"

def run():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = True
        cursor = conn.cursor()
        
        print("Creating system_settings table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                id TEXT PRIMARY KEY DEFAULT 'global',
                separation_mode TEXT NOT NULL DEFAULT 'by_order',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_by TEXT
            );
        """)
        
        print("Checking if default row exists...")
        cursor.execute("SELECT id FROM system_settings WHERE id = 'global'")
        if not cursor.fetchone():
            print("Inserting default ‘global’ settings...")
            cursor.execute("""
                INSERT INTO system_settings (id, separation_mode, updated_at)
                VALUES ('global', 'by_order', %s)
            """, (datetime.now().isoformat(),))
        
        print("✅ Table system_settings ensured successfully.")
        conn.close()
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    run()
