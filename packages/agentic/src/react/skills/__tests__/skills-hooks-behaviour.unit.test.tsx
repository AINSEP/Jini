import { act, type ChangeEvent, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { CachedLoader, FetchQueryAdapter, QueryResult } from "@jini-ai/core/fetch";
import type { UserFacingError } from "@jini-ai/core";
import type { Translate } from "@jini-ai/core/text";
import type { InstalledSkill } from "@jini-ai/core/contracts/site/installed-skill";
import type { SkillInstallPayload } from "@jini-ai/core/contracts/site/skill-install";
import type { SkillFiles } from "../api.js";
import { useSkills } from "../use-skills.hooks.js";
import { useSkillFiles, useSkillFilesModal } from "../use-skill-files.hooks.js";
import { useSkillInstall } from "../use-skill-install.hooks.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mounts one hook in a real React root and hands back its latest return value. */
async function mount<P, R>(hook: (props: P) => R, initial: P) {
  const root = createRoot(document.createElement("div"));
  let latest: { value: R } | undefined;
  function Probe({ props }: { props: P }) { latest = { value: hook(props) }; return null; }
  await act(async () => { root.render(<Probe props={initial} />); });
  return {
    current: () => { if (!latest) throw new Error("not mounted"); return latest.value; },
    rerender: async (props: P) => { await act(async () => { root.render(<Probe props={props} />); }); },
    unmount: async () => { await act(async () => { root.unmount(); }); },
  };
}

const failureOf = ({ message, error }: { error: unknown; message: string }): UserFacingError =>
  ({ message: `described: ${message}`, action: "retry", step: "skills", cause: String(error), copyText: message });

function queryResult<T>(data: T | undefined, error: Error | null = null): QueryResult<T> {
  return { data, error, status: error ? "error" : "success", isFetching: false, refetch: () => {} } as QueryResult<T>;
}

const uploaded: InstalledSkill = { toolId: "skill_notes", name: "Notes", description: "", enabled: true, source: "uploaded" };
const fromGithub: InstalledSkill = { toolId: "skill gh", name: "Gh", description: "", enabled: false, source: { githubUrl: "https://github.com/acme/skills", commit: "abcdef1234567" } };

function installStub(overrides: Partial<ReturnType<typeof useSkillInstall>> = {}): ReturnType<typeof useSkillInstall> {
  return { pending: null, busy: false, error: null, cause: null, propose: () => {}, proposeFiles: async () => {}, cancel: () => {}, confirm: async () => {}, fail: () => {}, ...overrides };
}

function skillsHarness(options: { skills?: InstalledSkill[]; queryError?: Error | null } = {}) {
  const fetches: Array<() => Promise<unknown>> = [];
  const load = vi.fn(async () => options.skills ?? []);
  const loader = { load, peek: () => undefined, replace: () => {} };
  const queryHooks: FetchQueryAdapter = {
    useFetchQuery: <T,>({ fetch }: { fetch: () => Promise<T> }) => { fetches.push(fetch); return queryResult<T>(options.skills as T | undefined, options.queryError ?? null); },
    useInvalidate: () => () => {},
    useCachedLoader: <T,>() => loader as unknown as CachedLoader<T>,
    useFetchMutation: ({ run }) => ({ mutate: run, status: "idle", error: null, reset: () => {} }),
  };
  const port = { listSkills: vi.fn(async () => options.skills ?? []), enableSkill: vi.fn(async () => {}), removeSkill: vi.fn(async () => {}) };
  const install = { propose: vi.fn(), proposeFiles: vi.fn(async () => {}) };
  let onInstalled: (() => void | Promise<void>) | undefined;
  const onShowSkills = vi.fn();
  const describeFailure = vi.fn(failureOf);
  const props = {
    port, t: (key: string) => key, queryHooks, subscribeChanged: () => () => {},
    useSkillInstallHook: (_required: Record<string, never>, optional: { onInstalled: () => void | Promise<void> }) => {
      onInstalled = optional.onInstalled;
      return installStub({ propose: install.propose, proposeFiles: install.proposeFiles });
    },
    useSkillConfirmationHook: () => ({ dialogRef: { current: null }, onDialogClick: () => {} }),
    useSkillsTabsHook: () => ({ activeTabId: "skills" as const, onTabChange: () => {}, onShowSkills, onShowAdd: () => {} }),
    describeFailure,
  };
  return { props, port, load, fetches, install, onShowSkills, describeFailure, onInstalled: () => onInstalled };
}

describe("useSkills", () => {
  it("the list read passes an Error through and wraps any other rejection with the described message and its cause", async () => {
    const harness = skillsHarness();
    await mount(useSkills, harness.props);
    const fetch = harness.fetches[0]!;
    const error = new Error("offline");
    harness.port.listSkills.mockRejectedValueOnce(error);
    await expect(fetch()).rejects.toBe(error);
    harness.port.listSkills.mockRejectedValueOnce("teapot");
    const wrapped = await fetch().then(() => null, (e: unknown) => e);
    expect(wrapped).toBeInstanceOf(Error);
    expect((wrapped as Error).message).toBe("described: Could not load skills.");
    expect((wrapped as Error).cause).toBe("teapot");
  });

  it("a read error is described as 'Could not load skills.' and the list is neither loading nor empty", async () => {
    const queryError = new Error("500");
    const harness = skillsHarness({ queryError });
    const view = await mount(useSkills, harness.props);
    expect(view.current().error).toBe("described: Could not load skills.");
    expect(harness.describeFailure).toHaveBeenLastCalledWith({ error: queryError, message: "Could not load skills.", t: harness.props.t });
    expect(view.current()).toMatchObject({ loading: false, empty: false, skills: null, rows: [] });
  });

  it("rows carry the GitHub source and short commit, expand and collapse, and open the files view", async () => {
    const harness = skillsHarness({ skills: [uploaded, fromGithub] });
    const view = await mount(useSkills, harness.props);
    const [first, second] = view.current().rows;
    expect(first).not.toHaveProperty("sourceUrl");
    expect(second).toMatchObject({ sourceUrl: "https://github.com/acme/skills", shortCommit: "abcdef1", expanded: false, detailId: "skill-detail-skill%20gh" });
    await act(async () => { second!.onToggleExpanded(); });
    expect(view.current().rows.map(row => row.expanded)).toEqual([false, true]);
    await act(async () => { view.current().rows[1]!.onToggleExpanded(); });
    expect(view.current().rows.map(row => row.expanded)).toEqual([false, false]);
    await act(async () => { view.current().rows[0]!.onInspect(); });
    expect(view.current().inspecting).toBe(uploaded);
    await act(async () => { view.current().onCloseFiles(); });
    expect(view.current().inspecting).toBeNull();
  });

  it("remove asks first, confirming removes that tool id and clears the pending row; cancel clears it without writing", async () => {
    const harness = skillsHarness({ skills: [uploaded] });
    const view = await mount(useSkills, harness.props);
    await act(async () => { view.current().rows[0]!.onRemove(); });
    expect(view.current().removing).toBe(uploaded);
    await act(async () => { view.current().onCancelRemove(); });
    expect(view.current().removing).toBeNull();
    // Confirming with nothing pending writes nothing.
    await act(async () => { view.current().onConfirmRemove(); });
    expect(harness.port.removeSkill).not.toHaveBeenCalled();
    await act(async () => { view.current().rows[0]!.onRemove(); });
    await act(async () => { view.current().onConfirmRemove(); });
    expect(harness.port.removeSkill).toHaveBeenCalledExactlyOnceWith({ toolId: "skill_notes" });
    expect(view.current().removing).toBeNull();
    expect(view.current().busy).toBe(false);
  });

  it("a rejected write surfaces 'Could not change skill.' with the write's own cause, over any read error", async () => {
    const harness = skillsHarness({ skills: [uploaded], queryError: new Error("stale read") });
    const refused = new Error("forbidden");
    harness.port.enableSkill.mockRejectedValueOnce(refused);
    const view = await mount(useSkills, harness.props);
    await act(async () => { view.current().rows[0]!.onToggleEnabled(); });
    expect(harness.port.enableSkill).toHaveBeenCalledWith({ toolId: "skill_notes", enabled: false });
    // The write is described once where it fails, then presented with its own cause (not the read error).
    expect(harness.describeFailure).toHaveBeenCalledWith({ error: refused, message: "Could not change skill.", t: harness.props.t });
    expect(harness.describeFailure).toHaveBeenLastCalledWith({ error: refused, message: "described: Could not change skill.", t: harness.props.t });
    expect(view.current().failure).toEqual(failureOf({ error: refused, message: "described: Could not change skill." }));
    expect(view.current().busy).toBe(false);
  });

  it("an accepted install reloads the list and returns to the skills tab, but not after unmount", async () => {
    const harness = skillsHarness({ skills: [] });
    const view = await mount(useSkills, harness.props);
    expect(view.current().empty).toBe(true);
    await act(async () => { await harness.onInstalled()!(); });
    expect(harness.load).toHaveBeenCalledTimes(1);
    expect(harness.onShowSkills).toHaveBeenCalledTimes(1);
    const onInstalled = harness.onInstalled()!;
    await view.unmount();
    await onInstalled();
    expect(harness.load).toHaveBeenCalledTimes(2);
    expect(harness.onShowSkills).toHaveBeenCalledTimes(1);
  });

  it("the GitHub form proposes the trimmed URL, and chosen files are proposed then cleared from the input", async () => {
    const harness = skillsHarness({ skills: [] });
    const view = await mount(useSkills, harness.props);
    expect(view.current().githubDisabled).toBe(true);
    await act(async () => { view.current().onGithubUrlChange({ target: { value: "  https://github.com/acme/skills  " } } as unknown as ChangeEvent<HTMLInputElement>); });
    expect(view.current().githubUrl).toBe("  https://github.com/acme/skills  ");
    expect(view.current().githubDisabled).toBe(false);
    const preventDefault = vi.fn();
    await act(async () => { view.current().onSubmitGithub({ preventDefault } as unknown as FormEvent<HTMLFormElement>); });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.install.propose).toHaveBeenCalledExactlyOnceWith({ githubUrl: "https://github.com/acme/skills" });
    const file = new File(["---"], "SKILL.md");
    const target = { files: [file], value: "C:\\fakepath\\SKILL.md" };
    await act(async () => { view.current().onFilesChange({ target } as unknown as ChangeEvent<HTMLInputElement>); });
    expect(harness.install.proposeFiles).toHaveBeenCalledExactlyOnceWith([file]);
    expect(target.value).toBe("");
    const empty = { files: null, value: "x" };
    await act(async () => { view.current().onFilesChange({ target: empty } as unknown as ChangeEvent<HTMLInputElement>); });
    expect(harness.install.proposeFiles).toHaveBeenLastCalledWith([]);
  });
});

