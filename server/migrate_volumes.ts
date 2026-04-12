import { db } from './db';

console.log('📋 Verificando e aplicando migration de volumes...\n');

async function runMigration() {
    try {
        const result = await db.$client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='order_volumes'");
        const tableExists = result.rows.length > 0;

        if (tableExists) {
            console.log('✅ Tabela order_volumes já existe!');
            return;
        }

        console.log('🔄 Criando tabela order_volumes...');
        await db.$client.execute(`
            CREATE TABLE IF NOT EXISTS order_volumes (
                id TEXT PRIMARY KEY,
                order_id TEXT NOT NULL REFERENCES orders(id),
                erp_order_id TEXT NOT NULL,
                sacola INTEGER NOT NULL DEFAULT 0,
                caixa INTEGER NOT NULL DEFAULT 0,
                saco INTEGER NOT NULL DEFAULT 0,
                avulso INTEGER NOT NULL DEFAULT 0,
                total_volumes INTEGER NOT NULL DEFAULT 0,
                created_by TEXT REFERENCES users(id),
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        console.log('✓ Tabela order_volumes criada');
        console.log('\n✅ Migration completa! Reinicie o servidor.');
    } catch (error: any) {
        console.error('\n❌ Erro:', error.message);
        throw error;
    }
}

runMigration().catch(err => {
    console.error(err);
    process.exit(1);
});
