import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./index.js";

await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text primary key, applied_at timestamptz not null default now())");
const directory = new URL("../migrations/", import.meta.url);
for (const name of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
  const applied = await pool.query<{ name: string }>("SELECT name FROM schema_migrations WHERE name = $1", [name]);
  if (applied.rowCount) continue;
  const sql = await readFile(join(directory.pathname, name), "utf8");
  await pool.query("BEGIN");
  try { await pool.query(sql); await pool.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]); await pool.query("COMMIT"); }
  catch (error) { await pool.query("ROLLBACK"); throw error; }
  console.log(`Applied ${name}`);
}
await pool.end();
