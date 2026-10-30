/** Applies pending migrations to DATABASE_URL (or ANU_TEST_DATABASE_URL with --test). */
import { connect } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";

const useTest = process.argv.includes("--test");
const url = useTest ? process.env.ANU_TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) {
  console.error(`db-migrate: ${useTest ? "ANU_TEST_DATABASE_URL" : "DATABASE_URL"} is not set (run bun run db:setup)`);
  process.exit(1);
}
const role = process.env.ANU_DB_APP_ROLE || "anu_platform_app";
const sql = connect(url, { max: 1 });
try {
  const applied = await migrate(sql, role, (line) => console.log(`db-migrate: ${line}`));
  const database = new URL(url).pathname.slice(1);
  console.log(`db-migrate: ${database} is up to date (${applied.length} applied now)`);
} finally {
  await sql.end();
}
