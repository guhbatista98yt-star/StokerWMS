import { db } from './db';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationSQL = `
ALTER TABLE exceptions ADD COLUMN authorized_by TEXT REFERENCES users(id);
ALTER TABLE exceptions ADD COLUMN authorized_by_name TEXT;
ALTER TABLE exceptions ADD COLUMN authorized_at TEXT;
`;

console.log('🔄 Aplicando migration para Exception Authorization...');

async function run() {
    try {
        // Executar cada statement separadamente
        const statements = migrationSQL
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        for (const stmt of statements) {
            console.log('Executando:', stmt);
            try {
                await db.$client.execute(stmt);
            } catch (e: any) {
                if (e.message?.includes('duplicate column')) {
                    console.log('Coluna já existe, ignorando.');
                } else {
                    throw e;
                }
            }
        }

        console.log('✅ Migration aplicada com sucesso!');

        // Verificar schema atualizado
        const result = await db.$client.execute("PRAGMA table_info(exceptions)");
        const columns = result.rows;
        console.log('\n📋 Colunas da tabela exceptions:');
        columns.forEach((col: any) => console.log(`  - ${col.name} (${col.type})`));

    } catch (error: any) {
        console.error('❌ Erro ao aplicar migration:', error.message);
        throw error;
    }
}

run().catch(console.error);
