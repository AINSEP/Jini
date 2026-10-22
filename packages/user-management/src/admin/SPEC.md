# Roles administration — spec and decision, version 1

Input: owner dispatch of 2026-10-03, existing identity domain, live host roles feature,
admin media composition prototype, and ui-kit contract 1.0.0.

Acceptance: one independent roles module with lazy Roles and Policies tabs, combined
list loading, role/policy create and rename, confirmed deletion and permission revocation,
inline permission listing/granting, immutable built-ins/frozen policies, structured errors,
read-only rendering without grants, stale-request protection, abort/disposal, swappable
HTTP/memory ports, and conformance. Existing standalone screens remain untouched and
are superseded for new integration. Assignment of grants to users stays with users.

Decision: ports/adapters and a single framework-free controller own decisions and state.
The optional composition entry owns named tokens and a descriptor through admin's public
core/module only. The React binding belongs here, uses the same lazy private-scope and
effect-owned controller pattern as media, and only imports ui-kit facades for controls.
No server services, React, admin or UI imports are added to core/server entry closures.
There is no invented read permission: existing routes authorize reads themselves;
role.manage gates all client mutations and is denied by default. Server authorization,
issuer grant clamps, workspace isolation and reference checks remain mandatory.
A host can omit either tab via createAdmin or disable the whole module by not composing it.

Proof: controller tests (memory and controlled races), adapter conformance, HTTP wire tests,
React scope/render/read-only tests and confirmation (including overrides). No live server
or browser modal-layer claim is made by jsdom tests. Host swap is explicitly deferred.


## Users, members and login backup port — version 2, 2026-10-03

Inputs: owner dispatch, current live host users/members/auth screens, rules, dictionaries,
tests and HTTP routes, existing standalone screens, and the Roles module pattern.
Decision: retain the current host and legacy screens. Add independent framework-free
controllers, ports, module descriptors, HTTP/memory adapters and conformance. React owns
only effect attachment and presentation in the same one-level folder layout.

Acceptance: users list/create/email/grants/enable, confirmed disable/delete-to-trash/reset;
self reset deep link; confirmation/reveal/autofill and retained reset drafts on failure;
members list/detail/cache/refresh/resend/confirmed disable; login form and callback.
No member DELETE route exists: removal is disable-only. Grants are denied by default.
User creation/status/credentials require user.manage, assignments role.manage, members
member.manage. The existing member.manage self-email exception is retained.

Owner classification cannot be inferred safely from role names: effective wildcard ownership
may come through a custom policy. A required usersSafety host port supplies authoritative
owner/operator/unknown classification, plus seeded-owner identity. Unknown denies writes.
Only owners may modify owners; seeded owner reset is self-only and disable/delete are hidden.
Deletion requires user.manage plus the server me() trash flag and rejects self.
The host built-in-admin trash-only affordance is intentionally narrower in this backup. No new HTTP
route is invented for the safety port. The server still enforces all authorization.

Proof: baseline, controller behavior/races/disposal, HTTP wire contracts, isolated adapter
conformance, real React render/read-only/owner protection/overridden confirm flows, scoped
roles and server regression tests, tsc and repository package-layer checks. English only
in this port; locale/agent wiring and actual host swap stay with the integration owner.