describe("useSkills reload and file pickers", () => {
  it("a reload whose list read fails resolves anyway, leaving the error to the query", async () => {
    const harness = skillsHarness({ skills: [] });
    const view = await mount(useSkills, harness.props);
    harness.load.mockRejectedValueOnce(new Error("offline"));
    let settled: unknown = "pending";
    await act(async () => { settled = await view.current().reload(); });
    expect(settled).toBeUndefined();
    expect(harness.load).toHaveBeenCalledTimes(1);
    expect(view.current().error).toBeNull();
  });

  it("the choose-files and choose-folder actions open their own hidden input", async () => {
    const harness = skillsHarness({ skills: [] });
    const view = await mount(useSkills, harness.props);
    const opened: string[] = [];
    const filesInput = document.createElement("input");
    const folderInput = document.createElement("input");
    filesInput.addEventListener("click", (event) => { event.preventDefault(); opened.push("files"); });
    folderInput.addEventListener("click", (event) => { event.preventDefault(); opened.push("folder"); });
    view.current().filesInput.current = filesInput;
    view.current().folderInput.current = folderInput;
    view.current().onChooseFiles();
    view.current().onChooseFolder();
    expect(opened).toEqual(["files", "folder"]);
  });
});

type FilesProps = Parameters<typeof useSkillFiles>[0];

