# totp — in progress
Authorized scope: ML D1, TRIM ML, owner accounts only. Bases: Jini 6f507852d; Tovu e327c07c8. Branch in both: cloud/totp. Started 2026-11-05 18:48 UTC, hard stop 20:48 UTC.

Acceptance: require enrolled owner's factor before any password/launcher session; activation only after proof; bounded pending proofs, spent failed attempts, timestep replay rejection, atomic session transition; owner-only enrollment/removal/recovery; explicit labelled launcher-proof recovery; ordinary password reset preserves factors. No QR dependency or passkeys.

Initial Jini focused baseline: 96 tests pass (auth-service, auth-service.pins, auth-challenge, recovery-codes). New core tests: 6 pass. New React tests: 20 pass. Storage adapter/migration work in paired Tovu branch.

Environment: shared/dev-env.sh and shared/start-postgres.sh absent. Node 24.22.1. Tovu baseline blocked by stale linked Jini artifacts (sidecar supervisor-node.js and platform fileDigest); rebuilding. PostgreSQL binaries absent, availability under investigation.

Cost budget: factor lookup per sign-in; enrolled sign-in writes one replaced pending row (<=1KiB). Each attempt <=5 bounded reads, <=4 writes plus session, all identity-serialized. Two pending rows per owner maximum, no cleanup poll. Enroll/remove are explicit actions only; session revocation scales with existing owner sessions.

Final implementation, exact verification commands and pushed SHAs will replace this progress note.
