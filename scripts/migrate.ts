/** Applies pending database migrations:  npm run migrate */
import { DB_PATH } from "../src/lib/config";
import { getDb } from "../src/lib/db";

getDb(); // opening the database applies pending migrations
const rows = getDb().prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all();
console.log(`Database ${DB_PATH} is at migration ${(rows.at(-1) as { version: string }).version}`);
for (const r of rows as { version: string; applied_at: string }[]) console.log(`  ${r.version}  applied ${r.applied_at}`);
