/**
 * @file Electron asar archive header and verification shapes. Types only; this module owns the
 * declarations that `@jini-ai/devops/packaging/electron` (`ports.ts`, `archive.ts`) used to
 * declare. That package imports them from here and keeps its runtime values.
 */

export interface AsarHeaderNode { files?: Record<string, AsarHeaderNode>; link?: string; size?: number; offset?: string }
export interface AsarMismatch { relPath: string; reason: string }
export interface AsarVerification { checkedCount: number; mismatches: AsarMismatch[] }
