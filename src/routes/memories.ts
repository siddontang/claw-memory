import type { Connection } from "@tidbcloud/serverless";
import { query, execute } from "../db";
import {
  generateId,
  jsonResponse,
  errorResponse,
  parseMarkdownMemories,
  clamp,
} from "../utils";
import type {
  Memory,
  CreateMemoryBody,
  UpdateMemoryBody,
  BulkImportBody,
  SearchParams,
} from "../types";

const MAX_CONTENT_LENGTH = 50_000;
const MAX_TAGS = 20;
const MAX_BULK_SIZE = 200;
const MAX_KEY_LENGTH = 255;
const MAX_SOURCE_LENGTH = 100;

function validateCreateBody(
  body: unknown
): { valid: true; data: CreateMemoryBody } | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.content !== "string" || !b.content.trim()) {
    return { valid: false, error: "content is required and must be a non-empty string" };
  }
  if (b.content.length > MAX_CONTENT_LENGTH) {
    return { valid: false, error: `content must be <= ${MAX_CONTENT_LENGTH} characters` };
  }
  if (b.key !== undefined && (typeof b.key !== "string" || b.key.length > MAX_KEY_LENGTH)) {
    return { valid: false, error: `key must be a string <= ${MAX_KEY_LENGTH} characters` };
  }
  if (b.source !== undefined && (typeof b.source !== "string" || b.source.length > MAX_SOURCE_LENGTH)) {
    return { valid: false, error: `source must be a string <= ${MAX_SOURCE_LENGTH} characters` };
  }
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || !b.tags.every((t: unknown) => typeof t === "string")) {
      return { valid: false, error: "tags must be an array of strings" };
    }
    if (b.tags.length > MAX_TAGS) {
      return { valid: false, error: `tags array must have <= ${MAX_TAGS} items` };
    }
  }
  if (b.metadata !== undefined && (typeof b.metadata !== "object" || b.metadata === null || Array.isArray(b.metadata))) {
    return { valid: false, error: "metadata must be a JSON object" };
  }

  return { valid: true, data: b as unknown as CreateMemoryBody };
}

/** POST /api/memories — Create a memory */
export async function createMemory(
  request: Request,
  conn: Connection,
  token: string
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const validation = validateCreateBody(body);
  if (!validation.valid) return errorResponse(validation.error);
  const { data } = validation;

  const id = generateId();
  await execute(
    conn,
    `INSERT INTO memories (id, space_token, key_name, content, source, tags, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      token,
      data.key ?? null,
      data.content,
      data.source ?? null,
      data.tags ? JSON.stringify(data.tags) : null,
      data.metadata ? JSON.stringify(data.metadata) : null,
    ]
  );

  const rows = await query<Memory>(
    conn,
    "SELECT * FROM memories WHERE id = ?",
    [id]
  );

  return jsonResponse({ ok: true, data: formatMemory(rows[0]) }, 201);
}

/** GET /api/memories — List/search memories */
export async function listMemories(
  request: Request,
  conn: Connection,
  token: string
): Promise<Response> {
  const url = new URL(request.url);
  const params: SearchParams = {
    q: url.searchParams.get("q") ?? undefined,
    tags: url.searchParams.get("tags") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    key: url.searchParams.get("key") ?? undefined,
  };

  const limit = clamp(parseInt(params.limit ?? "50", 10) || 50, 1, 200);
  const offset = Math.max(parseInt(params.offset ?? "0", 10) || 0, 0);

  const conditions: string[] = ["space_token = ?"];
  const values: unknown[] = [token];

  if (params.source) {
    conditions.push("source = ?");
    values.push(params.source);
  }

  if (params.key) {
    conditions.push("key_name = ?");
    values.push(params.key);
  }

  if (params.tags) {
    const tagList = params.tags.split(",").map((t) => t.trim()).filter(Boolean);
    for (const tag of tagList) {
      conditions.push("JSON_CONTAINS(tags, ?)");
      values.push(JSON.stringify(tag));
    }
  }

  if (params.q) {
    conditions.push("content LIKE CONCAT('%', ?, '%')");
    values.push(params.q);
  }

  const where = conditions.join(" AND ");

  const countRows = await query<{ cnt: number }>(
    conn,
    `SELECT COUNT(*) as cnt FROM memories WHERE ${where}`,
    values
  );
  const total = countRows[0]?.cnt ?? 0;

  const rows = await query<Memory>(
    conn,
    `SELECT * FROM memories WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );

  return jsonResponse({
    ok: true,
    data: rows.map(formatMemory),
    total,
    limit,
    offset,
  });
}

/** GET /api/memories/:id — Get single memory */
export async function getMemory(
  conn: Connection,
  token: string,
  id: string
): Promise<Response> {
  const rows = await query<Memory>(
    conn,
    "SELECT * FROM memories WHERE id = ? AND space_token = ?",
    [id, token]
  );

  if (rows.length === 0) {
    return errorResponse("Memory not found", 404);
  }

  return jsonResponse({ ok: true, data: formatMemory(rows[0]) });
}

