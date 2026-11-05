# Trim of P2-email-login-result.md (tovu-f4, 11-04 night). Codex's estimate: 8–13 days. TOO BIG for one go.
SHIP FIRST (≈2–3 days):
- B1, recovery codes: 10 single-use, hashed, shown once; atomic consume + reset + session revoke.
- B2, self-hosted reset CLI wrapper: hidden password input; uses the existing TOVU_ADMIN_RESET_* fallback.
- B2, desktop reset: the existing launch proof → owner session.
LATER (separate go-ahead each):
- A: durable notification mail via the existing form-delivery outbox (3–4 days). Leave the flag off until then.
- C: move mail into Jini (2–4 days). Only when A or another consumer needs it; no standalone move.
- D: TOTP and passkeys (4–7 days).
CUT: a new @jini-ai/db/mail entry (keep the SQL adapter in Tovu until C).
