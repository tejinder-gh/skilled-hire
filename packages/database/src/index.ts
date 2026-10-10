import dotenv from "dotenv";
dotenv.config({ path: [new URL("../../../.env", import.meta.url).pathname, ".env"] });
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
export const pool = new Pool({ connectionString, max: 12 });
export async function query<T extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(text, Array.from(values))).rows;
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
