import { createClient } from "@libsql/client";

async function main() {
    const db = createClient({ url: process.env.DATABASE_URL || "file:database.db" });
    try {
        await db.execute(`ALTER TABLE "orders" ADD COLUMN "load_code" text;`);
        console.log("Column load_code added successfully!");
    } catch (e) {
        console.error("Error adding load_code:", e.message);
    }
}

main();
