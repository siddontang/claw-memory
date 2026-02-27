import type { Connection } from "@tidbcloud/serverless";
import { query, execute } from "../db";
import { generateId, generateToken, jsonResponse, errorResponse } from "../utils";
import type { MemorySpace } from "../types";

/** POST /api/tokens — Create a new memory space */
export async function createToken(conn: Connection): Promise<Response> {
  const id = generateId();
  const token = generateToken();

  await execute(
    conn,
    "INSERT INTO memory_spaces (id, token, member_count) VALUES (?, ?, 1)",
    [id, token]
  );

  const spaces = await query<MemorySpace>(
    conn,
    "SELECT id, token, created_at, member_count FROM memory_spaces WHERE id = ?",
    [id]
  );

  return jsonResponse(
    {
      ok: true,
      data: {
        token: spaces[0].token,
        created_at: spaces[0].created_at,
      },
    },
    201
  );
}

/** GET /api/tokens/:token/info — Get memory space info */
export async function getTokenInfo(
  conn: Connection,
  token: string
): Promise<Response> {
  const spaces = await query<MemorySpace>(
    conn,
    "SELECT id, token, created_at, member_count FROM memory_spaces WHERE token = ?",
    [token]
  );

  if (spaces.length === 0) {
    return errorResponse("Token not found", 404);
  }

  const space = spaces[0];

  // Get memory stats
  const countResult = await query<{ cnt: number }>(
    conn,
    "SELECT COUNT(*) as cnt FROM memories WHERE space_token = ?",
    [token]
  );

  const sourceResult = await query<{ source: string; cnt: number }>(
    conn,
    "SELECT COALESCE(source, 'unknown') as source, COUNT(*) as cnt FROM memories WHERE space_token = ? GROUP BY source",
    [token]
  );

  return jsonResponse({
    ok: true,
    data: {
      token: space.token,
      created_at: space.created_at,
      member_count: space.member_count,
      memory_count: countResult[0]?.cnt ?? 0,
      sources: sourceResult.map((r) => ({
        source: r.source,
        count: r.cnt,
      })),
    },
  });
}
