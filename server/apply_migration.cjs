const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'database.db');
const migrationPath = path.join(__dirname, 'migrate_exception_authorization.sql');

console.log('🔄 Aplicando migration: Exception Authorization');
console.log('DB:', dbPath);
console.log('Migration:', migrationPath);

const db = new Database(dbPath);

try {
    const migration = fs.readFileSync(migrationPath, 'utf-8');
    const statements = migration
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--'));

    db.transaction(() => {
        for (const stmt of statements) {
            if (stmt.length > 0) {
                console.log('Executando:', stmt.substring(0, 60) + '...');
                db.prepare(stmt).run();
            }
        }
    })();

    console.log('✅ Migration aplicada com sucesso!');

    // Verificar colunas
    const columns = db.prepare("PRAGMA table_info(exceptions)").all();
    console.log('\n📋 Colunas da tabela exceptions:');
    columns.forEach(col => console.log(`  - ${col.name} (${col.type})`));

} catch (error) {
    console.error('❌ Erro ao aplicar migration:', error.message);
    console.error(error);
    process.exit(1);
} finally {
    db.close();
}
