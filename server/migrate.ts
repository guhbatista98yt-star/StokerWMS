import { db } from './db';

console.log('📋 Verificando e aplicando migration de exceções...\n');

async function runMigration() {
    try {
        // Verificar schema atual
        const result = await db.$client.execute("PRAGMA table_info(exceptions)");
        const columns = result.rows;

        console.log('Colunas atuais na tabela exceptions:');
        columns.forEach((col: any) => {
            console.log(`  - ${col.name}`);
        });

        const hasAuthorizedBy = columns.some((col: any) => col.name === 'authorized_by');
        const hasAuthorizedByName = columns.some((col: any) => col.name === 'authorized_by_name');
        const hasAuthorizedAt = columns.some((col: any) => col.name === 'authorized_at');

        console.log('\n📊 Status:');
        console.log(`  authorized_by:      ${hasAuthorizedBy ? '✅' : '❌'}`);
        console.log(`  authorized_by_name: ${hasAuthorizedByName ? '✅' : '❌'}`);
        console.log(`  authorized_at:      ${hasAuthorizedAt ? '✅' : '❌'}`);

        if (hasAuthorizedBy && hasAuthorizedByName && hasAuthorizedAt) {
            console.log('\n✅ Migration já aplicada!');
            return;
        }

        console.log('\n🔄 Aplicando colunas faltantes...');

        if (!hasAuthorizedBy) {
            await db.$client.execute('ALTER TABLE exceptions ADD COLUMN authorized_by TEXT REFERENCES users(id)');
            console.log('✓ authorized_by');
        }
        if (!hasAuthorizedByName) {
            await db.$client.execute('ALTER TABLE exceptions ADD COLUMN authorized_by_name TEXT');
            console.log('✓ authorized_by_name');
        }
        if (!hasAuthorizedAt) {
            await db.$client.execute('ALTER TABLE exceptions ADD COLUMN authorized_at TEXT');
            console.log('✓ authorized_at');
        }

        console.log('\n✅ Migration completa! Reinicie o servidor (Ctrl+C e python sync_db2.py --serve)');

    } catch (error: any) {
        if (error.message?.toLowerCase().includes('duplicate')) {
            console.log('\n✅ Colunas já existem!');
        } else {
            console.error('\n❌ Erro:', error.message);
            throw error;
        }
    }
}

runMigration().catch(err => {
    console.error(err);
    process.exit(1);
});
