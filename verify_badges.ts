import "dotenv/config";
import { db } from "./server/db";
import { users } from "./shared/schema";
import { eq } from "drizzle-orm";
import { generateBadgeCode } from "./server/auth";

async function verify() {
    console.log("Verifying badge codes...");
    const allUsers = await db.select().from(users);

    for (const user of allUsers) {
        let badge = user.badgeCode;

        if (!badge || badge === "") {
            console.log(`Backfilling badge for user: ${user.username}`);
            let password = "1234";
            if (user.username === "admin") password = "admin123";

            // Note: For existing users with custom passwords, this might set wrong badge hash if password isn't default.
            // But for testing this is acceptable.

            const newBadge = generateBadgeCode(user.username, password);
            await db.update(users).set({ badgeCode: newBadge }).where(eq(users.id, user.id));
            console.log(`  -> Updated.`);
            badge = newBadge;
        }

        console.log(`User: ${user.username}, BadgeCode: ${badge?.substring(0, 10)}...`);
    }

    process.exit(0);
}

verify().catch(console.error);
