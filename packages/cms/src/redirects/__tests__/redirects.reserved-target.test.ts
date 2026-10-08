import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryOutbox } from "./support/events.fixture.js";
import { createVerifiedOrigin, InMemoryOriginSettingRepo, OriginRegistry } from "@jini-ai/http-kit/verified-origin";
import { redirectMatcher } from "../matcher.js";
import type { RedirectDbHandle } from "../ports.internal.js";
import { InMemoryRedirectRepo } from "../repo.memory.js";
import { createRedirect, tombstoneRedirect, updateRedirect, type RedirectsWriteDeps } from "../redirects.js";
import { RedirectTargetNotAllowedError } from "../types.js";
import type { RedirectRecord } from "../types.js";
import { isNeverInTrash, removeVia, restoreVia } from "./remove-redirect-double.js";

/**
 * @file The site-relative half of the write-path target gate (REQ-08's own
 * threat, applied to targets that never reach the origin allowlist because
 * they carry no authority).
 *
 * `assertTargetAllowed` consults `OriginRegistryPort.isAllowedRedirectTarget`
 * only for absolute/protocol-relative targets — a site-relative target has no
 * host to check, so the oracle has nothing to say about it. That leaves the
 * admin application's own URL space (`/admin`, `/api/...` — the SAME Express
 * app serves them, see `admin-static.ts`'s `app.use("/admin", ...)` and
 * `core.ts`'s `app.use("/api/admin", ...)`) reachable as a redirect
 * destination from a public-site rule, including through an agent-callable
 * `redirects_create`. These tests pin the refusal, its decode-then-compare
 * order, and — just as load-bearing — that a path which merely STARTS with
 * the same letters stays allowed.
 */

const WORKSPACE_ID = "workspace-1";
const ACTOR_ID = "user-1";

function makeDeps(opts: { redirectAllowlist?: string[] } = {}): RedirectsWriteDeps {
  const repo = new InMemoryRedirectRepo();
  const originRepo = new InMemoryOriginSettingRepo({ seeds: [
    {
      workspaceId: WORKSPACE_ID,
      origin: createVerifiedOrigin({
        scheme: "https",
        host: "trusted.example",
        verifiedAt: "2026-07-13T00:00:00.000Z",
        source: "workspace-setting",
      }),
      redirectAllowlist: opts.redirectAllowlist ?? [],
    },
  ] });
  let clockTick = 0;
  let idTick = 0;
  return { reservedSegments: new Set(["admin", "api"]),
    repo,
    remove: removeVia(repo as unknown as Parameters<typeof removeVia>[0]),
    isInTrash: isNeverInTrash,
    restore: restoreVia(repo as unknown as Parameters<typeof removeVia>[0]),
    db: repo as unknown as RedirectDbHandle,
    transaction: async (fn) => fn(),
    matcher: redirectMatcher,
    originRegistry: new OriginRegistry({ repo: originRepo }),
    clock: { nowMs: () => Date.parse(`2026-07-13T00:00:${String(clockTick++).padStart(2, "0")}.000Z`) },
    idGen: { newId: () => `redirect-${++idTick}` },
    outbox: new InMemoryOutbox(),
  };
}

function create(deps: RedirectsWriteDeps, fromPattern: string, toTarget: string) {
  return createRedirect({
    deps,
    input: { workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern, toTarget, statusCode: 301, actorId: ACTOR_ID },
  });
}

/**
 * Every spelling that reaches the admin application's own URL space. Each row is a distinct
 * evasion, not a restatement: raw, percent-encoded, case-shifted, dot-segmented, and separator-
 * disguised forms all normalize to `/admin` or `/api/...` in a browser following the `Location`.
 */
const RESERVED_TARGETS: readonly { readonly target: string; readonly why: string }[] = [
  { target: "/admin", why: "the bare admin SPA root" },
  { target: "/admin/settings", why: "a screen inside the admin SPA" },
  { target: "/%61dmin", why: "percent-encoded 'a' — a raw-prefix denylist never sees it" },
  { target: "/%61dmin/settings", why: "percent-encoded 'a' with a deeper path" },
  { target: "/ADMIN", why: "upper case — URL paths are compared case-sensitively by servers" },
  { target: "/AdMiN/settings", why: "mixed case" },
  { target: "/api/admin/v1/workspaces/workspace-1/settings", why: "the session-gated admin API" },
  { target: "/API/admin/v1/auth/me", why: "upper-cased API surface" },
  { target: "/%61pi/admin/v1/auth/me", why: "percent-encoded API surface" },
  { target: "/blog/../admin", why: "a dot segment the browser resolves away before requesting" },
  { target: "/blog/%2e%2e/admin", why: "an encoded dot segment" },
];

