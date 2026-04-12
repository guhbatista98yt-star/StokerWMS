import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', 'database.db');
const migrationPath = join(__dirname, 'migrate_exception_authorization.sql');

console.log('🔄 Aplicando migration: Exception Authorization');
console.log('DB:', dbPath);

const db = new Database(dbPath);

try {
    const migration = fs.readFileSync(migrationPath, 'utf-8');
    const statements = migration
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--'));

    db.transaction(() => {
        for (const stmt of statements) {
            console.log('Executando:', stmt.substring(0, 50) + '...');
            db.prepare(stmt).run();
        }
    })();

    console.log('✅ Migration aplicada com sucesso!');

    // Verificar colunas
    const columns = db.prepare("PRAGMA table_info(exceptions)").all();
    console.log('\n📋 Colunas da tabela exceptions:');
    columns.forEach(col => console.log(`  - ${col.name} (${col.type})`));

} catch (error) {
    console.error('❌ Erro ao aplicar migration:', error.message);
    process.exit(1);
} finally {
    db.close();
}
