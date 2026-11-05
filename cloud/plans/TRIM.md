# Trim of the 11-05 Codex plans (coordinator). Trim overrides each plan. Hours are Codex's own estimates.
Raw total ~223-350 h (+30-46 h geo/fraud). After trim: ~90-142 h now; held 45-76 h + geo/fraud.

## SEC security (new, from card map; ~3-5 h)
Refuse typed delivery for exchange-only ids; __typedAnswer is a non-answer in secret-card answerStep; reserve freeText in checkedFields; bind MCP OAuth sign-in to the browser by reusing api-connections browser-binding; check federated results for a connection's own token (J:mcp/src/federation trust.ts) and fix only if truly missing.

## T theme (6-9 -> 3-5 h)
KEEP steps 1, 2, 3, 4, 5. CUT: omitting lightbox.js (its CSS is functional overlay; removing breaks image click; keep it, report nothing), removedScriptSrcs option, prose pins except tool-call + inspiration order. Transformer <=60 lines. Readiness check only in the one shared activation allowlist, <=25 lines, no adapter-specific code beyond the shared message.

## B bugs (23-37 -> 13-21 h)
KEEP A (diagnostics + fallback-daemon flag; no trigger guesses), C (OpenCode message), D (test/profiler fixes). E verification goes with the cloud run + real-chat pass. Privacy title + Memory unavailable: no code; verify only.
CUT B's per-send grant lookup across all adapters (+180-320, a DB read per send). INSTEAD: on revoke call the existing local reapply and rely on the existing 30 s watch for other processes, dropping queued data instead of flushing it with the old key. Limit stated in the UI text: revoked within 30 s. ~+30 lines, 2-3 h. Runs after the keys re-review.

## V forms (46-70 -> 26-38 h)
Step 1 joins the release, not a job. KEEP step 2. Step 3 TRIMMED: capture labels, consent wording and schema hash in the existing envelope; old rows say unavailable. CUT stale-form detection, moving import orchestration to Jini, error recovery from old reports. Step 4 HOLD: new table + reconciliation + legacy inventory is bloat (+450-700). RE-PLAN: smallest per-site byte cap, no new table if possible, <=150 lines; no legacy inventory or in-app review. Step 5 KEEP (owner's idea). Google is a follow-up unless owner wants it first.

## S sweeps (61-95 -> 17-28 h; folders held)
218 of 236 call sites lacking a message = helper's default is wrong; per-route migration E1-E6 (31-46 h, +1000-1800 lines) CUT. RE-PLAN: fix at sendAdminFailure + the shared admin error display so every admin route gets plain words + copy details; hand wording only where a generic line misleads (recovery, publish). Auth job KEEP. Jini/public/desktop job TRIMMED: daemon runs + model stream only. Skills + cleanup KEEP. LCOV PARK (test tooling). Chrome investigation CUT from Codex: external Claude-in-Chrome behaviour; bug stays open. Plugin wrappers + facades: done, close. Folder jobs HOLD behind the merge gate (owner's rule).

## U unknown bugs (2-4 h now)
FIXED/STALE rows: mark in open-bugs. Runtime rows: join the real-chat pass, not Codex; customer-theme and video rows stay open until those files are at hand. Coverage ratchet after a cloud coverage run. kUInetic: owner's call, its own session.

## C commerce (39-62 h + 30-46 h -> 2-4 h now)
Commerce is off today. Stage 1 only, trimmed: the 0011 migration throwing on populated tables is a real upgrade block; rename-to-archive, <=120 lines. Stages 2-5 HOLD for owner go. Geo + fraud wait.

## A AINSEP (12-18 -> 6-10 h); M memory (3-5 -> 2-3 h); X MCP (20-30 -> 16-24 h)
A: cut routing evals to reference checks; ships off by default. M: 7 checks + Electron page; evidence file short. Both start in AI-Dev-Shop; source location to settle. X: waits for owner's 2 answers. CUT W3 chat write tool (item 26's one card already raises); keep argument-free read. Run facts <=2 KiB, not 16.

## Not Codex
One Opus review before landing: keys after job O + cloud-2 fixes. Real-chat check before 0.1.30. UI list = Opus + Chrome.

# Trim, second batch (10 AM)
## CARD (8-12 -> 5-8 h): keep steps 2-4. Step 1 = cloud run 1. Step 5: one neutral consumer test using different ids and copy, packed packages check only; no new harness.
## ML (44-70 h -> A 4-6 h, D1 15-22 h, D2 10-15 h): prerequisite is the Jini release + Tovu dep bump, not a job. A: only the retry hint + unknown-outcome fix + restart test. D1 TOTP: owner accounts only; owner's default kept: enrolled owners need their factor at sign-in; desktop keeps labelled recovery via launcher proof. No QR dependency. D2 passkeys: separate branch off D1. CUT C, frozen envelopes, remembered devices, passwordless, dashboard. Measure SimpleWebAuthn download size first; report before adopting.
## OA (24-36 -> 18-26 h): step 2 (refresh race) is its own small branch, first. CUT stdio auto-renewal: HTTP MCP only; stdio stays gated, next launch picks up the new token. Keep "Stop using here" and "Disconnect this shared connection from every site on this Mac". Explicit choice only; local connections untouched; no boot migration.

# Trim, third batch (10:10 AM)
## TAG (18-26 h -> 14-20 h): split: TAG-A first (driver bypass closed, hidden/inactive rejected, self-approval tool removed, chat card replaces dialog; daemon and WebMCP paths). TAG-B after (default-on tags at existing ui-kit + UI owners, forwarding, Composer + picker, adoption, secret handles stripped). CUT AgentScope, agentKey, registry, observer, pagination as the plan says. Keep the 64 KiB output cap. Discovery response growth (54-90 KB for 300 controls) exceeds the cap on big pages: default handles only for controls in the active view; query filters stay.
## GA (Jini CI): config fixes only: ESLint parser override, generated bundles excluded, reuse the source-neutrality guard instead of duplicate ESLint policy, SEC- case fix, semgrep rule fix; 11 guard violations + 1 Cloudflare test fix included. No disables. Plan: GA-plan-result.md.
