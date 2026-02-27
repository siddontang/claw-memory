import { connect, Connection } from "@tidbcloud/serverless";
import type { Env } from "./types";

let _connection: Connection | null = null;

export function getConnection(env: Env): Connection {
  if (!_connection) {
    _connection = connect({
      host: env.TIDB_HOST,
      username: env.TIDB_USER,
      password: env.TIDB_PASSWORD,
      database: env.TIDB_DATABASE,
    });
  }
  return _connection;
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

/** Initialize the database schema */
export async function initSchema(conn: Connection): Promise<void> {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS memory_spaces (
      id VARCHAR(36) PRIMARY KEY,
      token VARCHAR(64) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      member_count INT DEFAULT 1,
      INDEX idx_token (token)
    )
  `);

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
    )
  `);
}
