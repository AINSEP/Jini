/** Naming contract only; the compatibility driver binds the canonical database implementation.
 * Keep this directory independent of the optional database peer, including its declarations.
 */
export interface RestorePointNamingPort {
  sanitizeForFilename(required: { value: string }, options?: Record<string, never>): string;
  restorePointFilename(required: { scopeId: string; watermarkAtCapture: number; timestamp: number }, options?: { extension?: string }): string;
}
