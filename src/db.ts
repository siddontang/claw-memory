import { connect, Connection } from "@tidbcloud/serverless";
import type { Env, TokenRegistry, ConnectionInfo } from "./types";
import { decrypt } from "./crypto";

let _registryConnection: Connection | null = null;
const _tokenConnections = new Map<string, Connection>();

/** Get a connection to the central registry database */
export function getRegistryConnection(env: Env): Connection {
  if (!_registryConnection) {
    _registryConnection = connect({
      host: env.REGISTRY_HOST,
      username: env.REGISTRY_USER,
      password: env.REGISTRY_PASSWORD,
      database: env.REGISTRY_DATABASE,
    });
  }
  return _registryConnection;
}

type TokenConnectionError = "not_found" | "client_key_required" | "decrypt_failed";

/** Look up a token's connection info from the registry, decrypt, and return a cached connection */
export async function getTokenConnection(
  registryConn: Connection,
  token: string,
  serverKey: string,
  clientKey?: string
): Promise<Connection | TokenConnectionError> {
  // Cache key includes client key presence so different keys don't collide
  const cacheKey = clientKey ? `${token}:${clientKey}` : token;
  const cached = _tokenConnections.get(cacheKey);
  if (cached) return cached;

  const rows = await query<TokenRegistry>(
    registryConn,
    "SELECT token, connection_encrypted, iv, has_client_key, expires_at, created_at FROM token_registry WHERE token = ?",
    [token]
  );

  if (rows.length === 0) return "not_found";

  const reg = rows[0];

  // If token was created with a client key, caller must provide one
  if (reg.has_client_key && !clientKey) {
    return "client_key_required";
  }

  // Decrypt the connection info
  let connInfo: ConnectionInfo;
  try {
    const plaintext = await decrypt(
      reg.connection_encrypted,
      reg.iv,
      serverKey,
      reg.has_client_key ? clientKey : undefined
    );
    connInfo = JSON.parse(plaintext);
  } catch {
    return "decrypt_failed";
  }

  const conn = connect({
    host: connInfo.host,
    username: connInfo.user,
    password: connInfo.password,
    database: connInfo.database,
  });

  _tokenConnections.set(cacheKey, conn);
  return conn;
}

/** Create a connection from raw connection details (used during provisioning before registry entry exists) */
export function createConnection(opts: {
  host: string;
  username: string;
  password: string;
  database: string;
}): Connection {
  return connect(opts);
}

export async function query<T = Record<string, unknown>>(
  conn: Connection,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await conn.execute(sql, params);
  return (result as unknown as T[]) ?? [];
}

export async function execute(
  conn: Connection,
  sql: string,
  params?: unknown[]
): Promise<void> {
  await conn.execute(sql, params);
}

/** Initialize the memories table on a per-token TiDB instance */
export async function initSchema(conn: Connection): Promise<void> {
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
      INDEX idx_key (space_token, key_name)
    )
  `);
}
