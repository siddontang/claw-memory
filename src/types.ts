export interface Env {
  TIDB_HOST: string;
  TIDB_USER: string;
  TIDB_PASSWORD: string;
  TIDB_DATABASE: string;
  ENVIRONMENT: string;
}

export interface MemorySpace {
  id: string;
  token: string;
  created_at: string;
  member_count: number;
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
  content: string;
  source?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateMemoryBody {
  key?: string;
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
