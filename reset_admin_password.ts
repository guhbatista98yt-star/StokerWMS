
import { db } from "./server/db";
import { users } from "@shared/schema";
import { hashPassword } from "./server/auth";
import { eq } from "drizzle-orm";

async function run() {
    console.log("Resetting admin password...");
    const password = await hashPassword("admin123");
    await db.update(users).set({ password }).where(eq(users.username, "admin"));
    console.log("Password reset to 'admin123'");
    process.exit(0);
}

run().catch(console.error);
