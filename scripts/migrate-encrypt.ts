/**
 * Migrate existing plaintext token_registry entries to encrypted format.
 *
 * This is a standalone Node.js script (not a CF Worker) that:
 *   1. Reads all plaintext entries from the old schema
 *   2. Encrypts connection info with the server ENCRYPTION_KEY
 *   3. Alters the table schema
 *   4. Updates each row with encrypted data
 *
 * Usage:
 *   REGISTRY_HOST=... REGISTRY_USER=... REGISTRY_PASSWORD=... REGISTRY_DATABASE=... \
 *   ENCRYPTION_KEY=... npx tsx scripts/migrate-encrypt.ts
 */
import { connect } from "@tidbcloud/serverless";
import * as crypto from "node:crypto";

// ---- Node.js-compatible AES-256-GCM encrypt (mirrors src/crypto.ts logic) ----

async function deriveKeyNode(serverKey: string): Promise<Buffer> {
  // HKDF: extract with salt, expand with info — matches Web Crypto HKDF
  const salt = Buffer.from("claw-memory-v1", "utf-8");
  const info = Buffer.from("aes-256-gcm", "utf-8");
  const keyMaterial = Buffer.from(serverKey, "utf-8");

  return new Promise((resolve, reject) => {
    crypto.hkdf("sha256", keyMaterial, salt, info, 32, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(Buffer.from(derivedKey));
    });
  });
}

async function encryptNode(
  plaintext: string,
  serverKey: string
): Promise<{ ciphertext: string; iv: string }> {
  const key = await deriveKeyNode(serverKey);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Match Web Crypto format: ciphertext + authTag concatenated, then base64
  const combined = Buffer.concat([encrypted, authTag]);
  return {
    ciphertext: combined.toString("base64"),
    iv: iv.toString("hex"),
  };
}

// ---- Migration ----

interface OldTokenRow {
  token: string;
  tidb_host: string;
  tidb_port: number;
  tidb_user: string;
  tidb_password: string;
  tidb_database: string;
  expires_at: string | null;
  created_at: string;
}

async function main() {
  const host = process.env.REGISTRY_HOST;
  const username = process.env.REGISTRY_USER;
  const password = process.env.REGISTRY_PASSWORD;
  const database = process.env.REGISTRY_DATABASE;
  const encryptionKey = process.env.ENCRYPTION_KEY;

  if (!host || !username || !password || !database || !encryptionKey) {
    console.error(
      "Missing env vars: REGISTRY_HOST, REGISTRY_USER, REGISTRY_PASSWORD, REGISTRY_DATABASE, ENCRYPTION_KEY"
    );
    process.exit(1);
  }

  const conn = connect({ host, username, password, database });

  // 1. Check if old columns exist (migration may have already run)
  console.log("Checking current schema...");
  const columns = (await conn.execute(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'token_registry'",
    [database]
  )) as unknown as Array<{ COLUMN_NAME: string }>;

  const colNames = columns.map((c) => c.COLUMN_NAME);

  if (colNames.includes("connection_encrypted")) {
    console.log("Already migrated (connection_encrypted column exists). Nothing to do.");
    return;
  }

  if (!colNames.includes("tidb_host")) {
    console.error("Unexpected schema — no tidb_host or connection_encrypted column found.");
    process.exit(1);
  }

  // 2. Read all existing plaintext rows
  console.log("Reading existing tokens...");
  const rows = (await conn.execute(
    "SELECT token, tidb_host, tidb_port, tidb_user, tidb_password, tidb_database, expires_at, created_at FROM token_registry"
  )) as unknown as OldTokenRow[];

  console.log(`Found ${rows.length} tokens to migrate.`);

  // 3. Add new columns
  console.log("Adding new columns...");
  await conn.execute(
    "ALTER TABLE token_registry ADD COLUMN connection_encrypted TEXT, ADD COLUMN iv VARCHAR(32), ADD COLUMN has_client_key BOOLEAN DEFAULT FALSE"
  );

  // 4. Encrypt each row and update
  for (const row of rows) {
    const connInfo = JSON.stringify({
      host: row.tidb_host,
      port: row.tidb_port,
      user: row.tidb_user,
      password: row.tidb_password,
      database: row.tidb_database,
    });

    const { ciphertext, iv } = await encryptNode(connInfo, encryptionKey);

    await conn.execute(
      "UPDATE token_registry SET connection_encrypted = ?, iv = ?, has_client_key = FALSE WHERE token = ?",
      [ciphertext, iv, row.token]
    );

    console.log(`  Encrypted: ${row.token.slice(0, 16)}...`);
  }

  // 5. Make new columns NOT NULL and drop old columns
  console.log("Finalizing schema...");
  await conn.execute("ALTER TABLE token_registry MODIFY connection_encrypted TEXT NOT NULL");
  await conn.execute("ALTER TABLE token_registry MODIFY iv VARCHAR(32) NOT NULL");
  await conn.execute(
    "ALTER TABLE token_registry DROP COLUMN tidb_host, DROP COLUMN tidb_port, DROP COLUMN tidb_user, DROP COLUMN tidb_password, DROP COLUMN tidb_database"
  );

  console.log(`Done! Migrated ${rows.length} tokens to encrypted format.`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
