// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { AdminKitProvider, type AdminKit } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import type { CollectionsApiErrorLike, CollectionsHostKit } from "../../collections-host-kit.js";
import { createDraftRowIdCounter } from "../../rules.js";
import { createFakeCollectionsPort } from "../collections-dependencies.hooks.js";
import { createFakeCollectionEntriesPort } from "../collection-entries-dependencies.hooks.js";
import { createFakeNewContentTypeDialogPort } from "../new-content-type-dialog-dependencies.hooks.js";
import { useCollections } from "../use-collections.hooks.js";
import { useCollectionEntries } from "../use-collection-entries.hooks.js";
import { useLifecycleConfirmDialog } from "../use-lifecycle-confirm-dialog.hooks.js";
import { useNewContentTypeDialog } from "../use-new-content-type-dialog.hooks.js";

/**
 * @file The collections hooks read every piece of host copy through the injected
 * {@link CollectionsHostKit} (dictionary + request-error copy) and fetch through the admin kit's
 * query adapter — never through a host module. The host's own suites drive the full behaviour; this
 * file pins the injection seams the hooks gained when they moved into this package.
 */

const kit: CollectionsHostKit = {
  translate: ({ locale, key }) => `${locale}:${key}`,
  isApiError: (_e): _e is CollectionsApiErrorLike => false,
  describeApiError: ({ fallback }) => `described(${fallback})`,
  isVersionConflict: () => false,
  embedMarkerSnippet: ({ type, key, value }) => `marker(${type},${key},${value})`,
  nextDraftRowId: createDraftRowIdCounter(),
};

function wrap(adminKit: AdminKit) {
  return ({ children }: { children: ReactNode }) => createElement(AdminKitProvider, { kit: adminKit, children });
}

const failingQuery = fakeAdminKit({
  query: {
    useFetchQuery: <T,>() => ({ data: undefined as T | undefined, error: new Error("boom"), status: "error" as const, isFetching: false, refetch: () => {} }),
  },
});

const t = ({ key }: { key: string }) => key;

describe("collections hooks — host kit seams", () => {
  it("useCollections: hides system types and words a failed load through kit.describeApiError + kit.translate", () => {
    const listed = fakeAdminKit({ query: { useFetchQuery: <T,>() => ({ data: { items: [{ key: "widget" }, { key: "recipe" }] } as T, error: null, status: "success" as const, isFetching: false, refetch: () => {} }) } });
    const deps = { port: createFakeCollectionsPort(), locale: "fr", t, kit, lifecycleFailureMessage: () => "lifecycle failed" };
    const ok = renderHook(() => useCollections(deps), { wrapper: wrap(listed) });
    expect(ok.result.current.types?.map((ct) => ct.key)).toEqual(["recipe"]);
    const failed = renderHook(() => useCollections(deps), { wrapper: wrap(failingQuery) });
    expect(failed.result.current.error).toBe("described(fr:failed to load content types)");
  });

  it("useCollectionEntries: words a failed load through the kit in the caller's locale", () => {
    const { result } = renderHook(
      () => useCollectionEntries({ contentTypeKey: "recipe", port: createFakeCollectionEntriesPort(), locale: "de", t, kit }),
      { wrapper: wrap(failingQuery) },
    );
    expect(result.current.error).toBe("described(de:failed to load entries)");
    expect(result.current.entries).toBeNull();
  });

  it("useLifecycleConfirmDialog: copy comes from kit.translate with the injected locale", () => {
    const { result } = renderHook(() => useLifecycleConfirmDialog({ props: { op: "tombstone", onCancel: () => {} }, locale: "fr", kit }));
    expect(result.current.copy.title).toBe("fr:Delete content type");
    expect(result.current.autoFocusCancel).toBe(true);
  });

  it("useNewContentTypeDialog: an invalid draft is rejected with kit-translated copy, without a write", async () => {
    const { result } = renderHook(
      () => useNewContentTypeDialog({ props: { onCreated: () => {}, onCancel: () => {} }, port: createFakeNewContentTypeDialogPort(), locale: "es", kit }),
      { wrapper: wrap(fakeAdminKit()) },
    );
    await act(async () => {
      result.current.submit({ preventDefault: () => {} } as React.FormEvent);
    });
    expect(result.current.error).toMatch(/^es:/);
  });
});
