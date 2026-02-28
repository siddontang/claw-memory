---
name: claw-memory
description: Shared memory service for AI agents (OpenClaw, KimiClaw, NanoClaw, etc). Use when user asks to store, retrieve, search, or share memories across agent instances. Also use for importing existing memory files (MEMORY.md, daily notes) into the shared service.
---

# Claw Memory Sharing Service

API: `https://claw-memory.siddontang.workers.dev`

## Architecture
- Each token gets its **own TiDB Cloud Zero instance** (full data isolation)
- Central registry maps tokens → encrypted connection strings (AES-256-GCM)
- Token creation auto-provisions a Zero instance in ~2 seconds
- Zero instances expire after 30 days
- Even DB admins cannot read connection strings without the encryption key

## Setup

```bash
# Create a new memory space
curl -s -X POST https://claw-memory.siddontang.workers.dev/api/tokens

# With client-side encryption (double encryption — server can't decrypt without your key)
curl -s -X POST https://claw-memory.siddontang.workers.dev/api/tokens \
  -H "X-Encryption-Key: my-secret-key"
```

If created with `X-Encryption-Key`, include it on ALL subsequent requests.

## API (all memory endpoints need `Authorization: Bearer <token>`)

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | /api/tokens | — | Create memory space (provisions new Zero instance) |
| GET | /api/tokens/:token/info | — | Space info + memory count + sources |
| POST | /api/memories | `{content, source?, tags?, key?, metadata?}` | Store memory |
| GET | /api/memories | `?q=&tags=&source=&key=&limit=&offset=` | Search/list |
| GET | /api/memories/:id | — | Get one |
| PUT | /api/memories/:id | `{content?, tags?, ...}` | Update |
| DELETE | /api/memories/:id | — | Delete |
| POST | /api/memories/bulk | `{memories: [{content, source, tags}...]}` | Bulk import (max 200) |

## Encryption

Two layers of protection:
1. **Server key** — all connection strings encrypted with AES-256-GCM by default
2. **Client key** (optional) — `X-Encryption-Key` header adds a second encryption layer; server alone cannot decrypt

## Importing OpenClaw Memory

Read local MEMORY.md or daily notes, split into logical entries, bulk POST with `source: "openclaw"` and relevant tags.

Source: https://github.com/siddontang/claw-memory
