// Coverage note: `export interface` only — erases to an empty module at
// compile time (verified: zero emitted statements), so v8/istanbul has no
// executable line to measure. Excluded from the coverage run alongside this
// package's other interface-only ports files (see packages/ui/archived provenance ledger).

export interface CommandPaletteRecentsPort {
  read(scopeKey: string): string[];
  push(scopeKey: string, id: string): void;
}
