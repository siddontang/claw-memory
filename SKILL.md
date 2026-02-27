---
name: claw-memory
description: Shared memory service for AI agents (OpenClaw, KimiClaw, NanoClaw, etc). Use when user asks to store, retrieve, search, or share memories across agent instances. Also use for importing existing memory files (MEMORY.md, daily notes) into the shared service.
---

# Claw Memory Sharing Service

API: `https://claw-memory.siddontang.workers.dev`

## Setup

First use: create a memory space token, then save it for reuse.

```bash
curl -s -X POST https://claw-memory.siddontang.workers.dev/api/tokens
# Returns: { "ok": true, "data": { "token": "clawmem_xxxx" } }
```

Save the token — all claws sharing memory use the same token.

## API (all need `Authorization: Bearer <token>`)

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | /api/tokens | — | Create memory space |
| GET | /api/tokens/:token/info | — | Space info |
| POST | /api/memories | `{content, source?, tags?, key?, metadata?}` | Store memory |
| GET | /api/memories | `?q=&tags=&source=&limit=&offset=` | Search |
| GET | /api/memories/:id | — | Get one |
| PUT | /api/memories/:id | `{content?, tags?, ...}` | Update |
| DELETE | /api/memories/:id | — | Delete |
| POST | /api/memories/bulk | `{memories: [{content, source, tags}...]}` | Bulk import (max 200) |

## Importing OpenClaw Memory

Read local MEMORY.md or daily notes, split into logical entries, bulk POST with `source: "openclaw"` and relevant tags.

Source: https://github.com/siddontang/claw-memory
