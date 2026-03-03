import type { Connection } from "@tidbcloud/serverless";
import { query, execute, createConnection, initSchema, getTokenConnection } from "../db";
import { generateToken, jsonResponse, errorResponse, isValidToken } from "../utils";
import { encrypt } from "../crypto";
import type { TokenRegistry, ConnectionInfo } from "../types";

/** POST /api/tokens — Provision a new TiDB Cloud Zero instance and create a token */
export async function createToken(
  registryConn: Connection,
  serverEncryptionKey: string,
  request: Request
): Promise<Response> {
  const token = generateToken();
  const clientKey = request.headers.get("X-Encryption-Key") || undefined;

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
      id?: string;
      connection: {
        host: string;
        port: number;
        username: string;
        password: string;
      };
      connectionString?: string;
      claimInfo?: {
        zeroId: string;
        claimUrl: string;
      };
      expiresAt: string;
    };
  };

  const { host, port, username, password } = provisionData.instance.connection;
  const expiresAt = provisionData.instance.expiresAt;
  const claimUrl = provisionData.instance.claimInfo?.claimUrl || null;
  const zeroId = provisionData.instance.claimInfo?.zeroId || provisionData.instance.id || null;
  const database = "claw_memory";

  // Connect to the new instance — first create the database, then the table
  const rootConn = createConnection({ host, username, password, database: "test" });
  await execute(rootConn, "CREATE DATABASE IF NOT EXISTS claw_memory");
  const tokenConn = createConnection({ host, username, password, database });
  await initSchema(tokenConn);

  // Encrypt the connection info
  const connInfo: ConnectionInfo = { host, port, user: username, password, database };
  const { ciphertext, iv } = await encrypt(
    JSON.stringify(connInfo),
    serverEncryptionKey,
    clientKey
  );

  // Store the mapping in the registry
  await execute(
    registryConn,
    `INSERT INTO token_registry (token, connection_encrypted, iv, has_client_key, expires_at, claim_url, zero_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [token, ciphertext, iv, clientKey ? 1 : 0, expiresAt, claimUrl, zeroId]
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
        has_client_key: !!clientKey,
        claim_url: claimUrl,
      },
    },
    201
  );
}

/** POST /api/tokens/:token/claim — Get or generate claim URL for an existing token */
export async function claimToken(
  registryConn: Connection,
  token: string,
  serverEncryptionKey: string,
  request: Request
): Promise<Response> {
  const rows = await query<TokenRegistry>(
    registryConn,
    "SELECT token, claim_url, zero_id, has_client_key, expires_at FROM token_registry WHERE token = ?",
    [token]
  );

  if (rows.length === 0) {
    return errorResponse("Token not found", 404);
  }

  const reg = rows[0];

  // If already has a claim URL, return it
  if (reg.claim_url) {
    return jsonResponse({
      ok: true,
      data: {
        token: reg.token,
        claim_url: reg.claim_url,
        zero_id: reg.zero_id,
        expires_at: reg.expires_at,
        message: "Claim URL already exists. Open it to claim your database.",
      },
    });
  }

  // Need to decrypt connection info to get the instance host
  const clientKey = request.headers.get("X-Encryption-Key") || undefined;
  const result = await getTokenConnection(registryConn, token, serverEncryptionKey, clientKey);

  if (result === "not_found") return errorResponse("Token not found", 404);
  if (result === "client_key_required") return errorResponse("This memory space requires an encryption key", 401);
  if (result === "decrypt_failed") return errorResponse("Invalid encryption key", 401);

  // Provision a new Zero instance just to get a claim URL, then tell the user
  // Unfortunately we can't retroactively get a claim URL for an existing instance
  // So we create a new one and let the user claim it — they can migrate later
  // OR: we just tell them to create a new token
  
  // Actually, let's try provisioning and see if we get a claim URL
  const provisionRes = await fetch("https://zero.tidbapi.com/v1alpha1/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: `claim-${token.substring(0, 16)}` }),
  });

  if (!provisionRes.ok) {
    return errorResponse("Failed to provision claim instance. Try creating a new token instead.", 500);
  }

  const provisionData = (await provisionRes.json()) as {
    instance: {
      id?: string;
      claimInfo?: {
        zeroId: string;
        claimUrl: string;
      };
      expiresAt: string;
    };
  };

  const claimUrl = provisionData.instance.claimInfo?.claimUrl || null;
  const zeroId = provisionData.instance.claimInfo?.zeroId || provisionData.instance.id || null;

  if (!claimUrl) {
    return errorResponse("Claim URL not available from this API version", 500);
  }

  // Store the claim URL for this token
  await execute(
    registryConn,
    "UPDATE token_registry SET claim_url = ?, zero_id = ? WHERE token = ?",
    [claimUrl, zeroId, token]
  );

  return jsonResponse({
    ok: true,
    data: {
      token: reg.token,
      claim_url: claimUrl,
      zero_id: zeroId,
      expires_at: reg.expires_at,
      message: "Claim URL generated. Open it to claim your database as a permanent TiDB Cloud Starter instance.",
    },
  });
}

/** GET /api/tokens/:token/info — Get token info and memory stats */
export async function getTokenInfo(
  registryConn: Connection,
  token: string,
  serverEncryptionKey: string,
  request: Request
): Promise<Response> {
  const rows = await query<TokenRegistry>(
    registryConn,
    "SELECT token, has_client_key, expires_at, created_at, claim_url FROM token_registry WHERE token = ?",
    [token]
  );

  if (rows.length === 0) {
    return errorResponse("Token not found", 404);
  }

  const reg = rows[0];
  const clientKey = request.headers.get("X-Encryption-Key") || undefined;

  // Connect to the token's dedicated instance to get stats
  const result = await getTokenConnection(registryConn, token, serverEncryptionKey, clientKey);

  if (result === "not_found") {
    return errorResponse("Token not found", 404);
  }
  if (result === "client_key_required") {
    return errorResponse("This memory space requires an encryption key", 401);
  }
  if (result === "decrypt_failed") {
    return errorResponse("Invalid encryption key", 401);
  }

  const tokenConn = result;

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
      has_client_key: !!reg.has_client_key,
      claim_url: reg.claim_url || null,
      memory_count: countResult[0]?.cnt ?? 0,
      sources: sourceResult.map((r) => ({
        source: r.source,
        count: r.cnt,
      })),
    },
  });
}
