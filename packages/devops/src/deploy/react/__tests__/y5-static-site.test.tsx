// @vitest-environment jsdom
import { bindPublishCredentials } from "../hooks/use-publish-credentials.hooks.js";
import { bindStaticPublish } from "../hooks/use-static-publish.hooks.js";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { StaticSiteTab, bindStaticSiteTab, type StaticSiteTabProps } from "../StaticSiteTab.js";
import { afterEach, expect, test, vi } from "vitest";
import { bindStaticExport } from "../hooks/use-static-export.hooks.js";
import { useEffect, useState } from "react";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import type { AdminPublishCredentialSummary } from "@jini-ai/core/contracts/site/api-security-api-types";
import type { ExportRunSnapshot } from "@jini-ai/core/contracts/site/export-run";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const idle: ExportRunSnapshot = { status: "idle", startedAtIso: null, finishedAtIso: null, outputDir: null };
const running: ExportRunSnapshot = { ...idle, status: "running" };
const completed: ExportRunSnapshot = { ...idle, status: "completed", ok: true };

function binding(port: Parameters<typeof bindStaticExport>[0]["deps"]["port"], overrides: Partial<Parameters<typeof bindStaticExport>[0]["hooks"]> = {}) {
  return bindStaticExport({
    hooks: {
      useLocaleHook: () => "en", useContentRefreshSubscription: () => {},
      useFetchQuery: () => ({ data: undefined, error: null, status: "loading", isFetching: true, refetch: () => {} }),
      ...overrides,
    },
    deps: {
      port, translate: ({ key }) => key,
      describeApiError: ({ e }) => String(e),
      exportLoadErrorMessage: ({ error }) => error,
      exportPollErrorMessage: ({ error }) => error,
      exportTriggerErrorMessage: ({ error }) => error,
      setTimeout, clearTimeout,
    },
  });
}

test("export refusal keeps clean false and surfaces the trigger error", async () => {
  const triggerSiteExport = vi.fn(async () => { throw new Error("output directory is not empty"); });
  const useExport = binding({ triggerSiteExport, getSiteExportStatus: async () => idle });
  const { result } = renderHook(() => useExport({}));
  await act(() => result.current.trigger());
  expect(triggerSiteExport).toHaveBeenCalledWith({}, { options: { clean: false } });
  expect(result.current.clean).toBe(false);
  expect(result.current.triggerError).toContain("output directory is not empty");
  expect(result.current.isRunning).toBe(false);
});

