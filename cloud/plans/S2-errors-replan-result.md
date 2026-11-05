Software Architect(Direct): Loaded the requested Software Architect persona.

**1. Goal:** Give every unexpected admin failure a concrete explanation, safe next action and copyable details through shared defaults, within **8–9.5 Codex hours**.

**2. Findings**

Both clones report `merge-1029`. Their uncommitted changes remain untouched. This was static inspection only; no tests, builds, installs, servers or localhost requests ran.

- **The main fix belongs in the helper.** [`sendAdminFailure:67`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/system/site-share-errors.ts:67) delegates to `adminFailureResponse:31`. That lifecycle already generates an incident ID, redacts diagnostics and isolates failing diagnostic sinks. Preserve it.
- **Change both entry points.** Several response mappers call `adminFailureResponse` directly. Its default must improve too; changing only `sendAdminFailure` misses them. Example: [`mappedErrorResponse:76`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/publish-content/route-helpers.ts:76).
- **Request context is available without 218 edits.** Normal Express responses expose `res.req`; derive method and registered route template there. Direct mappers lack a request, but supply operation identifiers such as `routes/media/update`. Use those as the fallback context. Never display concrete IDs, query strings or submitted values.
- **There is no existing single shared visual consumer.** [`Pages:100`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/pages/Pages.tsx:100) and [`Posts:56`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/posts/Posts.tsx:56) render local strings. The shared transport is [`api.ts:2662`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/lib/api.ts:2662); final retry handling ends at `request:2705`. Add the single consumer there and at the application root.
- **Reuse checked:** [`formatUserFacingError:31`](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/core/src/user-facing-error.ts:31), [`decodeApiError:111`](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/protocol/src/errors.ts:111), [`ErrorNotice:20`](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/ui/src/features/panel-kit/ErrorNotice.tsx:20), existing clipboard handling, root-level restart banner and toast service. The toast service carries strings; it cannot carry `ErrorNotice`’s structured failure without extension. Prefer a tiny failure channel beside the existing panel-kit component.
- **Why the regression expects no details:** [`ranked-user-facing-errors.test.ts:24–38`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/http/__tests__/ranked-user-facing-errors.test.ts:24) explicitly tests “without an unconsumed failure envelope.” [`unexpectedAdminBody:55`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/system/site-share-errors.ts:55) implements that opt-in policy. This establishes the reason in code; historical motivation beyond it is **UNVERIFIED**.
- **That absence assertion should change once the shared consumer exists.** Keep the no-secret/no-private-backend assertions. Safe details can contain an approved explanation, action, operation, time and matching incident ID; they need not contain the exception.
- **Anonymous disclosure needs special care.** Login precedes the admin session gate; publishing credentials also take a different path: [`core.ts:75`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/modules/core.ts:75), [`dev-auth.ts:397`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/dev-auth.ts:397). An `/api/admin` prefix does not prove owner authorization. The formatter itself warns that redaction is not disclosure permission.
- **A literal “EVERY” needs a few escape-path fixes.** Analytics discards the helper envelope ([`:101`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/analytics/recent-hits.ts:101)); forms pull overwrites its message ([`:31`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/forms/pull-submissions.ts:31)); preview sends plain text ([`:230`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/posts/template-preview.ts:230)); final error middleware only observes and delegates ([`:132`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/shared/observability-middleware.ts:132)). Two files alone cannot honestly provide universal coverage.

**3. Ordered plan**

Line estimates are approximate production additions/removals; test additions are separate. Proposed new filenames are identified as new.

1. **Write failing behavior tests first.**
   Extend the ranked suite, helper tests and admin request tests. Cover missing-message defaults, mapper defaults, explicit wording, anonymous secret canaries, correlated IDs, successful retry without a notice, persistent final failure and clipboard failure.
   **Production +0/−0; tests +120–170.** Run RED only during later implementation.

2. **Put reusable request wording in Jini; keep Tovu vocabulary declarative.**
   Extend `packages/core/src/user-facing-error.ts` with a pure request-description function taking `(requiredObj, optionalObj)`. Inputs: method, safe route/operation tokens and injected vocabulary; output: message, action and step.
   Add **new** `packages/contracts/src/admin-failure-copy.ts` in Tovu for nouns and semantic overrides, shared by server and admin.
   **Production +70–100/−0; tests +50–70.**

   | Context | Default wording/action |
   |---|---|
   | GET/HEAD pages | “Pages could not be loaded. Try loading them again. If it still fails, copy details and report this problem.” |
   | PUT/PATCH page | “The page save could not be completed. Check whether your changes were saved before repeating the save. Copy details and report this problem.” |
   | DELETE item | Name the removal; say its outcome could not be confirmed and to check the list before repeating it. |
   | POST | Use known action suffixes first; otherwise say the named operation could not be completed, without assuming POST means creation. |

   Match known static segments, including nested resources. Never turn arbitrary path values into prose. Add a static route-inventory test requiring a noun/action mapping for existing admin route families.