function filesHarness(options: { data?: SkillFiles; queryError?: Error | null; readError?: string | null } = {}) {
  const calls: Array<{ key: readonly unknown[]; fetch: () => Promise<SkillFiles>; enabled: boolean | undefined }> = [];
  const read = vi.fn(async ({ toolId }: { toolId: string }) => ({ toolId, files: [], truncated: false, limits: { maxFiles: 1, maxEntries: 1, maxFileBytes: 1, maxTotalBytes: 1 } }) as SkillFiles);
  const viewCalls: Array<{ selectedPath: string; translate: Translate; read: unknown }> = [];
  const t: Translate = key => `t(${key})`;
  const props = (toolId: string | null): FilesProps => ({
    toolId, read, t,
    useFetchQueryHook: (<T,>(required: { key: readonly unknown[]; fetch: () => Promise<T> }, optional?: { enabled?: boolean }) => {
      calls.push({ key: required.key, fetch: required.fetch as unknown as () => Promise<SkillFiles>, enabled: optional?.enabled });
      return queryResult<T>(options.data as T | undefined, options.queryError ?? null);
    }) as FilesProps["useFetchQueryHook"],
    packageFilesRead: query => query.data ? { listing: { files: query.data.files, truncated: query.data.truncated }, error: options.readError ?? null } : null,
    packageFilesViewState: ({ read: loaded, selectedPath, translate }) => {
      viewCalls.push({ selectedPath, translate, read: loaded });
      return { files: loaded?.listing?.files ?? [], selectedFile: null, status: null, listNotice: selectedPath };
    },
    describeFailure: failureOf,
  });
  return { props, read, calls, viewCalls, t };
}

