/**
 * Initialize the registry database schema.
 *
 * Usage:
 *   REGISTRY_HOST=... REGISTRY_USER=... REGISTRY_PASSWORD=... REGISTRY_DATABASE=... npx tsx scripts/init-db.ts
 */
import { connect } from "@tidbcloud/serverless";

async function main() {
  const host = process.env.REGISTRY_HOST;
  const username = process.env.REGISTRY_USER;
  const password = process.env.REGISTRY_PASSWORD;
  const database = process.env.REGISTRY_DATABASE;

  if (!host || !username || !password || !database) {
    console.error("Missing env vars: REGISTRY_HOST, REGISTRY_USER, REGISTRY_PASSWORD, REGISTRY_DATABASE");
    process.exit(1);
  }

  const conn = connect({ host, username, password, database });

  console.log("Creating token_registry table...");
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS token_registry (
      token VARCHAR(64) PRIMARY KEY,
      connection_encrypted TEXT NOT NULL,
      iv VARCHAR(32) NOT NULL,
      has_client_key BOOLEAN DEFAULT FALSE,
      expires_at DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Done! Registry schema initialized.");
}

main().catch((err) => {
  console.error("Failed to init schema:", err);
  process.exit(1);
});
