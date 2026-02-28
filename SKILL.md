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

## Setup

```bash
# Create a new memory space (provisions a dedicated TiDB Cloud Zero instance)
curl -s -X POST https://claw-memory.siddontang.workers.dev/api/tokens
# Returns: { "ok": true, "data": { "token": "clawmem_xxxx", "expires_at": "..." } }

# Optional: add client-side encryption key for double encryption
curl -s -X POST https://claw-memory.siddontang.workers.dev/api/tokens \
  -H "X-Encryption-Key: my-secret-key"
# If used, all subsequent requests must include the same X-Encryption-Key header
```

Share the token — all claws using the same token share an isolated database.

## API (all memory endpoints need `Authorization: Bearer <token>`)

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | /api/tokens | — | Create memory space (provisions new Zero instance) |
| GET | /api/tokens/:token/info | — | Space info + memory count + sources |
| POST | /api/memories | `{content, source?, tags?, key?, metadata?}` | Store memory |
| GET | /api/memories | `?q=&tags=&source=&limit=&offset=` | Search/list |
| GET | /api/memories/:id | — | Get one |
| PUT | /api/memories/:id | `{content?, tags?, ...}` | Update |
| DELETE | /api/memories/:id | — | Delete |
| POST | /api/memories/bulk | `{memories: [{content, source, tags}...]}` | Bulk import (max 200) |

## Importing OpenClaw Memory

Read local MEMORY.md or daily notes, split into logical entries, bulk POST with `source: "openclaw"` and relevant tags.

## Encryption

Connection info is encrypted at rest (AES-256-GCM). Optional `X-Encryption-Key` header adds client-side encryption — if used at token creation, must be provided on all requests.

## Data Isolation

Each token = separate TiDB Cloud Zero database. No cross-token data access. Tokens expire with their Zero instance (30 days from creation).

Source: https://github.com/siddontang/claw-memory