test("export reports progress and cancels its timer when unmounted", async () => {
  vi.useFakeTimers();
  const getSiteExportStatus = vi.fn(async () => completed);
  const useExport = binding({ triggerSiteExport: async () => running, getSiteExportStatus });
  const mounted = renderHook(() => useExport({}));
  await act(() => mounted.result.current.trigger());
  expect(mounted.result.current.isRunning).toBe(true);
  expect(vi.getTimerCount()).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(mounted.result.current.run).toEqual(completed);
  expect(mounted.result.current.isRunning).toBe(false);
  await act(() => mounted.result.current.trigger());
  expect(vi.getTimerCount()).toBe(1);
  mounted.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

function publishBinding(port: Parameters<typeof bindStaticPublish>[0]["deps"]["port"], overrides: Partial<Parameters<typeof bindStaticPublish>[0]["hooks"]> = {}) {
  const targets = [{ id: "first", label: "First", configFields: [] }, { id: "second", label: "Second", configFields: [] }];
  return bindStaticPublish({ hooks: {
    useLocaleHook: () => "en",
    useFetchQuery: <T,>({ key }: { key: readonly unknown[] }) => ({ data: (key[1] === "publish-targets" ? targets : undefined) as T | undefined, status: "success" as const, error: null, isFetching: false, refetch: () => {} }),
    ...overrides,
  }, deps: {
    port, translate: ({ locale, key }) => locale === "en" ? key : `${locale}/${key}`, localizePublishTargets: ({ targets }) => targets,
    describeApiError: ({ e }) => String(e),
    publishLoadErrorMessage: ({ error }) => error, publishPollErrorMessage: ({ error }) => error,
    publishPreviewErrorMessage: ({ error }) => error, publishTriggerErrorMessage: ({ error }) => error,
    errorRedactionOptions: {}, setTimeout, clearTimeout,
  } });
}

test("a target change rejects a late preview and releases the preview spinner", async () => {
  let resolve!: (value: NonNullable<import("../hooks/use-static-publish.hooks.js").StaticPublishController["preview"]>) => void;
  const getPublishPreview = vi.fn(() => new Promise<NonNullable<import("../hooks/use-static-publish.hooks.js").StaticPublishController["preview"]>>(done => { resolve = done; }));
  const usePublish = publishBinding({ listPublishTargets: async () => [], getPublishStatus: vi.fn(), triggerPublish: vi.fn(), getPublishPreview });
  const { result } = renderHook(() => usePublish({}));
  let request!: Promise<void>;
  act(() => { request = result.current.checkPreview(); });
  act(() => result.current.setTarget("second"));
  await act(async () => { resolve({ target: "first", valid: true, validationError: null, basePath: "/first", credentialsConfigured: true, credentialGuidance: null, willInjectNojekyll: false }); await request; });
  expect(result.current.target).toBe("second");
  expect(result.current.preview).toBeUndefined();
  expect(result.current.previewLoading).toBe(false);
  expect(getPublishPreview).toHaveBeenCalledExactlyOnceWith({ target: "first", fields: {} });
});

test("publish sends one trigger, stops at three poll failures, and clears timers on unmount", async () => {
  vi.useFakeTimers();
  let settle!: (value: NonNullable<import("../hooks/use-static-publish.hooks.js").StaticPublishController["run"]>) => void;
  const triggerPublish = vi.fn(() => new Promise<NonNullable<import("../hooks/use-static-publish.hooks.js").StaticPublishController["run"]>>(done => { settle = done; }));
  const getPublishStatus = vi.fn(async () => { throw new Error("poll down"); });
  const usePublish = publishBinding({ listPublishTargets: async () => [], getPublishPreview: vi.fn(), triggerPublish, getPublishStatus });
  const mounted = renderHook(() => usePublish({}));
  let first!: Promise<void>;
  act(() => { first = mounted.result.current.publish({ credentialId: "selected" }); });
  await act(() => mounted.result.current.publish({ credentialId: "selected" }));
  expect(triggerPublish).toHaveBeenCalledExactlyOnceWith({ config: { target: "first", fields: {} }, projectName: "first", credentialId: "selected" });
  await act(async () => { settle({ status: "running", startedAtIso: null, finishedAtIso: null, target: "first" }); await first; });
  await act(() => vi.advanceTimersByTimeAsync(4500));
  expect(getPublishStatus).toHaveBeenCalledTimes(3);
  expect(mounted.result.current.pollError).toContain("poll down");
  expect(mounted.result.current.isPublishing).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  act(() => { void mounted.result.current.publish(); });
  await act(async () => { settle({ status: "running", startedAtIso: null, finishedAtIso: null, target: "first" }); });
  expect(vi.getTimerCount()).toBe(1);
  mounted.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test("credential edits survive save and verify, and a confirmed picker change survives failed reconciliation", async () => {
  const saved = { id: "one", credentialType: "vendor" as const, worksFor: [], providerId: "host", label: "One", configured: true as const, isDefault: true, createdAt: "", updatedAt: "", accountLabel: null };
  const second = { ...saved, id: "two", label: "Two", isDefault: false };
  const snapshot = { credentials: [saved, second], executionMode: "hosted-api-only" as const };
  let finishSave!: (value: typeof saved) => void;
  let finishVerify!: (value: { status: "valid"; message: string; checkedAt: string; accountLabel: string }) => void;
  const updateCredential = vi.fn(({ id, input }: { id: string; input: { isDefault?: boolean } }) => input.isDefault ? Promise.resolve({ ...second, id, isDefault: true }) : new Promise<typeof saved>(done => { finishSave = done; }));
  const verifyCredential = vi.fn(() => new Promise<{ status: "valid"; message: string; checkedAt: string; accountLabel: string }>(done => { finishVerify = done; }));
  const useCredentials = bindPublishCredentials({ hooks: {
    useLocaleHook: () => "en", useFetchQuery: <T,>() => ({ data: snapshot as T, status: "success" as const, error: null, isFetching: false, refetch: () => {} }),
  }, deps: {
    port: { listCredentials: async () => { throw new Error("reconcile down"); }, createCredential: vi.fn(), updateCredential, deleteCredential: vi.fn(), verifyCredential },
    translate: ({ key }) => key, classifyCredentialSubmitError: () => ({ kind: "generic" }),
    credentialDraftError: () => null, translateCredentialMessage: ({ message }) => message, describeApiError: ({ e }) => String(e),
    publishCredentialSaveErrorMessage: ({ error }) => error, publishCredentialsLoadErrorMessage: ({ error }) => error,
    publishCredentialSelectErrorMessage: ({ error }) => error, publishCredentialVerifyErrorMessage: ({ error }) => error,
  } });
  const { result } = renderHook(() => useCredentials({ targets: [{ id: "host", label: "Host", configFields: [], credential: { tokenField: "token", fields: [{ name: "token", label: "Token", required: true, secret: true }] } }] }));
  act(() => result.current.setField({ providerId: "host", fieldName: "token", value: "sent" }));
  let saving!: Promise<void>;
  act(() => { saving = result.current.save("host"); });
  act(() => result.current.setField({ providerId: "host", fieldName: "token", value: "newer" }));
  await act(async () => { finishSave(saved); await saving; });
  expect(result.current.rows?.[0]?.values.token).toBe("newer");
  expect(result.current.rows?.[0]?.saving).toBe(false);
  let verifying!: Promise<void>;
  act(() => { verifying = result.current.verify("host"); });
  act(() => result.current.setField({ providerId: "host", fieldName: "token", value: "newest" }));
  await act(async () => { finishVerify({ status: "valid", message: "verified", checkedAt: "", accountLabel: "account" }); await verifying; });
  expect(result.current.rows?.[0]?.values.token).toBe("newest");
  expect(result.current.rows?.[0]?.saved?.accountLabel).toBe("account");
  await act(() => result.current.selectCredential({ providerId: "host", credentialId: "two" }));
  expect(result.current.rows?.[0]?.saved?.id).toBe("two");
  expect(result.current.rows?.[0]?.selectError).toBeNull();
  expect(result.current.rows?.[0]?.verification).toBeUndefined();
  expect(result.current.credentialsForProvider("host").map(row => [row.id, row.isDefault])).toEqual([["one", false], ["two", true]]);
});

function viewProps(trigger = vi.fn(async () => {})): StaticSiteTabProps {
  return {
    kit: { Icon: () => null, CredentialHint: () => null, SecretInput: () => null, TabBar: () => null, ErrorNotice: () => null },
    hooks: { useAdminLocale: () => "en",
      useStaticExportHook: () => ({ run: running, t: key => key, clean: false, triggering: false,
        isRunning: true, triggerError: "output directory is not empty", pollError: null, loadError: null, setClean: vi.fn(), trigger }),
      useStaticPublishHook: () => ({ targets: [], targetsError: null, target: "", selectedTarget: undefined,
        setTarget: vi.fn(), configValues: {}, setConfigField: vi.fn(), canPreview: false, canPublish: false,
        projectNameCopy: null, projectName: "", setProjectName: vi.fn(), preview: undefined, previewLoading: false,
        previewError: null, checkPreview: vi.fn(async () => {}), run: undefined, isPublishing: false, loadError: null,
        pollError: null, publishError: null, publishing: false, publish: vi.fn(async () => {}), t: key => key }),
      usePublishCredentialsHook: () => ({ rows: [], executionMode: "hosted-api-only", loadError: null,
        credentialChangePending: false, setField: vi.fn(), save: vi.fn(async () => {}), credentialsForProvider: () => [],
        selectCredential: vi.fn(async () => {}), verify: vi.fn(async () => {}), t: key => key }),
      useWiredCopyToClipboard: () => ({ copied: false, copy: vi.fn(async () => true) }),
    },
    deps: { STATIC_SITE_CAPABILITIES: [], t: ({ key }) => key, createStaticSiteTabTranslator: () => key => key,
      adminHref: ({ routePath }) => routePath, pluginsPath: "/plugins", accessTokensPath: "/tokens", navigate: vi.fn(),
      VIEWER_TIME_ZONE: "UTC", asciiSlug: ({ text }) => text, PUBLISH_RUN_RESULT_CLASSES: { success: "success", error: "error" },
      LINE_ICON: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
      copy: { exportDescription: "Host export description", exportCommand: "host export <dir>",
        credentialSubtitle: "Connect {credential}", storedTokenNotice: "Stored encrypted", pickerTokenNotice: "Pick a token", productName: "Host" },
    },
  };
}

test("static-site view renders export refusal and progress using its required collaborators", () => {
  const trigger = vi.fn(async () => {});
  const props = viewProps(trigger);
  const useExport = vi.spyOn(props.hooks, "useStaticExportHook");
  const usePublish = vi.spyOn(props.hooks, "useStaticPublishHook");
  const useCredentials = vi.spyOn(props.hooks, "usePublishCredentialsHook");
  render(<StaticSiteTab {...props} />);
  expect(screen.getByRole("alert").textContent).toBe("output directory is not empty");
  expect(screen.getByRole("button", { name: "Exporting…" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Host export description")).toBeTruthy();
  expect(screen.getByText("host export <dir>")).toBeTruthy();
  expect(useExport).toHaveBeenCalledOnce();
  expect(usePublish).toHaveBeenCalledOnce();
  expect(useCredentials).toHaveBeenCalledExactlyOnceWith({ targets: [] });
  expect(useExport.mock.invocationCallOrder[0]).toBeLessThan(usePublish.mock.invocationCallOrder[0]!);
  expect(usePublish.mock.invocationCallOrder[0]).toBeLessThan(useCredentials.mock.invocationCallOrder[0]!);
  expect(trigger).not.toHaveBeenCalled();
});

test("export seeds the latest run, then background refresh replaces it without surfacing transient errors", async () => {
  const status = vi.fn<Parameters<typeof binding>[0]["getSiteExportStatus"]>()
    .mockResolvedValueOnce(completed).mockRejectedValueOnce(new Error("refresh offline"));
  let refresh: (() => void) | undefined;
  const useExport = binding({ triggerSiteExport: vi.fn(), getSiteExportStatus: status }, {
    useContentRefreshSubscription: ({ resource, onRefresh }) => {
      expect(resource).toBe("deployment-export");
      useEffect(() => {
        refresh = onRefresh;
        return () => { refresh = undefined; };
      }, [onRefresh]);
    },
    useFetchQuery: <T,>() => ({ data: idle as T, error: new Error("bootstrap stale"), status: "success" as const, isFetching: false, refetch: () => {} }),
  });
  const mounted = renderHook(() => useExport({}));
  expect(mounted.result.current.run).toEqual(idle);
  expect(mounted.result.current.loadError).toContain("bootstrap stale");
  await act(async () => { refresh?.(); });
  expect(mounted.result.current.run).toEqual(completed);
  await act(async () => { refresh?.(); });
  expect(mounted.result.current.run).toEqual(completed);
  expect(mounted.result.current.triggerError).toBeNull();
  expect(status.mock.calls).toEqual([[], []]);
  mounted.unmount();
  expect(refresh).toBeUndefined();
});

test("three consecutive export poll failures stop polling and a new build can recover", async () => {
  vi.useFakeTimers();
  const status = vi.fn<Parameters<typeof binding>[0]["getSiteExportStatus"]>()
    .mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce(running)
    .mockRejectedValueOnce(new Error("export status offline")).mockRejectedValueOnce(new Error("export status offline"))
    .mockRejectedValueOnce(new Error("export status offline")).mockResolvedValueOnce(completed);
  const trigger = vi.fn<Parameters<typeof binding>[0]["triggerSiteExport"]>(async () => running);
  const useExport = binding({ triggerSiteExport: trigger, getSiteExportStatus: status });
  const { result } = renderHook(() => useExport({}));
  await act(() => result.current.trigger());
  await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(result.current.isRunning).toBe(true);
  expect(result.current.pollError).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(result.current.isRunning).toBe(false);
  expect(result.current.pollError).toBe("Error: export status offline");
  expect(status).toHaveBeenCalledTimes(5);
  expect(vi.getTimerCount()).toBe(0);
  act(() => result.current.setClean(true));
  await act(() => result.current.trigger());
  expect(trigger.mock.calls).toEqual([[{}, { options: { clean: false } }], [{}, { options: { clean: true } }]]);
  expect(result.current.pollError).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(result.current.run).toEqual(completed);
  expect(vi.getTimerCount()).toBe(0);
});

test("publish replays a saved destination before targets load and retains a structured start error", async () => {
  const triggerPublish = vi.fn<Parameters<typeof publishBinding>[0]["triggerPublish"]>()
    .mockRejectedValueOnce(new Error("queue refused"))
    .mockResolvedValueOnce({ status: "completed", target: "archive", startedAtIso: null, finishedAtIso: null });
  const usePublish = publishBinding({ triggerPublish, listPublishTargets: vi.fn(), getPublishPreview: vi.fn(), getPublishStatus: vi.fn() }, {
    useFetchQuery: <T,>({ key }: { key: readonly unknown[] }) => ({
      data: (key[1] === "publish" ? { status: "idle", target: null, startedAtIso: null, finishedAtIso: null } : undefined) as T | undefined,
      error: new Error(key[1] === "publish" ? "status offline" : "catalog offline"), status: "success" as const, isFetching: false, refetch: () => {},
    }),
  });
  const { result } = renderHook(() => usePublish({}));
  expect(result.current.target).toBe("");
  expect(result.current.run?.status).toBe("idle");
  expect(result.current.targetsError).toBe("Error: catalog offline");
  expect(result.current.loadError).toBe("Error: status offline");
  await act(() => result.current.publish());
  expect(triggerPublish).not.toHaveBeenCalled();
  const destination = { config: { target: "archive", fields: { bucket: "docs" } }, projectName: "kept deployment" };
  await act(() => result.current.publish({ destination }));
  expect(triggerPublish).toHaveBeenCalledExactlyOnceWith(destination);
  expect(result.current.publishError).toBe("Error: queue refused");
  expect(result.current.publishFailure).toMatchObject({
    message: "Error: queue refused", step: "static.publish.start",
    action: "Check publish status before starting another publish. Copy details and report this problem.",
  });
  expect(result.current.publishing).toBe(false);
  await act(() => result.current.publish({ destination }));
  expect(result.current.publishFailure).toBeNull();
  expect(result.current.publishError).toBeNull();
  expect(result.current.run?.status).toBe("completed");
});

test("publish preview ignores an invalid target, drops stale errors and accepts a new field-specific result", async () => {
  type Preview = NonNullable<ReturnType<ReturnType<typeof publishBinding>>["preview"]>;
  let reject!: (error: Error) => void;
  const preview: Preview = { target: "first", valid: true, validationError: null, basePath: "/docs", credentialsConfigured: true, credentialGuidance: null, willInjectNojekyll: false };
  const getPublishPreview = vi.fn<Parameters<typeof publishBinding>[0]["getPublishPreview"]>()
    .mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }))
    .mockRejectedValueOnce(new Error("destination offline")).mockResolvedValueOnce(preview);
  const usePublish = publishBinding({ getPublishPreview, listPublishTargets: vi.fn(), getPublishStatus: vi.fn(), triggerPublish: vi.fn() }, {
    useFetchQuery: <T,>({ key }: { key: readonly unknown[] }) => ({
      data: (key[1] === "publish-targets" ? [{ id: "first", label: "First", configFields: [{ name: "repo", label: "Repo", required: true }] }] : undefined) as T | undefined,
      error: null, status: "success" as const, isFetching: false, refetch: () => {},
    }),
  });
  const { result } = renderHook(() => usePublish({}));
  act(() => result.current.setTarget("not-installed"));
  expect(result.current.target).toBe("first");
  act(() => result.current.setConfigField({ name: "repo", value: " old " }));
  let inFlight!: Promise<void>;
  act(() => { inFlight = result.current.checkPreview(); void result.current.checkPreview(); });
  expect(getPublishPreview.mock.calls).toEqual([[{ target: "first", fields: { repo: "old" } }]]);
  act(() => result.current.setConfigField({ name: "repo", value: " docs " }));
  await act(async () => { reject(new Error("old repo not found")); await inFlight; });
  expect(result.current.previewError).toBeNull();
  expect(result.current.previewLoading).toBe(false);
  await act(() => result.current.checkPreview());
  expect(result.current.previewError).toBe("Error: destination offline");
  await act(() => result.current.checkPreview());
  expect(result.current.previewError).toBeNull();
  expect(result.current.preview).toEqual(preview);
  expect(getPublishPreview.mock.calls.slice(1)).toEqual(Array.from({ length: 2 }, () => [{ target: "first", fields: { repo: "docs" } }]));
});

test("a successful publish poll resets the consecutive failure count and stops at completion", async () => {
  vi.useFakeTimers();
  const running = { status: "running" as const, target: "first", startedAtIso: null, finishedAtIso: null };
  const done = { ...running, status: "completed" as const };
  const getPublishStatus = vi.fn<Parameters<typeof publishBinding>[0]["getPublishStatus"]>()
    .mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce(running)
    .mockRejectedValueOnce(new Error("another transient")).mockRejectedValueOnce(new Error("still transient"))
    .mockResolvedValueOnce(done);
  const usePublish = publishBinding({ getPublishStatus, triggerPublish: async () => running, listPublishTargets: vi.fn(), getPublishPreview: vi.fn() });
  const { result } = renderHook(() => usePublish({}));
  await act(() => result.current.publish());
  await act(() => vi.advanceTimersByTimeAsync(7500));
  expect(getPublishStatus.mock.calls).toEqual([[], [], [], [], []]);
  expect(result.current.pollError).toBeNull();
  expect(result.current.run).toEqual(done);
  expect(result.current.isPublishing).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

const docsTarget = { id: "docs", label: "Docs Host", configFields: [
  { name: "teamId", label: "Team", required: true, userHelp: "Use a team slug" },
  { name: "branch", label: "Branch" },
], credential: { tokenField: "token", fields: [{ name: "token", label: "Access token", secret: true as const, required: true }] } };
const archiveTarget = { id: "archive", label: "Archive Host", configFields: [] };
const connection: AdminPublishCredentialSummary = {
  id: "docs-key", providerId: "docs", label: "Docs team", credentialType: "vendor", worksFor: ["docs"], configured: true,
  isDefault: true, createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-02T10:00:00Z", accountLabel: "docs-account",
};

test("export view copies the shown command, forwards overwrite and explains completed or errored runs", async () => {
  const trigger = vi.fn(async () => {});
  const props = viewProps(trigger);
  const copy = vi.fn(async (_text: string) => true);
  props.hooks.useWiredCopyToClipboard = () => {
    const [copied, setCopied] = useState(false);
    return { copied, copy: async text => { const ok = await copy(text); setCopied(ok); return ok; } };
  };
  const run: ExportRunSnapshot = {
    ...completed, ok: false, outputDir: "/exports/docs",
    counts: { routesSucceeded: 3, routesFailed: 1, assetsSucceeded: 8, assetsFailed: 2 },
    failedRoutes: [{ path: "/old", kind: "page", reason: "HTTP 503" }],
    failedAssets: [{ url: "/banner.png", reason: "file missing" }],
  };
  let liveRun = run;
  props.hooks.useStaticExportHook = () => {
    const [clean, setClean] = useState(false);
    return { run: liveRun, clean, setClean, trigger, triggering: false, isRunning: false,
      t: key => key, loadError: "could not restore export", pollError: "status polling stopped", triggerError: null };
  };
  const Bound = bindStaticSiteTab(props);
  const { rerender } = render(<Bound />);
  expect(screen.getByText("could not restore export").getAttribute("role")).toBe("status");
  expect(screen.getByText("status polling stopped").getAttribute("role")).toBe("status");
  expect(screen.getByText("Finished with failures").textContent).toBe("Finished with failures");
  expect(screen.getByText("3 succeeded, 1 failed").textContent?.trim()).toBe("3 succeeded, 1 failed");
  expect(screen.getByText("8 succeeded, 2 failed").textContent?.trim()).toBe("8 succeeded, 2 failed");
  expect(screen.getByText("/exports/docs").tagName).toBe("CODE");
  expect(screen.getAllByRole("listitem").map(item => item.textContent)).toEqual(expect.arrayContaining(["/old — HTTP 503", "/banner.png — file missing"]));
  const checkbox = screen.getByRole("checkbox", { name: "Overwrite existing files in the output folder" }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Build static export" }));
  expect(trigger).toHaveBeenCalledExactlyOnceWith();
  const button = screen.getByRole("button", { name: "Copy the export command" });
  await act(async () => { fireEvent.click(button); });
  expect(copy).toHaveBeenCalledExactlyOnceWith("host export <dir>");
  expect(within(button).getByText("Copied!").getAttribute("aria-live")).toBe("polite");
  liveRun = { ...idle, status: "errored", error: "export writer ran out of space" };
  rerender(<Bound />);
  expect(screen.getByRole("alert").textContent).toBe("export writer ran out of space");
  liveRun = { ...completed, counts: { routesSucceeded: 3, routesFailed: 0, assetsSucceeded: 8, assetsFailed: 0 }, failedRoutes: [], failedAssets: [] };
  rerender(<Bound />);
  expect(screen.getByText("Export finished").textContent).toBe("Export finished");
  expect(screen.queryByText("Failed routes")).toBeNull();
  expect(screen.queryByText("Failed assets")).toBeNull();
  expect(screen.queryByText("Written to")).toBeNull();
});

test("publish view scopes credentials to the active tab and submits the selected key only when ready", () => {
  const props = viewProps();
  const navigate = vi.fn<typeof props.deps.navigate>();
  props.deps.navigate = navigate;
  props.kit.TabBar = ({ ariaLabel, tabs, activeId, onChange }) => <div role="tablist" aria-label={ariaLabel}>
    {tabs.map(tab => <button type="button" key={tab.id} role="tab" aria-selected={activeId === tab.id} onClick={() => onChange(tab.id)}>
      {tab.label}{tab.dot ? ` (${tab.dotLabel})` : ""}
    </button>)}
  </div>;
  const basePublish = props.hooks.useStaticPublishHook();
  const checkPreview = vi.fn(async () => {});
  const publish = vi.fn<typeof basePublish.publish>(async () => {});
  const configEdit = vi.fn<typeof basePublish.setConfigField>();
  const projectEdit = vi.fn<typeof basePublish.setProjectName>();
  let pending = true;
  props.hooks.useStaticPublishHook = () => {
    const [target, setTarget] = useState("docs");
    const selectedTarget = target === "docs" ? docsTarget : archiveTarget;
    return { ...basePublish, target, selectedTarget, setTarget, targets: [docsTarget, archiveTarget],
      configValues: {}, setConfigField: configEdit, setProjectName: projectEdit, checkPreview, publish,
      canPreview: true, canPublish: true, projectNameCopy: target === "docs" ? { labelKey: "Project", helpKey: "Shown in the hosting dashboard" } : null,
    };
  };
  const baseCredentials = props.hooks.usePublishCredentialsHook({ targets: [] });
  props.hooks.usePublishCredentialsHook = () => ({
    ...baseCredentials, credentialChangePending: pending, rows: [{
      providerId: "docs", label: "Docs Host", credential: docsTarget.credential, saved: connection, values: {},
      saving: false, error: null, verifying: false, verification: undefined, verifyError: null, selectingCredentialId: null, selectError: null,
    }],
  });
  const { rerender } = render(<StaticSiteTab {...props} />);
  expect(screen.getByRole("tab", { name: "Docs Host (Connected)" }).getAttribute("aria-selected")).toBe("true");
  const credentialRegion = document.querySelector('[data-agent-element="deployment-static-site-credentials-section"]')!;
  expect(within(credentialRegion as HTMLElement).getByText("Replace token").textContent).toBe("Replace token");
  expect(screen.getByText("Use a team slug").textContent).toBe("Use a team slug");
  expect(screen.getByText("Shown in the hosting dashboard").textContent).toBe("Shown in the hosting dashboard");
  fireEvent.change(screen.getByRole("textbox", { name: "Team" }), { target: { value: "docs-team" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Project" }), { target: { value: "November docs" } });
  expect(configEdit).toHaveBeenCalledExactlyOnceWith({ name: "teamId", value: "docs-team" });
  expect(projectEdit).toHaveBeenCalledExactlyOnceWith("November docs");
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(checkPreview).toHaveBeenCalledExactlyOnceWith();
  const publishButton = () => screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement;
  expect(publishButton().disabled).toBe(true);
  fireEvent.click(publishButton());
  expect(publish).not.toHaveBeenCalled();
  pending = false;
  rerender(<StaticSiteTab {...props} />);
  expect(publishButton().disabled).toBe(false);
  fireEvent.click(publishButton());
  expect(publish).toHaveBeenNthCalledWith(1, { credentialId: "docs-key" });

  fireEvent.click(screen.getByRole("tab", { name: "Archive Host" }));
  expect(screen.getByRole("tab", { name: "Archive Host" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByText("Replace token")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Project" })).toBeNull();
  fireEvent.click(publishButton());
  expect(publish).toHaveBeenNthCalledWith(2, {});
  fireEvent.click(screen.getByRole("button", { name: "Create access token" }));
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ routePath: "/tokens" });
});

test("publish view distinguishes discovery failures, a missing connection and an empty plugin catalog", () => {
  const props = viewProps();
  const publish = props.hooks.useStaticPublishHook();
  const credentials = props.hooks.usePublishCredentialsHook({ targets: [] });
  let targets: typeof publish.targets;
  let targetError: string | null = "targets unreachable";
  let credentialError: string | null = "credentials unreachable";
  let rows: typeof credentials.rows;
  props.hooks.useStaticPublishHook = () => ({ ...publish, targets, targetsError: targetError, target: "docs", loadError: "publish status offline" });
  props.hooks.usePublishCredentialsHook = () => ({ ...credentials, rows, loadError: credentialError });
  props.deps.adminHref = ({ routePath }) => `/admin${routePath}`;
  const { rerender } = render(<StaticSiteTab {...props} />);
  expect(screen.getByText("targets unreachable").getAttribute("role")).toBe("status");
  expect(screen.getByText("publish status offline").getAttribute("role")).toBe("status");
  expect(screen.getByText("credentials unreachable").getAttribute("role")).toBe("status");
  expect(screen.queryByText("Loading credentials…")).toBeNull();
  credentialError = null;
  rerender(<StaticSiteTab {...props} />);
  expect(screen.getByText("Loading credentials…").textContent).toBe("Loading credentials…");
  rows = [{
    providerId: "docs", label: "Docs Host", credential: docsTarget.credential, saved: undefined, values: {},
    saving: false, error: null, verifying: false, verification: undefined, verifyError: null, selectingCredentialId: null, selectError: null,
  }];
  targets = [docsTarget]; targetError = null;
  rerender(<StaticSiteTab {...props} />);
  expect(screen.getByRole("heading", { name: "Connect Docs Host" }).textContent?.trim()).toBe("Connect Docs Host");
  expect(screen.queryByText("Loading credentials…")).toBeNull();
  targets = [];
  rerender(<StaticSiteTab {...props} />);
  expect(screen.getByRole("link", { name: "Plugins" }).getAttribute("href")).toBe("/admin/plugins");
  expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
});

test("publish view explains preview and publish failures without showing credential material", () => {
  const props = viewProps();
  props.kit.ErrorNotice = ({ failure }) => <p role="alert">{failure.message} | {failure.action}</p>;
  const base = props.hooks.useStaticPublishHook();
  const preview = { target: "docs", valid: false, validationError: "repository is required", basePath: null,
    credentialsConfigured: false, credentialGuidance: null, willInjectNojekyll: false };
  const controller = { ...base, targets: [docsTarget], target: "docs", canPreview: true, previewLoading: true, publishing: true,
    preview, previewError: "preview requests delayed", publishError: "plain failure", pollError: "publish polls offline",
  } satisfies ReturnType<typeof props.hooks.useStaticPublishHook>;
  props.hooks.useStaticPublishHook = () => controller;
  const { rerender } = render(<StaticSiteTab {...props} />);
  expect((screen.getByRole("button", { name: "Checking…" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Publishing…" }) as HTMLButtonElement).disabled).toBe(true);
  for (const message of ["repository is required", "preview requests delayed", "plain failure"]) {
    expect(screen.getByText(message).getAttribute("role")).toBe("alert");
  }
  expect(screen.getByText("publish polls offline").getAttribute("role")).toBe("status");
  const failure = { message: "request refused", action: "Check dashboard", cause: "offline", step: "static.publish.start", copyText: "copy details" };
  props.hooks.useStaticPublishHook = () => ({ ...controller, previewLoading: false, publishing: false, publishFailure: failure,
    preview: { ...preview, valid: true, validationError: null, credentialGuidance: "Save a workspace credential first" } });
  rerender(<StaticSiteTab {...props} />);
  expect(screen.getByText("request refused | Check dashboard").getAttribute("role")).toBe("alert");
  expect(screen.queryByText("plain failure")).toBeNull();
  expect(screen.getByText("Not configured").textContent).toBe("Not configured");
  expect(screen.getByText("None — serves from the domain root").textContent).toBe("None — serves from the domain root");
  expect(screen.getByText("Save a workspace credential first").textContent).toBe("Save a workspace credential first");
  props.hooks.useStaticPublishHook = () => ({ ...base, targets: [docsTarget], target: "docs", preview: { ...preview,
    valid: true, validationError: null, basePath: "/docs", credentialsConfigured: true, credentialGuidance: "Must not be shown" },
    run: { status: "completed", target: "docs", startedAtIso: null, finishedAtIso: null,
      result: { ok: true, targetId: "docs", url: "https://docs.example.test", status: "ready" } },
  });
  rerender(<StaticSiteTab {...props} />);
  expect(screen.getByText("/docs").tagName).toBe("CODE");
  expect(screen.getByText("Configured").textContent).toBe("Configured");
  expect(screen.queryByText("Must not be shown")).toBeNull();
  expect(screen.getByRole("link", { name: "https://docs.example.test" }).getAttribute("href")).toBe("https://docs.example.test");
});

type CredentialBinding = Parameters<typeof bindPublishCredentials>[0];
function credentialBinding(port: CredentialBinding["deps"]["port"], credentials: AdminPublishCredentialSummary[], overrides: Partial<CredentialBinding["deps"]> = {}) {
  const snapshot = { credentials, executionMode: "hosted-api-only" };
  return bindPublishCredentials({ hooks: {
    useLocaleHook: () => "fr",
    useFetchQuery: <T,>() => ({ data: snapshot as T, status: "success" as const, error: null, isFetching: false, refetch: () => {} }),
  }, deps: {
    port, translate: ({ key }) => key, classifyCredentialSubmitError: () => ({ kind: "generic" }),
    credentialDraftError: () => null,
    translateCredentialMessage: ({ message, locale }) => `${locale}: ${message}`,
    describeApiError: ({ e }) => String(e),
    publishCredentialSaveErrorMessage: ({ error }) => `Save refused: ${error}`,
    publishCredentialsLoadErrorMessage: ({ error }) => error,
    publishCredentialSelectErrorMessage: ({ error }) => `Select refused: ${error}`,
    publishCredentialVerifyErrorMessage: ({ error }) => `Verify refused: ${error}`,
    ...overrides,
  } });
}

test("credential creation clears the submitted draft and applies the verified public account label", async () => {
  const verification = { status: "valid" as const, message: "valid", checkedAt: "2026-10-02T10:00:00Z", accountLabel: "verified-account" };
  const createCredential = vi.fn<CredentialBinding["deps"]["port"]["createCredential"]>()
    .mockResolvedValue({ ...connection, accountLabel: null, verification });
  const verifyCredential = vi.fn();
  const draftError = vi.fn<CredentialBinding["deps"]["credentialDraftError"]>(({ value }, { required }) => required && !value.trim() ? "A token is required" : null);
  const useCredentials = credentialBinding({ createCredential, verifyCredential, updateCredential: vi.fn(), listCredentials: vi.fn(), deleteCredential: vi.fn() }, [], { credentialDraftError: draftError });
  const { result } = renderHook(() => useCredentials({ targets: [archiveTarget, docsTarget] }));
  const row = () => result.current.rows?.find(candidate => candidate.providerId === "docs");
  expect(result.current.rows?.map(candidate => candidate.providerId)).toEqual(["docs"]);
  await act(() => result.current.verify("docs"));
  expect(verifyCredential).not.toHaveBeenCalled();
  await act(() => result.current.save("docs"));
  expect(row()?.error).toBe("A token is required");
  expect(createCredential).not.toHaveBeenCalled();
  act(() => result.current.setField({ providerId: "docs", fieldName: "token", value: "entered-token" }));
  expect(row()?.error).toBeNull();
  await act(() => result.current.save("docs"));
  expect(createCredential).toHaveBeenCalledExactlyOnceWith({ label: "default", connection: { providerId: "docs", token: "entered-token" } });
  expect(row()?.saved).toEqual({ ...connection, accountLabel: "verified-account" });
  expect(row()?.verification).toEqual(verification);
  expect(row()?.values).toEqual({});
  expect(result.current.credentialsForProvider("docs")).toEqual([{ ...connection, accountLabel: "verified-account" }]);
});

test.each([
  [{ kind: "duplicate-label" }, "This connection was already saved — reload the page and try again."],
  [{ kind: "validation", detail: "unsupported token" }, "Save refused: fr: unsupported token"],
  [{ kind: "generic" }, "Save refused: Error: backend unavailable"],
] as const)("credential save reports %j without discarding the typed draft", async (classification, expected) => {
  const createCredential = vi.fn<CredentialBinding["deps"]["port"]["createCredential"]>()
    .mockRejectedValueOnce(new Error("backend unavailable")).mockResolvedValueOnce(connection);
  const useCredentials = credentialBinding({ createCredential, updateCredential: vi.fn(), verifyCredential: vi.fn(), listCredentials: vi.fn(), deleteCredential: vi.fn() }, [], {
    classifyCredentialSubmitError: () => classification,
  });
  const { result } = renderHook(() => useCredentials({ targets: [docsTarget] }));
  act(() => result.current.setField({ providerId: "docs", fieldName: "token", value: "entered-token" }));
  await act(() => result.current.save("docs"));
  expect(result.current.rows?.[0]?.error).toBe(expected);
  expect(result.current.rows?.[0]?.values).toEqual({ token: "entered-token" });
  expect(result.current.rows?.[0]?.saved).toBeUndefined();
  expect(result.current.credentialChangePending).toBe(false);
  await act(() => result.current.save("docs"));
  expect(result.current.rows?.[0]?.saved?.id).toBe("docs-key");
  const input = { label: "default", connection: { providerId: "docs", token: "entered-token" } };
  expect(createCredential.mock.calls).toEqual([[input], [input]]);
});

test("credential promotion keeps the old selection on failure and honors the reconciled server list on retry", async () => {
  const other = { ...connection, id: "other-key", label: "Second key", isDefault: false };
  const updateCredential = vi.fn<CredentialBinding["deps"]["port"]["updateCredential"]>()
    .mockRejectedValueOnce(new Error("locked")).mockResolvedValueOnce({ ...other, isDefault: true });
  const refreshed = [{ ...connection, isDefault: false }, { ...other, isDefault: true, accountLabel: "fresh account" }];
  const listCredentials = vi.fn<CredentialBinding["deps"]["port"]["listCredentials"]>()
    .mockResolvedValue({ credentials: refreshed, executionMode: "hosted-api-only" });
  const useCredentials = credentialBinding({ listCredentials, updateCredential, createCredential: vi.fn(), deleteCredential: vi.fn(), verifyCredential: vi.fn() }, [connection, other]);
  const { result } = renderHook(() => useCredentials({ targets: [docsTarget] }));
  await act(() => result.current.selectCredential({ providerId: "docs", credentialId: "docs-key" }));
  expect(updateCredential).not.toHaveBeenCalled();
  const select = () => result.current.selectCredential({ providerId: "docs", credentialId: "other-key" });
  await act(select);
  expect(result.current.rows?.[0]?.selectError).toBe("Select refused: Error: locked");
  expect(result.current.rows?.[0]?.saved).toEqual(connection);
  expect(listCredentials).not.toHaveBeenCalled();
  await act(select);
  expect(result.current.rows?.[0]?.selectError).toBeNull();
  expect(result.current.rows?.[0]?.saved?.accountLabel).toBe("fresh account");
  expect(result.current.credentialsForProvider("docs")).toEqual(refreshed);
  expect(listCredentials).toHaveBeenCalledExactlyOnceWith();
  expect(updateCredential.mock.calls).toEqual(Array.from({ length: 2 }, () => [{ id: "other-key", input: { isDefault: true } }]));
});

test("credential verification failure retains the stored label and a later unreachable verdict clears the request error", async () => {
  const unreachable = { status: "unreachable" as const, message: "HTTP timeout", checkedAt: "2026-10-02T10:00:00Z" };
  const verifyCredential = vi.fn<CredentialBinding["deps"]["port"]["verifyCredential"]>()
    .mockRejectedValueOnce(new Error("verification route down")).mockResolvedValueOnce(unreachable);
  const useCredentials = credentialBinding({ verifyCredential, listCredentials: vi.fn(), updateCredential: vi.fn(), createCredential: vi.fn(), deleteCredential: vi.fn() }, [connection]);
  const { result } = renderHook(() => useCredentials({ targets: [docsTarget] }));
  await act(() => result.current.verify("docs"));
  expect(result.current.rows?.[0]).toMatchObject({ saved: connection, verifying: false, verifyError: "Verify refused: Error: verification route down" });
  await act(() => result.current.verify("docs"));
  expect(result.current.rows?.[0]).toMatchObject({ saved: connection, verifying: false, verification: unreachable, verifyError: null });
  expect(verifyCredential.mock.calls).toEqual([[{ id: "docs-key" }], [{ id: "docs-key" }]]);
});

test("late poll settlements after unmount do not schedule more export or publish work", async () => {
  vi.useFakeTimers();
  let resolveExport!: (run: ExportRunSnapshot) => void;
  let rejectPublish!: (error: Error) => void;
  const getSiteExportStatus = vi.fn<Parameters<typeof binding>[0]["getSiteExportStatus"]>(() =>
    new Promise(resolve => { resolveExport = resolve; }));
  const getPublishStatus = vi.fn<Parameters<typeof publishBinding>[0]["getPublishStatus"]>(() =>
    new Promise((_resolve, reject) => { rejectPublish = reject; }));
  const useExport = binding({ getSiteExportStatus, triggerSiteExport: async () => running });
  const usePublish = publishBinding({ getPublishStatus, listPublishTargets: vi.fn(), getPublishPreview: vi.fn(),
    triggerPublish: async () => ({ status: "running", target: "first", startedAtIso: null, finishedAtIso: null }),
  });
  const mounted = renderHook(() => ({ export: useExport({}), publish: usePublish({}) }));
  await act(async () => { await mounted.result.current.export.trigger(); await mounted.result.current.publish.publish(); });
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(getSiteExportStatus).toHaveBeenCalledExactlyOnceWith();
  expect(getPublishStatus).toHaveBeenCalledExactlyOnceWith();
  mounted.unmount();
  await act(async () => { resolveExport(running); rejectPublish(new Error("poll offline")); });
  expect(vi.getTimerCount()).toBe(0);
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(getSiteExportStatus).toHaveBeenCalledTimes(1);
  expect(getPublishStatus).toHaveBeenCalledTimes(1);
});

const useInitialRead: FetchQueryAdapter["useFetchQuery"] = <T,>({ fetch, key }: { fetch: () => Promise<T>; key: readonly unknown[] }) => {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    void fetch().then(value => { if (active) setData(value); }, failure => {
      if (active) setError(failure instanceof Error ? failure : new Error(String(failure)));
    });
    return () => { active = false; };
  }, [key[0], key[1]]);
  const status = error ? "error" : data === undefined ? "loading" : "success";
  return { data, error, status, isFetching: status === "loading", refetch: () => {} };
};

test("the bound publish hook loads targets and status, and exposes its locale's translator", async () => {
  const listPublishTargets = vi.fn(async () => [docsTarget]);
  const getPublishStatus = vi.fn(async () => ({ status: "idle" as const, target: null, startedAtIso: null, finishedAtIso: null }));
  const getPublishPreview = vi.fn();
  const usePublish = publishBinding({ listPublishTargets, getPublishStatus, triggerPublish: vi.fn(), getPublishPreview },
    { useFetchQuery: useInitialRead, useLocaleHook: () => "fr" });
  const { result } = renderHook(() => usePublish({}));
  expect(result.current.targets).toBeUndefined();
  await act(() => result.current.checkPreview());
  expect(getPublishPreview).not.toHaveBeenCalled();
  expect(result.current.target).toBe("docs");
  expect(result.current.selectedTarget).toEqual(docsTarget);
  expect(result.current.run).toEqual({ status: "idle", target: null, startedAtIso: null, finishedAtIso: null });
  expect(listPublishTargets).toHaveBeenCalledExactlyOnceWith();
  expect(getPublishStatus).toHaveBeenCalledExactlyOnceWith();
  expect(result.current.t("Preview")).toBe("fr/Preview");
});

test("a credential load failure is not presented as an empty list of saved keys", async () => {
  const listCredentials = vi.fn(async () => { throw new Error("credentials unavailable"); });
  const useCredentials = bindPublishCredentials({ hooks: { useFetchQuery: useInitialRead, useLocaleHook: () => "fr" },
    deps: {
      port: { listCredentials, createCredential: vi.fn(), updateCredential: vi.fn(), deleteCredential: vi.fn(), verifyCredential: vi.fn() },
      translate: ({ locale, key }) => `${locale}/${key}`, classifyCredentialSubmitError: () => ({ kind: "generic" }),
      credentialDraftError: () => null, translateCredentialMessage: ({ message }) => message, describeApiError: ({ e }) => String(e),
      publishCredentialSaveErrorMessage: ({ error }) => error, publishCredentialsLoadErrorMessage: ({ locale, error }) => `${locale} load: ${error}`,
      publishCredentialSelectErrorMessage: ({ error }) => error, publishCredentialVerifyErrorMessage: ({ error }) => error,
    },
  });
  const mounted = renderHook(() => useCredentials({ targets: [docsTarget] }));
  await act(async () => {});
  expect(listCredentials).toHaveBeenCalledExactlyOnceWith();
  expect(mounted.result.current.loadError).toBe("fr load: Error: credentials unavailable");
  expect(mounted.result.current.rows).toBeUndefined();
  expect(mounted.result.current.executionMode).toBeUndefined();
  expect(mounted.result.current.t("Connect")).toBe("fr/Connect");
});
