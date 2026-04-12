const Database = require('better-sqlite3');
const db = new Database('database.db');

try {
    console.log('Running manual migration...');

    // Add columns to order_items if they don't exist
    try {
        db.prepare('ALTER TABLE order_items ADD COLUMN qty_picked REAL DEFAULT 0').run();
        console.log('Added qty_picked to order_items');
    } catch (e) {
        if (e.message.includes('duplicate column name')) {
            console.log('qty_picked already exists');
        } else {
            throw e;
        }
    }

    try {
        db.prepare('ALTER TABLE order_items ADD COLUMN qty_checked REAL DEFAULT 0').run();
        console.log('Added qty_checked to order_items');
    } catch (e) {
        if (e.message.includes('duplicate column name')) {
            console.log('qty_checked already exists');
        } else {
            throw e;
        }
    }

    try {
        db.prepare('ALTER TABLE order_items ADD COLUMN exception_type TEXT').run();
        console.log('Added exception_type to order_items');
    } catch (e) {
        if (e.message.includes('duplicate column name')) {
            console.log('exception_type already exists');
        } else {
            throw e;
        }
    }

    // Create picking_sessions table
    const createTableStmt = `
    CREATE TABLE IF NOT EXISTS picking_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      section_id TEXT NOT NULL,
      last_heartbeat TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(order_id, section_id)
    )
  `;
    db.prepare(createTableStmt).run();
    console.log('Ensured picking_sessions table exists');

    console.log('Migration completed successfully.');
} catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
}
