import { db } from "./server/db";
import { companies } from "./shared/schema";

async function run() {
  try {
    const all = await db.select().from(companies);
    console.log("All companies in DB:", all);
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

run();
