# passkeys — in progress

Job started 2026-11-06 00:02 UTC; hard deadline 02:02 UTC. Scope ML D2, COMMON + TRIM, based on current origin/cloud/combine.
Jini base: 3a86f98ba03380651c8bf64b8fc18c4f90a122fd. Paired Tovu base: abead52498c80fd86b8f7b37a2caed31d98a7307. Work/push branch in both: cloud/passkeys only.

Loaded Software Architect, Programmer and TDD personas from /workspace/cloud/ai-dev-shop. Reuse owner TOTP transactions, pending proofs, sealing, session minting and recovery. Owner accounts only; passkeys act as an alternative second factor after password proof. TOTP remains enrolled for recovery/fallback; no passwordless discovery, member changes or dashboard.

## Dependency measurement before adoption

Measured registry tarball downloads and verified SHA-512 integrity for every artifact (26 unique packages). Server @14.0.3: 121,672 B direct, 546,496 B including transitives. Browser @14.0.0: 42,879 B, no dependencies. Combined: 589,375 B. Browser published minified UMD: 13,473 B / 3,806 B gzip (level 9); actual application tree-shaking may differ. Scratch evidence: /workspace/work/passkeys-size/{measure.py,download-sizes.json,browser-bundle-size.json,package-lock.json}.

BUG OPEN: origin/cloud/combine contains Jini TOTP services and Tovu MFA storage, but Tovu password/boot/management wiring is missing. A bounded prerequisite wiring slice is necessary to prevent bypass before enabling passkeys.

## Acceptance and boundaries

Jini owns ceremonies, protocol adapter and browser components; Tovu supplies SQL/HTTP/configuration. Challenges are single-use, five-minute, purpose/workspace/principal/origin bound. Required user verification, library signature/RP/counter verification, bounded five credentials. No private keys persist. Trusted listener/configuration selects origin including port, RP hostname remains stable on port changes. One additive ADR-066 credential migration; reuse pending storage. Existing identity transaction serializes challenge consumption/counter/session writes. No new poll or timer.

Verification and pushed commit inventory will be updated as work completes.
