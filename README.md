# Claw Memory Sharing Service

A Cloudflare Worker + TiDB Cloud backend that lets any Claw agent (OpenClaw, KimiClaw, NanoClaw, etc.) share memory across instances.

## How It Works

1. One claw creates a **memory space** and gets a token
2. Other claws join by using the same token
3. All claws read/write to shared memory via REST API
4. Memories are searchable by full-text, tags, source, and key

## Setup

### 1. Provision TiDB Cloud

Create a TiDB Cloud Serverless cluster at [tidbcloud.com](https://tidbcloud.com). Note the host, user, password, and database name.

### 2. Initialize Database

```bash
npm install

TIDB_HOST=gateway01.us-east-1.prod.aws.tidbcloud.com \
TIDB_USER=your_user \
TIDB_PASSWORD=your_password \
TIDB_DATABASE=claw_memory \
npm run db:init
```

### 3. Configure Worker Secrets

```bash
npx wrangler secret put TIDB_HOST
npx wrangler secret put TIDB_USER
npx wrangler secret put TIDB_PASSWORD
npx wrangler secret put TIDB_DATABASE
```

### 4. Deploy

```bash
npm run deploy
```

### 5. Local Dev

```bash
# Create .dev.vars with your TiDB credentials
cat > .dev.vars << 'EOF'
TIDB_HOST=gateway01.us-east-1.prod.aws.tidbcloud.com
TIDB_USER=your_user
TIDB_PASSWORD=your_password
TIDB_DATABASE=claw_memory
EOF

npm run dev
```

## API Reference

Base URL: `https://claw-memory.<your-subdomain>.workers.dev`

### Create a Memory Space

```bash
curl -X POST https://claw-memory.example.workers.dev/api/tokens
```

Response:
```json
{
  "ok": true,
  "data": {
    "token": "clawmem_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

### Get Space Info

```bash
curl https://claw-memory.example.workers.dev/api/tokens/clawmem_xxx/info
```

### Store a Memory

```bash
curl -X POST https://claw-memory.example.workers.dev/api/memories \
  -H "Authorization: Bearer clawmem_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "The user prefers dark mode and vim keybindings",
    "source": "openclaw",
    "tags": ["preferences", "ui"],
    "key": "user-preferences",
    "metadata": { "confidence": "high" }
  }'
```

### Search Memories

```bash
# Full-text search
curl "https://claw-memory.example.workers.dev/api/memories?q=dark+mode" \
  -H "Authorization: Bearer clawmem_xxx"

# Filter by tags
curl "https://claw-memory.example.workers.dev/api/memories?tags=preferences,ui" \
  -H "Authorization: Bearer clawmem_xxx"

# Filter by source
curl "https://claw-memory.example.workers.dev/api/memories?source=openclaw" \
  -H "Authorization: Bearer clawmem_xxx"

# Filter by key
curl "https://claw-memory.example.workers.dev/api/memories?key=user-preferences" \
  -H "Authorization: Bearer clawmem_xxx"

# Pagination
curl "https://claw-memory.example.workers.dev/api/memories?limit=20&offset=40" \
  -H "Authorization: Bearer clawmem_xxx"
```

### Get a Single Memory

```bash
curl https://claw-memory.example.workers.dev/api/memories/<id> \
  -H "Authorization: Bearer clawmem_xxx"
```

### Update a Memory

```bash
curl -X PUT https://claw-memory.example.workers.dev/api/memories/<id> \
  -H "Authorization: Bearer clawmem_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Updated content", "tags": ["updated"] }'
```

### Delete a Memory

```bash
curl -X DELETE https://claw-memory.example.workers.dev/api/memories/<id> \
  -H "Authorization: Bearer clawmem_xxx"
```

### Bulk Import

Import an array of memories:

```bash
curl -X POST https://claw-memory.example.workers.dev/api/memories/bulk \
  -H "Authorization: Bearer clawmem_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "memories": [
      { "content": "User likes TypeScript", "source": "openclaw", "tags": ["preferences"] },
      { "content": "Project uses pnpm", "source": "kimiclaw", "tags": ["tooling"] }
    ]
  }'
```

Import from markdown (MEMORY.md format):

```bash
curl -X POST https://claw-memory.example.workers.dev/api/memories/bulk \
  -H "Authorization: Bearer clawmem_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "markdown": "## Preferences\n- Dark mode enabled\n- Vim keybindings\n\n## Project\n- Uses TypeScript\n- Deployed on Cloudflare",
    "source": "openclaw"
  }'
```

## Rate Limits

- 100 requests per minute per token

## Architecture

```
┌──────────┐     ┌──────────────────┐     ┌──────────────┐
│ OpenClaw │────▶│                  │────▶│              │
├──────────┤     │  CF Worker       │     │  TiDB Cloud  │
│ KimiClaw │────▶│  (claw-memory)   │────▶│  Serverless  │
├──────────┤     │                  │     │              │
│ NanoClaw │────▶│  Token Auth      │     │  Full-text   │
└──────────┘     │  Rate Limiting   │     │  search      │
                 │  CORS            │     │  JSON tags   │
                 └──────────────────┘     └──────────────┘
```

## Memory Schema

| Field      | Type         | Description                          |
|------------|--------------|--------------------------------------|
| id         | UUID         | Auto-generated                       |
| key        | string       | Optional named key for upsert-style  |
| content    | text         | The memory content (up to 50KB)      |
| source     | string       | Which claw wrote it                  |
| tags       | string[]     | Filterable tags                      |
| metadata   | object       | Arbitrary structured data            |
| created_at | timestamp    | When created                         |
| updated_at | timestamp    | Last modified                        |
