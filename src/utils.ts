export function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Format as UUID v4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `clawmem_${hex}`;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ ok: false, error: message }, status);
}

/**
 * Parse a MEMORY.md-style markdown file into memory entries.
 *
 * Supports formats:
 *   ## Section Header    → becomes a tag
 *   - Bullet item        → becomes a memory entry
 *   Paragraph text       → becomes a memory entry
 */
export function parseMarkdownMemories(
  markdown: string,
  defaultSource?: string
): Array<{ content: string; tags: string[]; source?: string }> {
  const lines = markdown.split("\n");
  const entries: Array<{ content: string; tags: string[]; source?: string }> = [];
  let currentTags: string[] = [];
  let currentParagraph = "";

  function flushParagraph() {
    const text = currentParagraph.trim();
    if (text) {
      entries.push({
        content: text,
        tags: [...currentTags],
        source: defaultSource,
      });
    }
    currentParagraph = "";
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Section header → tag
    const headerMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headerMatch) {
      flushParagraph();
      const tag = headerMatch[1]
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .trim();
      if (tag) currentTags = [tag];
      continue;
    }

    // Bullet item → standalone entry
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      entries.push({
        content: bulletMatch[1],
        tags: [...currentTags],
        source: defaultSource,
      });
      continue;
    }

    // Empty line → flush paragraph
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    // Otherwise accumulate paragraph
    currentParagraph += (currentParagraph ? " " : "") + trimmed;
  }

  flushParagraph();
  return entries;
}

/** Validate that a string is a plausible claw memory token */
export function isValidToken(token: string): boolean {
  return /^clawmem_[a-f0-9]{32}$/.test(token);
}

/** Clamp a number between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
