
import Database from 'better-sqlite3';

const db = new Database('database.db', { readonly: true });

try {
    console.log("--- TABLE: sessions ---");
    const info = db.pragma('table_info(sessions)');
    console.table(info);

    console.log("--- TABLE: users ---");
    const usersInfo = db.pragma('table_info(users)');
    console.table(usersInfo);

    const rows = db.prepare("SELECT * FROM sessions LIMIT 1").all();
    console.log("Row count:", rows.length);

} catch (e) {
    console.error(e);
}
