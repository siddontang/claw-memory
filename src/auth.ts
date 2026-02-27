import type { Connection } from "@tidbcloud/serverless";
import { query } from "./db";
import { errorResponse, isValidToken } from "./utils";
import type { MemorySpace } from "./types";

/**
 * Extract and validate the bearer token from the Authorization header.
 * Returns the token string or a Response (error).
 */
export async function authenticate(
  request: Request,
  conn: Connection
): Promise<{ token: string; space: MemorySpace } | Response> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("Missing Authorization header", 401);
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return errorResponse("Authorization header must be: Bearer <token>", 401);
  }

  const token = parts[1];
  if (!isValidToken(token)) {
    return errorResponse("Invalid token format", 401);
  }

  const spaces = await query<MemorySpace>(
    conn,
    "SELECT id, token, created_at, member_count FROM memory_spaces WHERE token = ?",
    [token]
  );

  if (spaces.length === 0) {
    return errorResponse("Token not found", 401);
  }

  return { token, space: spaces[0] };
}