for (const { target, why } of RESERVED_TARGETS) {
  test(`createRedirect refuses the reserved target '${target}' (${why})`, async () => {
    const deps = makeDeps();
    await assert.rejects(() => create(deps, "/old", target), (err: unknown) => {
      assert.ok(err instanceof RedirectTargetNotAllowedError, `expected RedirectTargetNotAllowedError, got ${String(err)}`);
      assert.match(err.message, /is not an allowed redirect destination/);
      return true;
    });
  });
}

/**
 * The negative case that makes the rule worth having rather than a blunt prefix ban: a public
 * page whose slug merely begins with the same letters is ordinary site content.
 */
const ALLOWED_TARGETS: readonly string[] = [
  "/administer-survey",
  "/administration",
  "/apiary",
  "/api-docs",
  "/blog/admin-interview",
  "/admins-are-people-too",
];

for (const target of ALLOWED_TARGETS) {
  test(`createRedirect still allows the ordinary site path '${target}'`, async () => {
    const deps = makeDeps();
    const { record } = await create(deps, "/old", target);
    assert.equal(record.toTarget, target);
  });
}

test("updateRedirect refuses a reserved target on an already-live rule", async () => {
  const deps = makeDeps();
  const { record } = await create(deps, "/old", "/new");
  await assert.rejects(
    () =>
      updateRedirect({
        deps,
        input: { workspaceId: WORKSPACE_ID, id: record.id, toTarget: "/admin/settings", actorId: ACTOR_ID },
      }),
    RedirectTargetNotAllowedError
  );
});

test("createRedirect refuses a one-hop chain that COLLAPSES onto a reserved target", async () => {
  const deps = makeDeps();
  // Planted straight into the repo, deliberately bypassing the chokepoint: this is the row a
  // workspace that predates this guard already carries. The collapse re-check (redirects.ts) is
  // what must catch it, not the first-pass check on the caller's own literal target.
  const planted: RedirectRecord = {
    id: "planted-1",
    workspaceId: WORKSPACE_ID,
    matchType: "exact",
    fromPattern: "/hop",
    toTarget: "/admin/settings",
    statusCode: 301,
    status: "active",
    override: false,
    priority: 0,
    source: "manual",
    createdByPrincipal: ACTOR_ID,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    version: 1,
  };
  (deps.repo as InMemoryRedirectRepo).insertRedirect(planted);

  await assert.rejects(() => create(deps, "/old", "/hop"), RedirectTargetNotAllowedError);
});

test("createRedirect refuses a backslash-disguised protocol-relative target", async () => {
  // `/\evil.example` starts with a single '/', so the absolute/protocol-relative branch never
  // fires — but a URL parser treats '\' as '/', making this `//evil.example`. The origin
  // allowlist is the gate this was walking around. Asserting the exact message (not just the
  // error class) proves the OFF-ORIGIN reason wins here — the more specific `checkSiteRelativeTarget`
  // verdict, checked before B2's raw-character rule, keeps its own wording (t91 B2, 2026-09-16).
  const deps = makeDeps();
  await assert.rejects(() => create(deps, "/old", "/\\evil.example"), (err: unknown) => {
    assert.ok(err instanceof RedirectTargetNotAllowedError, `expected RedirectTargetNotAllowedError, got ${String(err)}`);
    assert.equal(
      err.message,
      "toTarget '/\\evil.example' is not an allowed redirect destination: it looks site-relative but resolves to a different host (a URL parser reads '\\' as '/')"
    );
    return true;
  });
});

test("tombstoneRedirect can still turn OFF a legacy rule whose target is now refused", async () => {
  // The escape hatch this guard must leave open: a workspace that predates it can be carrying a
  // rule pointing at /admin, and `updateRedirect` re-validates the EXISTING target on every field
  // change — so if tombstoning went through the same gate, the one operation that neutralizes the
  // bad rule would be the one operation the gate blocked.
  const deps = makeDeps();
  const planted: RedirectRecord = {
    id: "planted-2",
    workspaceId: WORKSPACE_ID,
    matchType: "exact",
    fromPattern: "/legacy",
    toTarget: "/admin/settings",
    statusCode: 301,
    status: "active",
    override: false,
    priority: 0,
    source: "manual",
    createdByPrincipal: ACTOR_ID,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    version: 1,
  };
  (deps.repo as InMemoryRedirectRepo).insertRedirect(planted);

  const { record } = await tombstoneRedirect({
    deps,
    input: { workspaceId: WORKSPACE_ID, id: "planted-2", actorId: ACTOR_ID },
  });
  assert.equal(record.status, "disabled");
});

