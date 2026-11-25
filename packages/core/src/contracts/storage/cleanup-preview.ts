export interface CleanupPreviewStore {
  put(required: { principal: string; kind: string; scope: string; payload: Record<string, unknown> & { deadline?: number } }, optional?: Record<string, never>): { token: string; deadline: number };
  take(required: { token: string; principal: string; kind: string; scope: string }, optional?: Record<string, never>): { payload: Record<string, unknown>; deadline: number } | null;
}