const listing: SkillFiles = {
  toolId: "skill_notes", truncated: false, limits: { maxFiles: 1, maxEntries: 1, maxFileBytes: 1, maxTotalBytes: 1 },
  files: [{ relativePath: "SKILL.md", sizeBytes: 3, content: "---", omitted: null }, { relativePath: "references/a.md", sizeBytes: 1, content: "a", omitted: null }],
};

describe("useSkillFiles", () => {
  it("with no skill selected the query is disabled and its fetch refuses to run", async () => {
    const harness = filesHarness();
    const view = await mount(useSkillFiles, harness.props(null));
    const call = harness.calls.at(-1)!;
    expect(call.key).toEqual(["skills", "files", ""]);
    expect(call.enabled).toBe(false);
    await expect(call.fetch()).rejects.toThrow("skill files have no selected skill id");
    expect(harness.read).not.toHaveBeenCalled();
    expect(view.current().failure).toBeNull();
  });

  it("reads the selected skill, keeps an Error, and wraps a non-Error rejection with its cause", async () => {
    const harness = filesHarness();
    await mount(useSkillFiles, harness.props("skill_notes"));
    const call = harness.calls.at(-1)!;
    expect(call.key).toEqual(["skills", "files", "skill_notes"]);
    expect(call.enabled).toBe(true);
    expect((await call.fetch()).toolId).toBe("skill_notes");
    expect(harness.read).toHaveBeenCalledWith({ toolId: "skill_notes" });
    const error = new Error("gone");
    harness.read.mockRejectedValueOnce(error);
    await expect(call.fetch()).rejects.toBe(error);
    harness.read.mockRejectedValueOnce(404);
    const wrapped = await call.fetch().then(() => null, (e: unknown) => e) as Error;
    expect(wrapped.message).toBe("Could not load skill files.");
    expect(wrapped.cause).toBe(404);
  });

  it("selects a listed file, falls back to SKILL.md for an unlisted one or another skill, and renames the plugin copy", async () => {
    const harness = filesHarness({ data: listing });
    const view = await mount(useSkillFiles, harness.props("skill_notes"));
    expect(view.current().listNotice).toBe("SKILL.md");
    await act(async () => { view.current().selectFile({ path: "references/a.md" }); });
    expect(view.current().listNotice).toBe("references/a.md");
    await act(async () => { view.current().selectFile({ path: "missing.md" }); });
    expect(view.current().listNotice).toBe("SKILL.md");
    await act(async () => { view.current().selectFile({ path: "references/a.md" }); });
    await view.rerender(harness.props("skill_other"));
    expect(view.current().listNotice).toBe("SKILL.md");
    const copy = view.current().t;
    expect(copy("Loading package files…")).toBe("t(Loading skill files…)");
    expect(copy("No files to show for this plugin.")).toBe("t(No files to show for this skill.)");
    expect(copy("Close")).toBe("t(Close)");
    expect(harness.viewCalls.at(-1)!.translate).toBe(copy);
  });

  it("translates the read's own error and describes a query failure", async () => {
    const queryError = new Error("denied");
    const harness = filesHarness({ data: listing, queryError, readError: "Too many files." });
    const view = await mount(useSkillFiles, harness.props("skill_notes"));
    expect(harness.viewCalls.at(-1)!.read).toMatchObject({ error: "t(Too many files.)" });
    expect(view.current().failure).toEqual(failureOf({ error: queryError, message: "Could not load skill files." }));
  });
});

