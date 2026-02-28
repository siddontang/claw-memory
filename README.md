# Claw Memory Sharing Service

A Cloudflare Worker + TiDB Cloud backend that lets any Claw agent (OpenClaw, KimiClaw, NanoClaw, etc.) share memory across instances.

## Architecture

```
                         ┌─────────────────────────────────────┐
                         │        Cloudflare Worker            │
                         │        (claw-memory)                │
                         │                                     │
  ┌──────────┐           │  ┌───────────┐   ┌──────────────┐  │
  │ OpenClaw │──token A──▶  │           │   │  AES-256-GCM │  │
  ├──────────┤           │  │  Router   │──▶│  Encrypt /   │  │
  │ KimiClaw │──token A──▶  │  + Auth   │   │  Decrypt     │  │
  ├──────────┤           │  │           │   └──────┬───────┘  │
  │ NanoClaw │──token B──▶  └─────┬─────┘          │          │
  └──────────┘           │        │                │          │
                         └────────┼────────────────┼──────────┘
                                  │                │
                    ┌─────────────▼──┐    ┌────────▼─────────┐
                    │   Registry DB  │    │  TiDB Cloud Zero │
                    │  (TiDB Cloud)  │    │  (per token)     │
                    │                │    │                   │
                    │  token_registry│    │  Token A ──▶ DB A │
                    │  ┌───────────┐ │    │  Token B ──▶ DB B │
                    │  │ token     │ │    │  Token C ──▶ DB C │
                    │  │ encrypted │ │    │                   │
                    │  │ iv        │ │    │  Each token gets  │
                    │  │ has_key   │ │    │  its OWN isolated │
                    │  │ expires   │ │    │  Zero instance    │
                    │  └───────────┘ │    └───────────────────┘
                    └────────────────┘
```

**Key design decisions:**

- **Full data isolation** — Each token provisions its own [TiDB Cloud Zero](https://zero.tidbcloud.com) instance. No shared tables, no cross-token access.
- **Encrypted registry** — Connection strings (host, user, password) are AES-256-GCM encrypted at rest. Even database admins cannot read them.
- **Optional client-side encryption** — Claws can provide their own encryption key (`X-Encryption-Key` header) for double encryption. The server cannot decrypt without the client's key.
- **Zero-friction provisioning** — Token creation auto-provisions a TiDB Cloud Zero instance in ~2 seconds. No signup, no config.
- **30-day lifecycle** — Zero instances expire after 30 days (disposable by design).

## How It Works

1. A claw calls `POST /api/tokens` → provisions a dedicated TiDB Cloud Zero instance, encrypts the connection string, stores the mapping in the registry, returns a token
2. Other claws join by using the same token
3. All memory operations go through the token's isolated database
4. Memories are searchable by content, tags, source, and key

## Setup

### 1. Set up the Registry Database

Create a TiDB Cloud Serverless cluster for the central registry. Initialize the schema:

```bash
npm install

REGISTRY_HOST=gateway01.ap-northeast-1.prod.aws.tidbcloud.com \
REGISTRY_USER=your_user \
REGISTRY_PASSWORD=your_password \
REGISTRY_DATABASE=claw_memory \
npm run db:init
```

### 2. Configure Worker Secrets

```bash
npx wrangler secret put REGISTRY_HOST      # Registry TiDB host
npx wrangler secret put REGISTRY_USER      # Registry TiDB user
npx wrangler secret put REGISTRY_PASSWORD  # Registry TiDB password
npx wrangler secret put REGISTRY_DATABASE  # Registry database name
npx wrangler secret put ENCRYPTION_KEY     # openssl rand -hex 32
```

### 3. Deploy

```bash
npm run deploy
```

## API Reference

Base URL: `https://claw-memory.siddontang.workers.dev`

### Create a Memory Space

```bash
# Basic (server-side encryption only)
curl -X POST /api/tokens

# With client encryption key (double encryption — even server can't read it)
curl -X POST /api/tokens -H "X-Encryption-Key: my-secret-key"
```

Response:
```json
{
  "ok": true,
  "data": {
    "token": "clawmem_a1b2c3...",
    "created_at": "2026-02-28T10:30:00Z",
    "expires_at": "2026-03-30T10:30:00Z",
    "has_client_key": false
  }
}
```

### Store a Memory

```bash
curl -X POST /api/memories \
  -H "Authorization: Bearer clawmem_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "User prefers dark mode and vim keybindings",
    "source": "openclaw",
    "tags": ["preferences", "ui"],
    "key": "user-preferences"
  }'
```

### Search Memories

```bash
curl "/api/memories?q=dark+mode&tags=preferences&source=openclaw&limit=20" \
  -H "Authorization: Bearer clawmem_xxx"
```

### Other Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/tokens | Create memory space (provisions Zero instance) |
| GET | /api/tokens/:token/info | Space info + stats |
| POST | /api/memories | Store a memory |
| GET | /api/memories | Search/list (query: `q`, `tags`, `source`, `key`, `limit`, `offset`) |
| GET | /api/memories/:id | Get one |
| PUT | /api/memories/:id | Update |
| DELETE | /api/memories/:id | Delete |
| POST | /api/memories/bulk | Bulk import (max 200) |

### Bulk Import

```bash
curl -X POST /api/memories/bulk \
  -H "Authorization: Bearer clawmem_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "memories": [
      { "content": "User likes TypeScript", "source": "openclaw", "tags": ["preferences"] },
      { "content": "Project uses pnpm", "source": "kimiclaw", "tags": ["tooling"] }
    ]
  }'
```

## Encryption

```
Without client key:              With client key:

  plaintext                        plaintext
      │                                │
  ┌───▼───┐                      ┌────▼────┐
  │Server │                      │Server + │
  │  Key  │                      │Client   │
  │(AES)  │                      │Keys     │
  └───┬───┘                      └────┬────┘
      │                                │
  ciphertext ──▶ registry DB      ciphertext ──▶ registry DB
                                  (server alone can't decrypt)
```

- **Server key** (`ENCRYPTION_KEY` secret): Encrypts all connection strings by default
- **Client key** (`X-Encryption-Key` header): Optional second layer. If provided at token creation, must be provided on every subsequent request. Server cannot decrypt without it.

## Memory Schema

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Auto-generated |
| key | string | Optional named key |
| content | text | Memory content (up to 50KB) |
| source | string | Which claw wrote it (openclaw, kimiclaw, etc.) |
| tags | string[] | Filterable tags |
| metadata | object | Arbitrary structured data |
| created_at | timestamp | When created |
| updated_at | timestamp | Last modified |

## License

MIT
