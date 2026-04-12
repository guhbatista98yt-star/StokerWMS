import { db } from "./server/db";
import { users } from "./shared/schema";

async function run() {
  try {
    const allUsers = await db.select().from(users);
    console.log("Users:", allUsers.map(u => ({ username: u.username, allowed: u.allowedCompanies })));
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

run();