test("updateRedirect can still REPOINT a legacy rule away from a refused target", async () => {
  const deps = makeDeps();
  const planted: RedirectRecord = {
    id: "planted-3",
    workspaceId: WORKSPACE_ID,
    matchType: "exact",
    fromPattern: "/legacy-2",
    toTarget: "/admin/settings",
    statusCode: 301,
    status: "active",
    override: false,
    priority: 0,
    source: "manual",
    createdByPrincipal: ACTOR_ID,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    version: 1,
  };
  (deps.repo as InMemoryRedirectRepo).insertRedirect(planted);

  const { record } = await updateRedirect({
    deps,
    input: { workspaceId: WORKSPACE_ID, id: "planted-3", toTarget: "/somewhere-safe", actorId: ACTOR_ID },
  });
  assert.equal(record.toTarget, "/somewhere-safe");
});

/**
 * t91 review F2 (coordinator ruling, 2026-09-16): the admin Redirects screen's on/off toggle is a
 * PATCH of `status` alone, and `updateRedirect` used to re-validate the stored target on every
 * update — so a legacy rule whose target the gate now refuses could not even be switched OFF from
 * that screen. Turning off a rule that cannot fire only reduces risk, so an update that changes
 * nothing but `status -> disabled` skips the checks. Anything else (turning a rule ON, or changing
 * any other field in the same update) still runs every check.
 */
const LEGACY_REFUSED_TARGETS: readonly { readonly target: string; readonly why: string }[] = [
  { target: "/admin/settings", why: "a reserved site-relative target" },
  { target: "/a b", why: "raw whitespace the redirect origin check refuses" },
  { target: "/\\evil.example", why: "a backslash-disguised protocol-relative target" },
  { target: "https://trusted.example/admin", why: "an absolute same-origin reserved target" },
  { target: "back", why: "Express's Referer alias" },
];

function plantLegacyRule(deps: RedirectsWriteDeps, id: string, overrides: Partial<RedirectRecord>): RedirectRecord {
  const planted: RedirectRecord = {
    id,
    workspaceId: WORKSPACE_ID,
    matchType: "exact",
    fromPattern: `/${id}`,
    toTarget: "/admin/settings",
    statusCode: 301,
    status: "active",
    override: false,
    priority: 0,
    source: "manual",
    createdByPrincipal: ACTOR_ID,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
  (deps.repo as InMemoryRedirectRepo).insertRedirect(planted);
  return planted;
}

for (const { target, why } of LEGACY_REFUSED_TARGETS) {
  test(`updateRedirect can switch OFF a legacy rule whose target is now refused: ${JSON.stringify(target)} (${why})`, async () => {
    const deps = makeDeps();
    const planted = plantLegacyRule(deps, "legacy-off", { toTarget: target });

    const { record } = await updateRedirect({
      deps,
      input: { workspaceId: WORKSPACE_ID, id: planted.id, status: "disabled", actorId: ACTOR_ID },
    });

    assert.deepEqual(record, { ...planted, status: "disabled", updatedAt: record.updatedAt, version: 2 });
    assert.equal((await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: planted.id }))?.status, "disabled");
  });
}

test("updateRedirect switch-OFF also passes when the PATCH repeats every other field unchanged", async () => {
  const deps = makeDeps();
  const planted = plantLegacyRule(deps, "legacy-full-patch", { toTarget: "/admin/settings" });
  const { matchType, fromPattern, toTarget, statusCode, override, priority } = planted;

  const { record } = await updateRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      id: planted.id,
      matchType,
      fromPattern,
      toTarget,
      statusCode,
      override,
      priority,
      status: "disabled",
      actorId: ACTOR_ID,
    },
  });

  assert.equal(record.status, "disabled");
  assert.equal(record.toTarget, "/admin/settings");
});

/** Each update below either turns the legacy rule ON or changes a field besides `status`, so the
 *  refused target must still be refused. */
