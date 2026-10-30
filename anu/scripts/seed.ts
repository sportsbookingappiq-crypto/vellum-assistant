/** Loads fake users and tasks into DATABASE_URL. Idempotent. --reset restores the seeded tasks. */
import { connect, Db } from "../src/db/client.js";
import { SEED_USERS, seed } from "../src/db/seed.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("seed: DATABASE_URL is not set (run bun run db:setup)");
  process.exit(1);
}
const db = new Db(connect(url, { max: 1 }), process.env.ANU_DB_APP_ROLE || "anu_platform_app");
try {
  const result = await seed(db, { reset: process.argv.includes("--reset") });
  console.log(`seed: ${result.users} users present, ${result.tasks} tasks created now`);
  for (const user of SEED_USERS) console.log(`seed: ${user.phone}  ${user.label}`);
} finally {
  await db.close();
}
