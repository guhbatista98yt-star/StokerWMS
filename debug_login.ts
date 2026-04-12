
import { db } from "./server/db";
import { users, sessions } from "./shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import crypto from "crypto";

async function debug() {
    console.log("--- DEBUGGING LOGIN ---");

    // 1. Check User
    const [user] = await db.select().from(users).where(eq(users.username, "admin"));
    if (!user) {
        console.log("❌ User 'admin' not found!");
        return;
    }
    console.log("✅ User 'admin' found. ID:", user.id);
    console.log("   Stored Hash:", user.password);

    // 2. Verify Password
    const isValid = await bcrypt.compare("1234", user.password);
    console.log(`🔑 Password '1234' is valid: ${isValid ? "YES ✅" : "NO ❌"}`);

    if (!isValid) return;

    // 3. Try Insert Session (simulate createAuthSession)
    try {
        const token = crypto.randomUUID();
        const sessionKey = `${user.id}:${Date.now()}`;
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        console.log("📝 Attempting to insert session...");
        console.log("   Token:", token);

        // Attempt insert similar to storage.ts
        const [session] = await db.insert(sessions).values({
            userId: user.id,
            token,
            sessionKey,
            expiresAt: expiresAt.toISOString(),
            // 'id' and 'createdAt' should satisfy defaults?
            // Drizzle should generate ID? 
            // If Drizzle schema has $defaultFn, it generates it in JS and passes it to SQL?
            // Let's see if it fails.
        }).returning();

        console.log("✅ Session created successfully:", session.id);
    } catch (error) {
        console.log("❌ Session Insert FAILED:", error);
    }
}

debug().catch(console.error);
