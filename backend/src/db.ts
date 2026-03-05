import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "./config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
});

export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const migrationFile = join(__dirname, "migrations", "001_init.sql");
    const sql = readFileSync(migrationFile, "utf-8");

    const { rows } = await client.query(
      "SELECT 1 FROM _migrations WHERE name = $1",
      ["001_init"]
    );

    if (rows.length === 0) {
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [
        "001_init",
      ]);
      console.log("✓ Migration 001_init appliquée");
    } else {
      console.log("✓ Migration 001_init déjà appliquée");
    }
  } finally {
    client.release();
  }
}
