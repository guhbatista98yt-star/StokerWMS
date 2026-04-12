// Script to create section_groups table
import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

async function createSectionGroupsTable() {
    console.log('Creating section_groups table...');

    try {
        await db.run(sql`
      CREATE TABLE IF NOT EXISTS section_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sections TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

        console.log('✅ Table section_groups created successfully!');

        // Verify
        const groups = await db.select().from(require('./shared/schema.js').sectionGroups);
        console.log('Current groups:', groups);

    } catch (error) {
        console.error('❌ Error:', error);
    }

    process.exit(0);
}

createSectionGroupsTable();
