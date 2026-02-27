/**
 * Initialize the TiDB database schema.
 *
 * Usage:
 *   TIDB_HOST=... TIDB_USER=... TIDB_PASSWORD=... TIDB_DATABASE=... npx tsx scripts/init-db.ts
 */
import { connect } from "@tidbcloud/serverless";

async function main() {
  const host = process.env.TIDB_HOST;
  const username = process.env.TIDB_USER;
  const password = process.env.TIDB_PASSWORD;
  const database = process.env.TIDB_DATABASE;

  if (!host || !username || !password || !database) {
    console.error("Missing env vars: TIDB_HOST, TIDB_USER, TIDB_PASSWORD, TIDB_DATABASE");
    process.exit(1);
  }

  const conn = connect({ host, username, password, database });

  console.log("Creating memory_spaces table...");
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS memory_spaces (
      id VARCHAR(36) PRIMARY KEY,
      token VARCHAR(64) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      member_count INT DEFAULT 1,
      INDEX idx_token (token)
    )
  `);

  console.log("Creating memories table...");
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS memories (
      id VARCHAR(36) PRIMARY KEY,
      space_token VARCHAR(64) NOT NULL,
      key_name VARCHAR(255),
      content TEXT NOT NULL,
      source VARCHAR(100),
      tags JSON,
      metadata JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_space_token (space_token),
      INDEX idx_source (space_token, source),
      INDEX idx_key (space_token, key_name),
      FULLTEXT INDEX idx_content (content)
    )
  `);

  console.log("Done! Schema initialized.");
}

main().catch((err) => {
  console.error("Failed to init schema:", err);
  process.exit(1);
});
