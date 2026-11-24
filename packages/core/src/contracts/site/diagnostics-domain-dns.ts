/**
 * @file Public-domain TLS probe result shape. Types only; this module owns the declarations that
 * `@jini-ai/diagnostics/domain-dns` (`domain-dns/index.ts`) used to declare. That package imports
 * them from here and keeps its runtime values.
 */

export interface TlsStatus {
  status: "verified" | "invalid" | "unavailable";
  httpStatus: number | null;
}
