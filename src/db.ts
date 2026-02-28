import { connect, Connection } from "@tidbcloud/serverless";
import type { Env, TokenRegistry } from "./types";

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

/** Look up a token's connection info from the registry and return a cached connection */
export async function getTokenConnection(
  registryConn: Connection,
  token: string
): Promise<Connection | null> {
  const cached = _tokenConnections.get(token);
  if (cached) return cached;

  const rows = await query<TokenRegistry>(
    registryConn,
    "SELECT token, tidb_host, tidb_port, tidb_user, tidb_password, tidb_database, expires_at, created_at FROM token_registry WHERE token = ?",
    [token]
  );

  if (rows.length === 0) return null;

  const reg = rows[0];
  const conn = connect({
    host: reg.tidb_host,
    username: reg.tidb_user,
    password: reg.tidb_password,
    database: reg.tidb_database,
  });

  _tokenConnections.set(token, conn);
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