const STILL_CHECKED_UPDATES: readonly { readonly name: string; readonly plantedStatus: "active" | "disabled"; readonly patch: object }[] = [
  { name: "turning a disabled rule back ON", plantedStatus: "disabled", patch: { status: "active" } },
  { name: "setting status active on an active rule", plantedStatus: "active", patch: { status: "active" } },
  { name: "a priority-only change", plantedStatus: "active", patch: { priority: 5 } },
  { name: "disabling while changing priority", plantedStatus: "active", patch: { status: "disabled", priority: 5 } },
  { name: "disabling while changing statusCode", plantedStatus: "active", patch: { status: "disabled", statusCode: 302 } },
  { name: "disabling while changing override", plantedStatus: "active", patch: { status: "disabled", override: true } },
  { name: "disabling while changing fromPattern", plantedStatus: "active", patch: { status: "disabled", fromPattern: "/moved" } },
  { name: "disabling while changing matchType", plantedStatus: "active", patch: { status: "disabled", matchType: "prefix" } },
  {
    name: "disabling while changing the target to another refused one",
    plantedStatus: "active",
    patch: { status: "disabled", toTarget: "/api/admin/v1/auth/me" },
  },
];

for (const { name, plantedStatus, patch } of STILL_CHECKED_UPDATES) {
  test(`updateRedirect still refuses a legacy rule's refused target on ${name}`, async () => {
    const deps = makeDeps();
    const planted = plantLegacyRule(deps, "legacy-checked", { status: plantedStatus });

    await assert.rejects(
      updateRedirect({
        deps,
        input: { workspaceId: WORKSPACE_ID, id: planted.id, actorId: ACTOR_ID, ...patch },
      }),
      RedirectTargetNotAllowedError
    );
    assert.deepEqual(await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: planted.id }), planted);
  });
}

/**
 * t91 B1 (2026-09-16): an ABSOLUTE same-origin target used to skip the reserved-path rule
 * entirely on write — `assertTargetAllowed` sent it only to the origin allowlist, which answers
 * "is that HOST allowed" and the workspace's own host trivially is. These four all resolve to the
 * workspace's own `/admin` or `/api` surface (a plain same-origin target, and three spellings the
 * read-path gate already refused via `checkSameOriginDestination` — see
 * `phase-handler.read-path-target.test.ts`), so a legacy rule using any of them was previously
 * stored and simply never fired. The write gate now applies the same rule so it is refused before
 * it is ever stored.
 */
const ABSOLUTE_SAME_ORIGIN_RESERVED: readonly { readonly target: string; readonly surface: string }[] = [
  { target: "https://trusted.example./admin", surface: "/admin" },
  { target: "https://trusted.example%2E/admin", surface: "/admin" },
  { target: "https://trusted.example./api/admin/v1/workspaces", surface: "/api" },
  { target: "https://trusted.example/admin", surface: "/admin" },
];

for (const { target, surface } of ABSOLUTE_SAME_ORIGIN_RESERVED) {
  test(`createRedirect refuses the absolute same-origin target '${target}'`, async () => {
    const deps = makeDeps();
    const expectedMessage = `toTarget '${target}' is not an allowed redirect destination: it resolves to '${surface}', which serves the authenticated admin application rather than this site's public pages`;
    await assert.rejects(() => create(deps, "/old", target), (err: unknown) => {
      assert.ok(err instanceof RedirectTargetNotAllowedError, `expected RedirectTargetNotAllowedError, got ${String(err)}`);
      assert.equal(err.message, expectedMessage);
      return true;
    });
  });
}

test("updateRedirect refuses an absolute same-origin reserved target on a live rule", async () => {
  const deps = makeDeps();
  const { record } = await create(deps, "/old", "/new");
  await assert.rejects(
    () =>
      updateRedirect({
        deps,
        input: { workspaceId: WORKSPACE_ID, id: record.id, toTarget: "https://trusted.example./admin", actorId: ACTOR_ID },
      }),
    RedirectTargetNotAllowedError
  );
});

test("createRedirect still allows a same-origin absolute target to ordinary content", async () => {
  const deps = makeDeps();
  for (const target of ["https://trusted.example/blog/post", "https://trusted.example./blog/post"]) {
    const { record } = await create(deps, `/old-${target}`, target);
    assert.equal(record.toTarget, target);
  }
});

test("createRedirect still allows an allowlisted cross-origin host's own /admin", async () => {
  const deps = makeDeps({ redirectAllowlist: ["partner.example"] });
  const { record } = await create(deps, "/old", "https://partner.example/admin");
  assert.equal(record.toTarget, "https://partner.example/admin");
});

