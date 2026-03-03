import { getRegistryConnection } from "./db";
import { authenticate } from "./auth";
import { createToken, getTokenInfo, claimToken } from "./routes/tokens";
import {
  createMemory,
  listMemories,
  getMemory,
  updateMemory,
  deleteMemory,
  bulkImport,
} from "./routes/memories";
import { errorResponse, jsonResponse, isValidToken } from "./utils";
import type { Env } from "./types";

// In-memory rate limiter (per-isolate, resets on cold start — good enough for CF Workers)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }

  entry.count++;
  return entry.count <= RATE_LIMIT;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Encryption-Key",
    "Access-Control-Max-Age": "86400",
  };
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      const response = await handleRequest(request, env);
      return withCors(response);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Internal server error";
      console.error("Unhandled error:", err);
      return withCors(errorResponse(message, 500));
    }
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Health check
  if (path === "/" || path === "/health") {
    return jsonResponse({ ok: true, service: "claw-memory", version: "2.1.0" });
  }

  const registryConn = getRegistryConnection(env);

  // --- Token routes (no auth required) ---

  // POST /api/tokens
  if (path === "/api/tokens" && method === "POST") {
    return createToken(registryConn, env.ENCRYPTION_KEY, request);
  }

  // GET /api/tokens/:token/info
  const tokenInfoMatch = path.match(/^\/api\/tokens\/([^/]+)\/info$/);
  if (tokenInfoMatch && method === "GET") {
    const token = tokenInfoMatch[1];
    if (!isValidToken(token)) {
      return errorResponse("Invalid token format", 400);
    }
    return getTokenInfo(registryConn, token, env.ENCRYPTION_KEY, request);
  }

  // POST /api/tokens/:token/claim — get claim URL for existing token's Zero instance
  const claimMatch = path.match(/^\/api\/tokens\/([^/]+)\/claim$/);
  if (claimMatch && method === "POST") {
    const token = claimMatch[1];
    if (!isValidToken(token)) {
      return errorResponse("Invalid token format", 400);
    }
    return claimToken(registryConn, token, env.ENCRYPTION_KEY, request);
  }

  // --- Memory routes (auth required) ---

  if (path.startsWith("/api/memories")) {
    // Authenticate — looks up token in registry, returns per-token connection
    const authResult = await authenticate(request, registryConn, env.ENCRYPTION_KEY);
    if (authResult instanceof Response) return authResult;
    const { token, tokenConn } = authResult;

    // Rate limit per token
    if (!checkRateLimit(token)) {
      return errorResponse("Rate limit exceeded (100 req/min)", 429);
    }

    // POST /api/memories/bulk
    if (path === "/api/memories/bulk" && method === "POST") {
      return bulkImport(request, tokenConn, token);
    }

    // POST /api/memories
    if (path === "/api/memories" && method === "POST") {
      return createMemory(request, tokenConn, token);
    }

    // GET /api/memories
    if (path === "/api/memories" && method === "GET") {
      return listMemories(request, tokenConn, token);
    }

    // Routes with :id
    const idMatch = path.match(/^\/api\/memories\/([a-f0-9-]{36})$/);
    if (idMatch) {
      const id = idMatch[1];

      if (method === "GET") return getMemory(tokenConn, token, id);
      if (method === "PUT") return updateMemory(request, tokenConn, token, id);
      if (method === "DELETE") return deleteMemory(tokenConn, token, id);

      return errorResponse("Method not allowed", 405);
    }

    return errorResponse("Not found", 404);
  }

  return errorResponse("Not found", 404);
}
