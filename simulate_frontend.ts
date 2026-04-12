
import { storage } from "./server/storage";
import { db } from "./server/db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Simulating Frontend Logic...");

    // 1. Skip specific user check for now just to see data
    // const [conferente] = await db.select().from(users).where(eq(users.username, "maria"));

    // 2. Get Work Units for conference
    const workUnits = await storage.getWorkUnits("conferencia");

    // 3. Filter like the frontend does (before my bad fix)
    // const allMyUnits = workUnits.filter(wu => wu.lockedBy === user.id);
    // For this test, we look at ALL conference units to see if ANY have valid items

    console.log(`Found ${workUnits.length} conference work units.`);

    for (const wu of workUnits) {
        console.log(`\nWU: ${wu.id} (Order: ${wu.order.erpOrderId}, Status: ${wu.order.status})`);

        // Frontend logic I reverted:
        // const allItems = units.flatMap... .filter(item => Number(item.separatedQty) > 0);

        const items = wu.items || [];
        const visibleItems = items.filter(item => Number(item.separatedQty) > 0);

        console.log(`  Total Items (Backend): ${items.length}`);
        console.log(`  Visible Items (Frontend Rule > 0): ${visibleItems.length}`);

        if (items.length > 0 && visibleItems.length === 0) {
            console.log("  [PROBLEM] Backend returns items, but Frontend hides them all!");
            console.log("  Sample Item separatedQty:", items[0].separatedQty);
        } else if (items.length === 0) {
            console.log("  [PROBLEM] Backend returns NO items!");
        } else {
            console.log("  [OK] Items are visible.");
        }
    }

    process.exit(0);
}

main().catch(console.error);
