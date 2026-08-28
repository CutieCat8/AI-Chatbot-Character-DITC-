const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const TOKEN_KEY = "ditc_admin_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type AdminRole = "admin" | "editor";

export interface AdminOut {
  id: number;
  email: string;
  display_name: string | null;
  role: AdminRole;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  admin: AdminOut;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(new URL("/api/auth/login", API_BASE), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `API ${res.status}`);
  }
  return res.json() as Promise<LoginResponse>;
}

export async function getMe(): Promise<AdminOut> {
  const res = await fetch(new URL("/api/auth/me", API_BASE), {
    headers: { Accept: "application/json", ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}`);
  }
  return res.json() as Promise<AdminOut>;
}

export type SourceSite = "ditc" | "camt" | "manual";

export interface DocumentOut {
  id: number;
  source_site: SourceSite;
  source_url: string;
  title: string | null;
  language: "th" | "en";
  is_active: boolean;
  scraped_at: string | null;
  created_at: string;
  updated_at: string;
  chunk_count: number;
}

export interface DocumentListOut {
  items: DocumentOut[];
  total: number;
  page: number;
  page_size: number;
}

export interface SourceStatOut {
  source_site: SourceSite;
  count: number;
}

export interface DocumentStatsOut {
  total: number;
  by_source: SourceStatOut[];
}

export interface ListDocumentsParams {
  source?: SourceSite;
  is_active?: boolean;
  search?: string;
  unindexed?: boolean;
  page?: number;
  page_size?: number;
}

export interface SyncStatusOut {
  is_running: boolean;
  today_count: number;
  last_synced_at: string | null;
  needs_attention_count: number;
}

export interface SyncTriggerOut {
  started: boolean;
  message: string;
}

export interface DocumentDetailOut extends DocumentOut {
  content: string;
}

export interface DocumentCreateIn {
  title?: string | null;
  content: string;
  source_site?: SourceSite;
  source_url?: string | null;
  language?: "th" | "en";
  is_active?: boolean;
}

export interface DocumentUpdateIn {
  title?: string | null;
  content?: string;
  is_active?: boolean;
  language?: "th" | "en";
}

export interface ChatSourceOut {
  document_id: number;
  title: string | null;
  url: string;
  source_site: SourceSite;
  similarity: number;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSourceOut[];
}

async function apiGet<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(path, API_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, { headers: { Accept: "application/json", ...authHeaders() } });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string): Promise<T> {
  const res = await fetch(new URL(path, API_BASE), {
    method: "POST",
    headers: { Accept: "application/json", ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  return res.json() as Promise<T>;
}

async function apiJson<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const res = await fetch(new URL(path, API_BASE), {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  return res.json() as Promise<T>;
}

async function apiDelete(path: string): Promise<void> {
  const res = await fetch(new URL(path, API_BASE), { method: "DELETE", headers: { ...authHeaders() } });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
}

export function listDocuments(params: ListDocumentsParams = {}) {
  return apiGet<DocumentListOut>("/api/documents", params);
}

export function getDocumentStats() {
  return apiGet<DocumentStatsOut>("/api/documents/stats");
}

export function getSyncStatus() {
  return apiGet<SyncStatusOut>("/api/documents/sync-status");
}

export function triggerSync() {
  return apiPost<SyncTriggerOut>("/api/documents/sync");
}

export function getDocument(id: number) {
  return apiGet<DocumentDetailOut>(`/api/documents/${id}`);
}

export function createDocument(payload: DocumentCreateIn) {
  return apiJson<DocumentDetailOut>("/api/documents", "POST", payload);
}

export function updateDocument(id: number, payload: DocumentUpdateIn) {
  return apiJson<DocumentDetailOut>(`/api/documents/${id}`, "PATCH", payload);
}

export function deleteDocument(id: number) {
  return apiDelete(`/api/documents/${id}`);
}

export async function askChat(question: string): Promise<ChatResponse> {
  const res = await fetch(new URL("/api/chat", API_BASE), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  return res.json() as Promise<ChatResponse>;
}
