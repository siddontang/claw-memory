import type { Connection } from "@tidbcloud/serverless";
import { getTokenConnection } from "./db";
import { errorResponse, isValidToken } from "./utils";

export interface AuthResult {
  token: string;
  tokenConn: Connection;
}

/**
 * Extract and validate the bearer token from the Authorization header.
 * Looks up the token in the central registry and returns the per-token connection.
 * Passes the encryption key (server + optional client) through for decryption.
 */
export async function authenticate(
  request: Request,
  registryConn: Connection,
  serverEncryptionKey: string
): Promise<AuthResult | Response> {
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

  const clientKey = request.headers.get("X-Encryption-Key") || undefined;

  const result = await getTokenConnection(registryConn, token, serverEncryptionKey, clientKey);

  if (result === "not_found") {
    return errorResponse("Token not found", 401);
  }
  if (result === "client_key_required") {
    return errorResponse("This memory space requires an encryption key", 401);
  }
  if (result === "decrypt_failed") {
    return errorResponse("Invalid encryption key", 401);
  }

  return { token, tokenConn: result };
}
