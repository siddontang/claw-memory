export interface Env {
  REGISTRY_HOST: string;
  REGISTRY_USER: string;
  REGISTRY_PASSWORD: string;
  REGISTRY_DATABASE: string;
  ENCRYPTION_KEY: string;
  ENVIRONMENT: string;
}

export interface TokenRegistry {
  token: string;
  connection_encrypted: string;
  iv: string;
  has_client_key: boolean;
  expires_at: string | null;
  created_at: string;
}

/** Decrypted connection info stored inside connection_encrypted */
export interface ConnectionInfo {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface Memory {
  id: string;
  space_token: string;
  key_name: string | null;
  content: string;
  source: string | null;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMemoryBody {
  key?: string;
  from?: string;
  to?: string;
  content: string;
  source?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateMemoryBody {
  key?: string;
  from?: string;
  to?: string;
  content?: string;
  source?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface BulkImportBody {
  memories: CreateMemoryBody[];
}

export interface SearchParams {
  q?: string;
  tags?: string;
  source?: string;
  limit?: string;
  offset?: string;
  key?: string;
  from?: string;
  to?: string;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  ok: boolean;
  data: T[];
  total: number;
  limit: number;
  offset: number;
}
