
import { db } from "./server/db";
import { workUnits, orderItems, exceptions, products } from "@shared/schema";
import { eq, and } from "drizzle-orm";

async function main() {
    console.log("Debugging Work Unit Completion...");

    // Find the problematic Work Unit
    // Looking for one with items that match screenshot (Arroz 5kg, Sugar 1kg)
    // Or just list pending WUs

    const rules = await db.select().from(workUnits);
    console.log(`Total WUs: ${rules.length}`);

    for (const wu of rules) {
        if (wu.status === "concluido") continue;

        // Check items
        const wItems = await db.select().from(orderItems).where(eq(orderItems.orderId, wu.orderId));
        // Simple filter for console noise
        if (wItems.length === 0) continue;

        console.log(`Checking WU ${wu.id} (Status: ${wu.status})`);

        // Replicate checkAndCompleteWorkUnit Logic manually
        const whereClause = and(
            eq(orderItems.orderId, wu.orderId),
            eq(orderItems.pickupPoint, wu.pickupPoint),
            wu.section ? eq(orderItems.section, wu.section) : undefined
        );
        const items = await db.select().from(orderItems).where(whereClause);
        const unitExceptions = await db.select().from(exceptions).where(eq(exceptions.workUnitId, wu.id));

        let allComplete = true;
        for (const item of items) {
            const [prod] = await db.select().from(products).where(eq(products.id, item.productId));
            const itemExcs = unitExceptions.filter(e => e.orderItemId === item.id);
            const excQty = itemExcs.reduce((sum, e) => sum + Number(e.quantity), 0);
            const target = Number(item.quantity);
            const sep = Number(item.separatedQty);

            const isDone = sep + excQty >= target;
            console.log(` - Item: ${prod?.name} | Qty: ${target} | Sep: ${sep} | Exc: ${excQty} | Done: ${isDone}`);

            if (!isDone) allComplete = false;
        }

        console.log(` => Calculated All Complete: ${allComplete}`);
        if (allComplete) {
            console.log(" !!! ERROR: WU should be CONCLUIDO but is PENDENTE/EM_ANDAMENTO");

            // Fix it?
            await db.update(workUnits)
                .set({ status: "concluido", completedAt: new Date().toISOString() })
                .where(eq(workUnits.id, wu.id));
            console.log(" !!! FIXED status to CONCLUIDO");
        }
    }
}

main().catch(console.error);
