import type { Connection } from "@tidbcloud/serverless";
import { query, getTokenConnection } from "./db";
import { errorResponse, isValidToken } from "./utils";
import type { TokenRegistry } from "./types";

/**
 * Extract and validate the bearer token from the Authorization header.
 * Looks up the token in the central registry and returns the per-token connection.
 */
export async function authenticate(
  request: Request,
  registryConn: Connection
): Promise<{ token: string; tokenConn: Connection } | Response> {
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

  const tokenConn = await getTokenConnection(registryConn, token);
  if (!tokenConn) {
    return errorResponse("Token not found", 401);
  }

  return { token, tokenConn };
}