3. **Make safe details the helper default.**
   In `site-share-errors.ts`, let `sendAdminFailure` supply method/template context from `res.req`; let direct `adminFailureResponse` callers fall back to their operation identifier. Preserve explicit messages and `failure` overrides.
   Always format unexpected failures into `details.failure`; retain legacy `error`/`message`, status, code and incident ID. Default cause: “The error ID identifies the server report.”
   **Production +35–55/−15–25; tests +40–60.**
   Keep raw exceptions in existing redacted diagnostic sinks. Preserve the export pilot’s explicit disclosure policy; do not generalize it. Preserve disk-space refusals and other expected domain errors.

4. **Add one shared admin display.**
   Add a small instance-owned failure channel under Jini `ui/features/panel-kit`, with publish/subscribe/snapshot/reset and injected effects. Reuse `ErrorNotice` unchanged where possible.
   In Tovu `api.ts`, normalize failures after the existing reconnect/retry sequence finishes. Decode both canonical and legacy bodies; use safe server details when present, otherwise synthesize them from method, vocabulary, status and incident reference.
   Mount one persistent, dismissible consumer beside `ServerRestartingBanner` at [`main.tsx:76`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/main.tsx:76), covering login as well as signed-in screens.
   **Production +90–130/−5–10; tests +80–110.**
   Keep the original rejection and `ApiError.body`. Expected 4xx outcomes stay with their existing screens. Use polite announcements for background failures; reset retained details on session/site changes. Existing inline messages may coexist initially.

5. **Close the bounded escape paths; hand-write only risky semantics.**
   Fix analytics to retain its canonical envelope **and the same incident reference**; move forms-pull wording into its formatter options. Route uncaught admin exceptions through the existing failure lifecycle before Express’s default responder; preserve headers-sent delegation and avoid duplicate reporting.
   Replace the four direct generic auth failures in `dev-auth.ts` with anonymous-safe helper calls; preserve invalid-credential, boot-token and rate-limit behavior.
   For preview’s plain-text response, include the safe explanation/action/copy block without changing its media type. Raw download adapters should publish failed responses to the same channel without changing successful byte handling.
   **Production +55–90/−20–35; tests +60–90.**

   Keep the hand-wording list short, in the central table:
   - **Restore `/plan`, `/confirm`, `/execute`:** distinguish preparation from execution. For execution, say the result could not be confirmed; direct users to recovery status before another restore. See [`restore.ts:62`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/recovery/restore.ts:62).
   - **Publishing import/execute, peer push/execute and manual send/undo:** warn that content may already have changed; direct users to publishing/import history before repeating anything. Existing import wording already follows this rule ([`import-errors.ts:42`](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/routes/publish-content/import-errors.ts:42)).
   - Keep existing stage-specific share/export explanations.

   A plain-text iframe can provide selectable details, but cannot host the React copy button. **A one-click button inside every standalone preview is an additional requirement, not achieved by the shared JSON consumer.**

6. **Limit the non-admin job to the two daemon boundaries.**
   At [`runs.ts:96`](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/http/runs.ts:96), distinguish failed agent startup from failure to connect to run updates; recommend checking run status before starting another task.
   At [`model-proxy.ts:465`](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/http/model-proxy.ts:465), say the assistant response stopped and to review completed actions before another turn. Apply equivalent wording to its pre-stream JSON sibling at `:377`.
   Preserve `INTERNAL_ERROR`, request/correlation IDs, event shapes and the single terminal event. No exception/provider details. **Production +15–25/−5–10; tests +25–40.**

**4. Added cost**

| Read/write/poll | Frequency × payload |
|---|---|
| Request-context access | Once per failure × method and bounded static route tokens; memory only. |
| Error response details | Once per failed response × target ≤2 KiB for default safe details; explicit export details retain existing formatter caps. |
| Client notification | Once per final unexpected failure × one formatted failure; memory only, bounded retained state. |
| Clipboard write | One explicit click × existing maximum 8,192 characters; existing fallback may make one additional attempt. |
| Preview/plain-text details | Once per failed response × target ≤2 KiB. No additional request. |
| Logs/tracker | Existing failure reporting retained; no additional diagnostic pass or sink. |
| Network reads, disk writes, polling | **0 new operations × 0 bytes.** Existing requests/retries remain unchanged. |

These are proposed bounds; actual failure rates and serialized sizes are **UNVERIFIED**.

**5. Exclusions and CUT-CANDIDATES**

No 218-site migration, response interception/`res.json` wrapping, automatic mutation retries, guessed root causes, manual repair instructions, new dependencies, schemas, platform modules or broader public/desktop sweep.

**CUT-CANDIDATES:** replacing old inline notices; error history/search; new telemetry; broad translation cleanup; one-click controls inside standalone preview documents. Keep these parked. Preserve complexity ≤10; no desktop implementation changes.

**6. Effort and dependencies**

**8–9.5 Codex hours**, including focused RED/GREEN checks during implementation: tests/contracts 1.0; wording/table 1.0; server defaults 1.25; shared display 2.0; escape paths 1.5; daemon 0.5; integration/package-consumption checks and contingency 1.25–2.25.

Jini wording and failure-channel exports precede Tovu wiring. The consumer must land with—or before—the new details envelopes. Reconcile other jobs’ working edits before implementation. Runtime behavior and published-package availability remain **UNVERIFIED**.

**7. Owner questions**

- **Must “Copy details” be one click inside standalone preview documents too?** Recommendation: keep selectable safe details there for this job; require the button in the shared admin display. Including iframe buttons needs a separately estimated preview change.
- No other owner decision is needed.