
import sqlite3 from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const db = new sqlite3('database.db');

async function fixAdmin() {
    const password = '1234';
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();

    if (user) {
        console.log("Atualizando usuário 'admin' existente...");
        db.prepare("UPDATE users SET password = ? WHERE username = 'admin'").run(hashedPassword);
    } else {
        console.log("Criando novo usuário 'admin'...");
        db.prepare("INSERT INTO users (id, username, password, name, role) VALUES (?, ?, ?, ?, ?)").run(
            randomUUID(), 'admin', hashedPassword, 'Administrador', 'supervisor'
        );
    }

    console.log("Sucesso! Tente logar com admin / 1234");
}

fixAdmin().catch(console.error);
