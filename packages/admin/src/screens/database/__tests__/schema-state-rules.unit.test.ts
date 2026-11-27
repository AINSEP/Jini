import { describe, expect, it } from "vitest";

import { resolveSchemaStateWarning, viewInRecoveryAccessibleName } from "../rules.js";
import type { AdminSchemaState } from "../../../core/index.js";

/**
 * @file `resolveSchemaStateWarning` — the pure decision behind the Database screen's drift warning.
 *
 * The whole reason this warning exists is that `db/drift.ts`'s classification had no human-facing
 * surface. So the property that actually matters here is NEGATIVE and is asserted throughout: the
 * ONLY input that produces silence is a confirmed-clean `"in-sync"` read (plus the pre-first-read
 * loading state, where nothing is claimed either way). Every other input — an unrecognised status,
 * a partial comparison, a failed request — must produce a visible "we could not confirm this",
 * never an absent banner that a site owner would read as "all good".
 */

function state(overrides: Partial<AdminSchemaState> = {}): AdminSchemaState {
  return {
    status: overrides.status ?? "in-sync",
    siteMeta: overrides.siteMeta === undefined ? { version: 5, tag: "0005_a" } : overrides.siteMeta,
    runtime: overrides.runtime === undefined ? { version: 5, tag: "0005_a" } : overrides.runtime,
  };
}

it("starts a Recovery control's accessible name with the localized label and ends with the viewer-local event time", () => {
  const row = { kind: "restore.executed", createdAt: "2026-07-01T03:40:23.000Z" };
  expect(viewInRecoveryAccessibleName({ locale: "es", row, viewerTimeZone: "America/Los_Angeles" }))
    .toBe("Ver en Recuperación → — restore.executed, 2026-06-30 20:40");
});

describe("resolveSchemaStateWarning", () => {
  it("stays silent for a confirmed in-sync database — the one and only clean case", () => {
    expect(resolveSchemaStateWarning({ state: state({ status: "in-sync" }), error: null })).toBeNull();
  });

  it("stays silent before the first read completes, rather than claiming either health or trouble", () => {
    expect(resolveSchemaStateWarning({ state: null, error: null })).toBeNull();
  });

  it("raises the strongest tone for a diverged database", () => {
    const warning = resolveSchemaStateWarning({
      state: state({ status: "diverged", siteMeta: { version: 7, tag: "site" }, runtime: { version: 7, tag: "runtime" } }),
      error: null,
    });
    expect(warning).not.toBeNull();
    expect(warning?.tone).toBe("error");
    expect(warning?.title).toBe("Your database does not match the software running this site");
  });

  it("distinguishes a database that is newer than the software from one that is out of date", () => {
    const ahead = resolveSchemaStateWarning({ state: state({ status: "ahead" }), error: null });
    const behind = resolveSchemaStateWarning({ state: state({ status: "behind" }), error: null });

    expect(ahead?.title).toBe("Your database is newer than the software running this site");
    expect(behind?.title).toBe("Your database is out of date");
    expect(ahead?.title).not.toBe(behind?.title);
    expect(ahead?.tone).toBe("warning");
    expect(behind?.tone).toBe("warning");
  });

  it("says it could not tell — naming the incomplete comparison — when the server reports 'unknown'", () => {
    const warning = resolveSchemaStateWarning({ state: state({ status: "unknown", siteMeta: null }), error: null });
    expect(warning?.tone).toBe("warning");
    expect(warning?.title).toBe("We could not check your database");
    expect(warning?.body).toBe(
      "One of the two records we compare is missing, so we cannot tell whether your database is up to date. That is not itself a sign of a problem — but nothing has been confirmed either.",
    );
  });

  it("says it could not tell when the request itself failed, instead of rendering nothing", () => {
    const warning = resolveSchemaStateWarning({ state: null, error: "network down" });
    expect(warning?.tone).toBe("warning");
    expect(warning?.title).toBe("We could not check your database");
    expect(warning?.body).toBe("This check did not finish, so we cannot tell whether your database is up to date. Try reloading the page.");
  });

  it("lets a failed request outrank a stale successful read — a check that just failed is not confirmation", () => {
    const warning = resolveSchemaStateWarning({ state: state({ status: "in-sync" }), error: "network down" });
    expect(warning?.title).toBe("We could not check your database");
  });

  it("treats an unrecognised status from the server as unconfirmed, never as clean", () => {
    const warning = resolveSchemaStateWarning({
      state: { status: "some-future-status" as AdminSchemaState["status"], siteMeta: null, runtime: null },
      error: null,
    });
    expect(warning).not.toBeNull();
    expect(warning?.title).toBe("We could not check your database");
  });

  it("never puts an internal status name in copy a site owner reads", () => {
    const internalTerms = ["in-sync", "diverged", "ahead", "behind", "unknown", "schema", "drift", "lineage"];
    for (const status of ["diverged", "ahead", "behind", "unknown"] as const) {
      const warning = resolveSchemaStateWarning({ state: state({ status }), error: null });
      const copy = `${warning?.title} ${warning?.body}`.toLowerCase();
      for (const term of internalTerms) {
        expect(copy, `status '${status}' leaked '${term}'`).not.toContain(term);
      }
    }
  });
});
