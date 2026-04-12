import Database from 'better-sqlite3';
const db = new Database('./database.db');

try {
    db.exec(`ALTER TABLE orders ADD COLUMN financial_status TEXT DEFAULT 'pendente' NOT NULL;`);
    console.log('✓ Coluna financial_status adicionada com sucesso!');
} catch (error) {
    if (error.message.includes('duplicate column name')) {
        console.log('⚠ Coluna financial_status já existe!');
    } else {
        throw error;
    }
} finally {
    db.close();
}
