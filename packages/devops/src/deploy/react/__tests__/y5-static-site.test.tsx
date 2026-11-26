import { bindPublishCredentials } from "../hooks/use-publish-credentials.hooks.js";
import { bindStaticPublish } from "../hooks/use-static-publish.hooks.js";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { StaticSiteTab, type StaticSiteTabProps } from "../StaticSiteTab.js";
import { afterEach, expect, test, vi } from "vitest";
import { bindStaticExport } from "../hooks/use-static-export.hooks.js";
import type { ExportRunSnapshot } from "@jini-ai/core/contracts/site/export-run";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const idle: ExportRunSnapshot = { status: "idle", startedAtIso: null, finishedAtIso: null, outputDir: null };
const running: ExportRunSnapshot = { ...idle, status: "running" };
const completed: ExportRunSnapshot = { ...idle, status: "completed", ok: true };

function binding(port: Parameters<typeof bindStaticExport>[0]["deps"]["port"]) {
  return bindStaticExport({
    hooks: {
      useLocaleHook: () => "en", useContentRefreshSubscription: () => {},
      useFetchQuery: () => ({ data: undefined, error: null, status: "loading", isFetching: true, refetch: () => {} }),
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

function publishBinding(port: Parameters<typeof bindStaticPublish>[0]["deps"]["port"]) {
  const targets = [{ id: "first", label: "First", configFields: [] }, { id: "second", label: "Second", configFields: [] }];
  return bindStaticPublish({ hooks: {
    useLocaleHook: () => "en",
    useFetchQuery: <T,>({ key }: { key: readonly unknown[] }) => ({ data: (key[1] === "publish-targets" ? targets : undefined) as T | undefined, status: "success" as const, error: null, isFetching: false, refetch: () => {} }),
  }, deps: {
    port, translate: ({ key }) => key, localizePublishTargets: ({ targets }) => targets,
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
  expect(triggerPublish).toHaveBeenCalledExactlyOnceWith({ config: { target: "first", fields: {} }, projectName: "", credentialId: "selected" });
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

test("static-site view renders export refusal and progress using its required collaborators", () => {
  const trigger = vi.fn(async () => {});
  const props: StaticSiteTabProps = {
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
  render(<StaticSiteTab {...props} />);
  expect(screen.getByRole("alert").textContent).toBe("output directory is not empty");
  expect(screen.getByRole("button", { name: "Exporting…" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Host export description")).toBeTruthy();
  expect(screen.getByText("host export <dir>")).toBeTruthy();
  expect(trigger).not.toHaveBeenCalled();
});
