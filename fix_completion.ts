
import { db } from "./server/db";
import { workUnits, orderItems, exceptions } from "@shared/schema";
import { eq, and, ne } from "drizzle-orm";

async function main() {
    console.log("Fixing Work Unit Completion Status...");

    // Find all work units not concluded
    const wus = await db.select().from(workUnits).where(ne(workUnits.status, "concluido"));
    console.log(`Found ${wus.length} pending work units.`);

    for (const wu of wus) {
        // Get items
        const whereClause = and(
            eq(orderItems.orderId, wu.orderId),
            eq(orderItems.pickupPoint, wu.pickupPoint),
            wu.section ? eq(orderItems.section, wu.section) : undefined
        );
        const items = await db.select().from(orderItems).where(whereClause);

        // Get exceptions
        const unitExceptions = await db.select().from(exceptions).where(eq(exceptions.workUnitId, wu.id));

        if (items.length === 0) continue;

        const allComplete = items.every(item => {
            const itemExcs = unitExceptions.filter(e => e.orderItemId === item.id);
            const excQty = itemExcs.reduce((sum, e) => sum + Number(e.quantity), 0);
            return Number(item.separatedQty) + excQty >= Number(item.quantity);
        });

        if (allComplete) {
            console.log(`Fixing WU ${wu.id} -> Concluido`);
            await db.update(workUnits)
                .set({ status: "concluido", completedAt: new Date().toISOString() })
                .where(eq(workUnits.id, wu.id));
        }
    }
    console.log("Done.");
}

main().catch(console.error);