/** PUT /api/memories/:id — Update a memory */
export async function updateMemory(
  request: Request,
  conn: Connection,
  token: string,
  id: string
): Promise<Response> {
  // Verify the memory exists and belongs to this token
  const existing = await query<Memory>(
    conn,
    "SELECT id FROM memories WHERE id = ? AND space_token = ?",
    [id, token]
  );

  if (existing.length === 0) {
    return errorResponse("Memory not found", 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  if (!body || typeof body !== "object") {
    return errorResponse("Request body must be a JSON object");
  }

  const b = body as UpdateMemoryBody;
  const sets: string[] = [];
  const values: unknown[] = [];

  if (b.content !== undefined) {
    if (typeof b.content !== "string" || !b.content.trim()) {
      return errorResponse("content must be a non-empty string");
    }
    if (b.content.length > MAX_CONTENT_LENGTH) {
      return errorResponse(`content must be <= ${MAX_CONTENT_LENGTH} characters`);
    }
    sets.push("content = ?");
    values.push(b.content);
  }

  if (b.key !== undefined) {
    sets.push("key_name = ?");
    values.push(b.key);
  }

  if (b.source !== undefined) {
    sets.push("source = ?");
    values.push(b.source);
  }

  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags)) return errorResponse("tags must be an array of strings");
    sets.push("tags = ?");
    values.push(JSON.stringify(b.tags));
  }

  if (b.metadata !== undefined) {
    sets.push("metadata = ?");
    values.push(JSON.stringify(b.metadata));
  }

  if (sets.length === 0) {
    return errorResponse("No fields to update");
  }

  await execute(
    conn,
    `UPDATE memories SET ${sets.join(", ")} WHERE id = ? AND space_token = ?`,
    [...values, id, token]
  );

  const rows = await query<Memory>(
    conn,
    "SELECT * FROM memories WHERE id = ?",
    [id]
  );

  return jsonResponse({ ok: true, data: formatMemory(rows[0]) });
}

/** DELETE /api/memories/:id — Delete a memory */
export async function deleteMemory(
  conn: Connection,
  token: string,
  id: string
): Promise<Response> {
  const existing = await query<Memory>(
    conn,
    "SELECT id FROM memories WHERE id = ? AND space_token = ?",
    [id, token]
  );

  if (existing.length === 0) {
    return errorResponse("Memory not found", 404);
  }

  await execute(
    conn,
    "DELETE FROM memories WHERE id = ? AND space_token = ?",
    [id, token]
  );

  return jsonResponse({ ok: true });
}

/** POST /api/memories/bulk — Bulk import memories */
export async function bulkImport(
  request: Request,
  conn: Connection,
  token: string
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  if (!body || typeof body !== "object") {
    return errorResponse("Request body must be a JSON object");
  }

  const b = body as Record<string, unknown>;

  // Support raw markdown import
  if (typeof b.markdown === "string") {
    const parsed = parseMarkdownMemories(
      b.markdown,
      typeof b.source === "string" ? b.source : undefined
    );
    if (parsed.length === 0) {
      return errorResponse("No memories found in markdown");
    }
    if (parsed.length > MAX_BULK_SIZE) {
      return errorResponse(`Markdown produced ${parsed.length} entries, max is ${MAX_BULK_SIZE}`);
    }

    const inserted = await insertBulk(conn, token, parsed);
    return jsonResponse({ ok: true, imported: inserted }, 201);
  }

  // Standard JSON bulk import
  if (!Array.isArray(b.memories)) {
    return errorResponse("Body must contain 'memories' array or 'markdown' string");
  }

  if (b.memories.length === 0) {
    return errorResponse("memories array is empty");
  }

  if (b.memories.length > MAX_BULK_SIZE) {
    return errorResponse(`Max ${MAX_BULK_SIZE} memories per bulk import`);
  }

  // Validate each entry
  for (let i = 0; i < b.memories.length; i++) {
    const v = validateCreateBody(b.memories[i]);
    if (!v.valid) {
      return errorResponse(`memories[${i}]: ${v.error}`);
    }
  }

  const inserted = await insertBulk(
    conn,
    token,
    (b as unknown as BulkImportBody).memories
  );

  return jsonResponse({ ok: true, imported: inserted }, 201);
}

async function insertBulk(
  conn: Connection,
  token: string,
  memories: Array<{ content: string; source?: string; key?: string; tags?: string[]; metadata?: Record<string, unknown> }>
): Promise<number> {
  let inserted = 0;

  // Insert in batches to avoid query size limits
  for (const mem of memories) {
    const id = generateId();
    await execute(
      conn,
      `INSERT INTO memories (id, space_token, key_name, content, source, tags, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        token,
        mem.key ?? null,
        mem.content,
        mem.source ?? null,
        mem.tags ? JSON.stringify(mem.tags) : null,
        mem.metadata ? JSON.stringify(mem.metadata) : null,
      ]
    );
    inserted++;
  }

  return inserted;
}

function formatMemory(row: Memory): Record<string, unknown> {
  return {
    id: row.id,
    key: row.key_name,
    content: row.content,
    source: row.source,
    tags: typeof row.tags === "string" ? JSON.parse(row.tags as string) : row.tags,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata as string) : row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
