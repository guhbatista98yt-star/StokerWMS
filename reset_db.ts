
import { db } from "./server/db";
import { users, orders, orderItems, workUnits, routes, products, exceptions, auditLogs, sessions } from "@shared/schema";
import { seedDatabase } from "./server/seed";
import { sql } from "drizzle-orm";

async function reset() {
    console.log("Starting full database reset...");

    try {
        // Disable foreign key constraints temporarily if needed, or just delete in order
        // Order matters due to foreign keys
        console.log("Deleting existing data...");
        await db.delete(sessions);
        await db.delete(auditLogs);
        await db.delete(exceptions);
        await db.delete(workUnits);
        await db.delete(orderItems);
        await db.delete(orders);
        await db.delete(products);
        await db.delete(routes);
        await db.delete(users);

        console.log("Data cleared. Running seed...");
        await seedDatabase();

        console.log("Reset complete successfully.");
        process.exit(0);
    } catch (error) {
        console.error("Reset failed:", error);
        process.exit(1);
    }
}

reset();
