
import { db } from "./server/db";
import { workUnits, orderItems, orders, products } from "@shared/schema";
import { eq, and } from "drizzle-orm";

async function main() {
    console.log("Debugging DB...");

    // Find PED-001
    const order = await db.query.orders.findFirst({
        where: (orders, { eq }) => eq(orders.erpOrderId, "PED-001")
    });

    if (!order) {
        console.log("Order PED-001 not found");
        return;
    }
    console.log("Order found:", order.id, order.erpOrderId);

    // Find Work Units for this order
    const wus = await db.select().from(workUnits).where(eq(workUnits.orderId, order.id));
    console.log("Work Units:", wus);

    // For each WU, check matching items
    for (const wu of wus) {
        console.log(`\nChecking WU ${wu.id} (Section: ${wu.section}, Point: ${wu.pickupPoint})`);

        // Check items matching this WU criteria
        const items = await db.select().from(orderItems).where(and(
            eq(orderItems.orderId, wu.orderId),
            eq(orderItems.pickupPoint, wu.pickupPoint),
            // Loose check - ignoring section to see if that's the issue
        ));

        console.log(`Found ${items.length} items for Order+Point match.`);

        for (const item of items) {
            console.log(` - Item ${item.id} | Section: '${item.section}' | Qty: ${item.separatedQty}/${item.quantity} | Status: ${item.status}`);
            if (wu.section && item.section !== wu.section) {
                console.log(`   MISMATCH! WU Section '${wu.section}' vs Item Section '${item.section}'`);
            } else {
                console.log(`   MATCH!`);
            }
        }
    }
}

main().catch(console.error);
