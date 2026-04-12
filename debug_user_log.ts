
import { db } from "./server/db";
import { users } from "./shared/schema";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Starting debug script v3 (No changes)...");

    // 1. Create a test user
    const testUsername = "debug_test_user_" + Date.now();
    console.log("Creating user:", testUsername);

    const [newUser] = await db.insert(users).values({
        username: testUsername,
        password: "password123",
        name: "Debug User",
        role: "separacao",
        sections: ["1"],
        settings: { allowManualQty: true },
        active: true,
    }).returning();

    console.log("User created:", newUser.id);

    // 2. Update user with SAME data
    console.log("Updating user with SAME data...");
    const updates = {
        username: testUsername,
        name: "Debug User",
        role: "separacao",
        sections: ["1"],
        settings: { allowManualQty: true },
        active: true
    };

    const [updatedUser] = await db.update(users)
        .set(updates as any)
        .where(eq(users.id, newUser.id))
        .returning();

    if (updatedUser) {
        console.log("User updated successfully:", updatedUser.id);
    } else {
        console.error("FAILED: Update returned undefined/empty array");
    }

    // 3. Cleanup
    console.log("Cleaning up...");
    await db.delete(users).where(eq(users.id, newUser.id));
    console.log("Done.");
}

main().catch(console.error);