describe("useSkillFilesModal", () => {
  const Notice = () => null;
  function modalProps(skill: InstalledSkill | null, failure: UserFacingError | null) {
    const selectFile = vi.fn();
    const seen: Array<{ toolId: string | null }> = [];
    const onClose = vi.fn();
    return {
      selectFile, seen, onClose,
      props: {
        skill, onClose, read: async () => listing, FailureNotice: Notice,
        useSkillFilesHook: ({ toolId }: { toolId: string | null }) => {
          seen.push({ toolId });
          return { files: listing.files, selectedFile: null, status: null, listNotice: null, failure, selectFile, t: (key: string) => key };
        },
      },
    };
  }

  it("is null with no skill, but still drives the files hook with a null id", async () => {
    const harness = modalProps(null, null);
    const view = await mount((p: typeof harness.props) => useSkillFilesModal(p), harness.props);
    expect(view.current()).toBeNull();
    expect(harness.seen.at(-1)).toEqual({ toolId: null });
  });

  it("titles the modal with the literal skill name, forwards selection, and shows a failure notice only on failure", async () => {
    const named = { ...uploaded, name: "Cost $& Co" };
    const failure = failureOf({ error: "x", message: "Could not load skill files." });
    const harness = modalProps(named, failure);
    const view = await mount((p: typeof harness.props) => useSkillFilesModal(p, { t: key => `[${key}]` }), harness.props);
    const modal = view.current()!;
    expect(modal.title).toBe("[Cost $& Co skill files]");
    expect(modal.subtitle).toBe("[Read-only view of this skill's files; nothing runs from this screen.]");
    expect(modal.headerExtras).toMatchObject({ type: Notice, props: { failure } });
    expect(modal).toMatchObject({ handlePrefix: "skill-file", onClose: harness.onClose, files: listing.files });
    modal.onSelectFile("references/a.md");
    expect(harness.selectFile).toHaveBeenCalledWith({ path: "references/a.md" });
    expect(harness.seen.at(-1)).toEqual({ toolId: "skill_notes" });

    const healthy = modalProps(named, null);
    const quiet = await mount((p: typeof healthy.props) => useSkillFilesModal(p), healthy.props);
    expect(quiet.current()).not.toHaveProperty("headerExtras");
    expect(quiet.current()!.title).toBe("Cost $& Co skill files");
  });
});

