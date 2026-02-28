import type { Connection } from "@tidbcloud/serverless";
import { query, execute, createConnection, initSchema, getTokenConnection } from "../db";
import { generateToken, jsonResponse, errorResponse, isValidToken } from "../utils";
import type { TokenRegistry } from "../types";

/** POST /api/tokens — Provision a new TiDB Cloud Zero instance and create a token */
export async function createToken(registryConn: Connection): Promise<Response> {
  const token = generateToken();

  // Provision a new TiDB Cloud Zero instance
  const provisionRes = await fetch("https://zero.tidbapi.com/v1alpha1/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!provisionRes.ok) {
    const errText = await provisionRes.text();
    console.error("TiDB Zero provisioning failed:", provisionRes.status, errText);
    return errorResponse("Failed to provision database instance", 500);
  }

  const provisionData = (await provisionRes.json()) as {
    instance: {
      connection: {
        host: string;
        port: number;
        username: string;
        password: string;
      };
      expiresAt: string;
    };
  };

  const { host, port, username, password } = provisionData.instance.connection;
  const expiresAt = provisionData.instance.expiresAt;
  const database = "claw_memory";

  // Connect to the new instance — first create the database, then the table
  const rootConn = createConnection({ host, username, password, database: "test" });
  await execute(rootConn, "CREATE DATABASE IF NOT EXISTS claw_memory");
  const tokenConn = createConnection({ host, username, password, database });
  await initSchema(tokenConn);

  // Store the mapping in the registry
  await execute(
    registryConn,
    `INSERT INTO token_registry (token, tidb_host, tidb_port, tidb_user, tidb_password, tidb_database, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [token, host, port, username, password, database, expiresAt]
  );

  // Read back to get created_at
  const rows = await query<TokenRegistry>(
    registryConn,
    "SELECT token, created_at, expires_at FROM token_registry WHERE token = ?",
    [token]
  );

  return jsonResponse(
    {
      ok: true,
      data: {
        token: rows[0].token,
        created_at: rows[0].created_at,
        expires_at: rows[0].expires_at,
      },
    },
    201
  );
}

/** GET /api/tokens/:token/info — Get token info and memory stats */
export async function getTokenInfo(
  registryConn: Connection,
  token: string
): Promise<Response> {
  const rows = await query<TokenRegistry>(
    registryConn,
    "SELECT token, expires_at, created_at FROM token_registry WHERE token = ?",
    [token]
  );

  if (rows.length === 0) {
    return errorResponse("Token not found", 404);
  }

  const reg = rows[0];

  // Connect to the token's dedicated instance to get stats
  const tokenConn = await getTokenConnection(registryConn, token);
  if (!tokenConn) {
    return errorResponse("Token database unavailable", 500);
  }

  const countResult = await query<{ cnt: number }>(
    tokenConn,
    "SELECT COUNT(*) as cnt FROM memories WHERE space_token = ?",
    [token]
  );

  const sourceResult = await query<{ source: string; cnt: number }>(
    tokenConn,
    "SELECT COALESCE(source, 'unknown') as source, COUNT(*) as cnt FROM memories WHERE space_token = ? GROUP BY source",
    [token]
  );

  return jsonResponse({
    ok: true,
    data: {
      token: reg.token,
      created_at: reg.created_at,
      expires_at: reg.expires_at,
      memory_count: countResult[0]?.cnt ?? 0,
      sources: sourceResult.map((r) => ({
        source: r.source,
        count: r.cnt,
      })),
    },
  });
}