/**
 * t91 B2 (2026-09-16): the write gate never checked a site-relative target for a raw backslash or
 * whitespace. `checkSiteRelativeTarget` resolves `\` as `/` (a URL parser reads it that way, and on
 * THIS site `\` really does resolve to `/`, so its own `ok` verdict is truthful), so these all
 * passed the write gate and were stored. On read, `phase-handler.ts`'s `toOracleCandidate` builds
 * the oracle candidate by CONCATENATING a relative location onto the canonical origin string, and
 * the oracle's own `FORBIDDEN_RAW_CHARS` (`features/origin/origin.ts`) refuses any raw backslash or
 * whitespace — so the read gate always refused these, and a stored rule using any of them could
 * never fire. The write gate now applies the oracle's own raw-character predicate
 * (`hasForbiddenRawUrlCharacter`) after `checkSiteRelativeTarget`, so write and read agree.
 */
const RAW_CHARACTER_TARGETS: readonly { readonly target: string; readonly why: string }[] = [
  { target: "\\", why: "the prefix-rule case: '\\' plus a request tail becomes '\\/evil.example'" },
  { target: "\\new", why: "a single leading backslash" },
  { target: "/a\\b", why: "a mid-path backslash" },
  { target: "/a b", why: "a raw space" },
  { target: "/a b", why: "a non-breaking space (JS \\s, not a C0/C1 control)" },
];

for (const { target, why } of RAW_CHARACTER_TARGETS) {
  test(`createRedirect refuses the raw-character target ${JSON.stringify(target)} (${why})`, async () => {
    const deps = makeDeps();
    const expectedMessage = `toTarget '${target}' is not an allowed redirect destination: it contains a backslash or whitespace, which the redirect origin check refuses (write a space as '%20')`;
    await assert.rejects(() => create(deps, "/old", target), (err: unknown) => {
      assert.ok(err instanceof RedirectTargetNotAllowedError, `expected RedirectTargetNotAllowedError, got ${String(err)}`);
      assert.equal(err.message, expectedMessage);
      return true;
    });
  });
}

test("createRedirect refuses a PREFIX rule whose target is a bare backslash (the reviewer's exact case)", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      createRedirect({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          matchType: "prefix",
          fromPattern: "/go",
          toTarget: "\\",
          statusCode: 301,
          actorId: ACTOR_ID,
        },
      }),
    RedirectTargetNotAllowedError
  );
});

test("createRedirect still allows a percent-encoded space", async () => {
  const deps = makeDeps();
  const { record } = await create(deps, "/old", "/a%20b");
  assert.equal(record.toTarget, "/a%20b");
});

/**
 * Express 4's `res.location()` (called by the `res.redirect()` that serves every matched rule)
 * replaces the exact string `back` with the request's `Referer` header. So a stored `back` is not a
 * site-relative path at all: it is "wherever the page that linked here was", an open redirect the
 * origin oracle never sees (t91 review F1, 2026-09-16).
 */
const REFERRER_ALIAS_MESSAGE =
  "toTarget 'back' is not an allowed redirect destination: it is 'back', which the server replaces with the visitor's Referer header (a redirect to whatever page linked here)";

test("createRedirect refuses the target 'back' (Express's Referer alias)", async () => {
  const deps = makeDeps();
  await assert.rejects(() => create(deps, "/old", "back"), (err: unknown) => {
    assert.ok(err instanceof RedirectTargetNotAllowedError, `expected RedirectTargetNotAllowedError, got ${String(err)}`);
    assert.equal(err.message, REFERRER_ALIAS_MESSAGE);
    return true;
  });
});

test("createRedirect refuses a PREFIX rule whose target is 'back' (a request for the bare prefix serves it as-is)", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      createRedirect({
        deps,
        input: { workspaceId: WORKSPACE_ID, matchType: "prefix", fromPattern: "/go", toTarget: "back", statusCode: 301, actorId: ACTOR_ID },
      }),
    (err: unknown) => err instanceof RedirectTargetNotAllowedError && err.message === REFERRER_ALIAS_MESSAGE
  );
});

test("createRedirect still allows targets that only resemble the Referer alias", async () => {
  // Express compares with `===`: `/back`, `backup` and `BACK` are sent exactly as written.
  for (const target of ["/back", "backup", "BACK"]) {
    const deps = makeDeps();
    const { record } = await create(deps, "/old", target);
    assert.equal(record.toTarget, target);
  }
});