describe("useSkillInstall failures", () => {
  it("a failed upload read describes 'Could not read skill.', forwards the paths, and keeps the cause", async () => {
    const unreadable = new Error("zip broken");
    const prepareSkillUpload = vi.fn(async () => { throw unreadable; });
    const describeFailure = vi.fn(failureOf);
    const view = await mount(useSkillInstall, { installSkill: async () => {}, prepareSkillUpload, describeFailure });
    const file = new File(["x"], "skill.zip");
    await act(async () => { await view.current().proposeFiles([file], ["skills/skill.zip"]); });
    expect(prepareSkillUpload).toHaveBeenCalledWith({ files: [file] }, { paths: ["skills/skill.zip"] });
    expect(view.current()).toMatchObject({ error: "described: Could not read skill.", cause: unreadable, pending: null });
  });

  it("a failed install keeps the proposal, describes 'Could not install skill.', and unlocks for a retry", async () => {
    const refused = new Error("conflict");
    const installSkill = vi.fn(async (_payload: SkillInstallPayload) => { throw refused; });
    const onInstalled = vi.fn();
    const view = await mount((p: Parameters<typeof useSkillInstall>[0]) => useSkillInstall(p, { onInstalled }), { installSkill, prepareSkillUpload: async () => ({ githubUrl: "u" }), describeFailure: failureOf });
    await act(async () => { view.current().propose({ githubUrl: "https://github.com/acme/skills" }); });
    await act(async () => { await view.current().confirm(); });
    expect(view.current()).toMatchObject({ error: "described: Could not install skill.", cause: refused, busy: false, pending: { githubUrl: "https://github.com/acme/skills" } });
    expect(onInstalled).not.toHaveBeenCalled();
    await act(async () => { await view.current().confirm(); });
    expect(installSkill).toHaveBeenCalledTimes(2);
  });

  it("cancel drops the proposal and error; fail records a message as both error and cause; confirm without a proposal does nothing", async () => {
    const installSkill = vi.fn(async () => {});
    const view = await mount(useSkillInstall, { installSkill, prepareSkillUpload: async () => ({ githubUrl: "u" }), describeFailure: failureOf });
    await act(async () => { await view.current().confirm(); });
    expect(installSkill).not.toHaveBeenCalled();
    await act(async () => { view.current().fail("Too big."); });
    expect(view.current()).toMatchObject({ error: "Too big.", cause: "Too big." });
    await act(async () => { view.current().propose({ githubUrl: "https://github.com/acme/skills" }); });
    expect(view.current().error).toBeNull();
    await act(async () => { view.current().cancel(); });
    expect(view.current()).toMatchObject({ pending: null, error: null });
  });

  it("hands describeFailure an untranslated message for both the read and the install failure", async () => {
    const translated: string[] = [];
    const describeFailure = ({ message, error, t }: { error: unknown; message: string; t: Translate }): UserFacingError => {
      const text = t(message);
      translated.push(text);
      return failureOf({ message: text, error });
    };
    const view = await mount(useSkillInstall, { installSkill: async () => { throw new Error("conflict"); }, prepareSkillUpload: async () => { throw new Error("zip broken"); }, describeFailure });
    await act(async () => { await view.current().proposeFiles([new File(["x"], "skill.zip")]); });
    await act(async () => { view.current().propose({ githubUrl: "https://github.com/acme/skills" }); });
    await act(async () => { await view.current().confirm(); });
    expect(translated).toEqual(["Could not read skill.", "Could not install skill."]);
  });

  it("a confirmed install with no onInstalled callback clears the proposal without an error", async () => {
    const installSkill = vi.fn(async (_payload: SkillInstallPayload) => {});
    const view = await mount(useSkillInstall, { installSkill, prepareSkillUpload: async () => ({ githubUrl: "u" }), describeFailure: failureOf });
    await act(async () => { view.current().propose({ githubUrl: "https://github.com/acme/skills" }); });
    await act(async () => { await view.current().confirm(); });
    expect(installSkill).toHaveBeenCalledExactlyOnceWith({ githubUrl: "https://github.com/acme/skills" });
    expect(view.current()).toMatchObject({ pending: null, error: null, busy: false });
  });

  it("a confirmed install stays busy until onInstalled has settled, then clears the proposal", async () => {
    let finish: () => void = () => {};
    const onInstalled = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const view = await mount((p: Parameters<typeof useSkillInstall>[0]) => useSkillInstall(p, { onInstalled }), { installSkill: async () => {}, prepareSkillUpload: async () => ({ githubUrl: "u" }), describeFailure: failureOf });
    await act(async () => { view.current().propose({ githubUrl: "https://github.com/acme/skills" }); });
    let confirmed: Promise<void> = Promise.resolve();
    await act(async () => { confirmed = view.current().confirm(); });
    expect(onInstalled).toHaveBeenCalledTimes(1);
    expect(view.current()).toMatchObject({ busy: true, pending: null });
    await act(async () => { finish(); await confirmed; });
    expect(view.current()).toMatchObject({ busy: false, pending: null, error: null });
  });
});

