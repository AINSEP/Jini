---
"@jini-ai/agent-plugins": minor
---

Remove the copied mail setup parser from `@jini-ai/agent-plugins/lifecycle/mail` (owner-approved deletion of `legacy-mail-setup.ts` and its test); setup validation is owned by the host runtime. `parseMailAdaptersFile`'s `parseSetup` stays optional, but **a raw-only call (no `parseSetup`) now refuses every schemaVersion 2 descriptor** with exactly `{ ok: false, reason: "this host supplies no mail setup validator" }` instead of validating it with the copy. This approved raw-only v2 refusal is the only behaviour change: schemaVersion 1 files still parse without a validator, and hosts that inject a validator (for example `parseMailProviderSetupProperty` from `@jini-ai/platform/mail`, as `contribution.ts` already passes from the host) see identical results.
