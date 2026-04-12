import path from "path";

process.env.DATABASE_URL = "file:test-db.sqlite";
process.env.NODE_ENV = "test";

async function debug() {
    const { db } = await import("./server/db");
    const { users, orders, workUnits, orderItems } = await import("@shared/schema");

    console.log("--- Users ---");
    const allUsers = await db.select().from(users);
    console.log(allUsers.map(u => ({ id: u.id, username: u.username, sections: u.sections })));

    console.log("\n--- Orders ---");
    const allOrders = await db.select().from(orders);
    console.log(allOrders);

    console.log("\n--- Work Units ---");
    const allWUs = await db.select().from(workUnits);
    console.log(allWUs);

    console.log("\n--- Order Items ---");
    const allItems = await db.select().from(orderItems);
    console.log(allItems);

    process.exit(0);
}

debug().catch(console.error);
