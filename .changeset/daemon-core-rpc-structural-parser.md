---
"@jini-ai/daemon": major
---

`daemonToolConsentSnapshot` and `createDaemonCoreRequestSchema` (from `@jini-ai/daemon/core-rpc-schema`) are now typed as the library-neutral `DaemonCoreParser<T>` (`parse` / `safeParse` returning `DaemonCoreParseResult<T>`) instead of `z.ZodType`. Parse verdicts are unchanged; callers that used other Zod members (`.extend`, `.pipe`, ...) must build their own schema.
