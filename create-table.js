const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'database.db');
console.log('Database path:', dbPath);

const db = new Database(dbPath);

console.log('Creating section_groups table...');

try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS section_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sections TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

    console.log('✅ Table created successfully!');

    // Verify
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='section_groups'").all();
    console.log('Verification:', tables);

} catch (error) {
    console.error('❌ Error:', error);
}

db.close();
console.log('Done!');
