/**
 * Two-way drift guard (a type-level check; `tsc` runs it through `pnpm typecheck`). The PostHog provider's structural copy of
 * the consent adapter contract (`analytics-posthog/contract.ts`) must neither be narrower nor wider than cookie-consent's: each
 * member is asserted `Local extends Domain` AND `Domain extends Local`. A plugin cannot import the domain, so the proof lives
 * here, in a test file, which may. Nothing imports it at runtime. It sits beside the observability and payments halves; all
 * move into `packages/integration-tests` when that package can be created (the install trap lifts 2026-11-19).
 */
import type * as Domain from "@jini-ai/cookie-consent";
import type * as Local from "../analytics-posthog/contract.js";

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type ConsentContractDrift = [
  Assert<Mutual<Local.ConsentAdapter, Domain.ConsentAdapter>>,
  Assert<Mutual<Local.ConsentAdapter<{ apiKey: string }>, Domain.ConsentAdapter<{ apiKey: string }>>>,
  Assert<Mutual<Local.GrantInput<{ apiKey: string }>, Domain.GrantInput<{ apiKey: string }>>>,
  Assert<Mutual<Local.ConsentState, Domain.ConsentState>>,
  Assert<Mutual<Local.Revoker, Domain.Revoker>>,
  Assert<Mutual<Local.StoragePrefixes, Domain.StoragePrefixes>>,
  Assert<Mutual<Local.PurgeStorage, Domain.PurgeStorage>>,
  Assert<Mutual<Local.LazyAdapter, Domain.LazyAdapter>>,
  Assert<Mutual<Local.RawContribution, Domain.RawContribution>>,
];
