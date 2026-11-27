// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { act, cleanup, renderHook, screen, within } from "@testing-library/react";
import { createRef, useState, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import { SkillInstallConfirmation } from "../SkillInstallConfirmation.js";
import { SkillRemoveConfirmDialog } from "../SkillRemoveConfirmDialog.js";
import { AdminApiError } from "@jini-ai/core/admin-runtime";
import { ADMIN_COMMON_I18N } from "../../../core/i18n-common.js";
import { SKILLS_PAGE_DICT } from "../skills-page-dictionary.js";
import { skillFailure } from "../skill-failure.js";
import { Skills } from "../Skills.js";
import { useSkillsTranslator } from "../Skills.hooks.js";
import { useSkillsTabs } from "../use-skills-tabs.hooks.js";
import { useSkillConfirmation, useSkillInstallConfirmation } from "../use-skill-confirmation.hooks.js";
import { SkillRow } from "../SkillRow.js";
import type { SkillFailureHost, SkillInstallView, SkillRowView, SkillsScreenClassNames, SkillsScreenComponents, SkillsScreenController, SkillsScreenHooks } from "../skills-screen.types.js";

afterEach(cleanup);

const KEYS = [
  "dialogBackdrop", "dialog", "noticeError", "editorActions", "buttonPrimary", "buttonSecondary", "buttonDanger",
  "row", "rowMain", "rowSummary", "rowGlyph", "rowText", "rowHeading", "rowName", "rowDesc", "iconButton", "rowActions",
  "state", "switch", "switchKnob", "rowDetail", "detailDescription",
  "page", "section", "notice", "card", "emptyState", "pageDescription", "rows", "fieldHint",
] as const;
const CLASS_NAMES = Object.fromEntries(KEYS.map(key => [key, `host-${key}`])) as Record<(typeof KEYS)[number], string> satisfies SkillsScreenClassNames;
const confirmation = { dialogRef: createRef<HTMLDivElement>(), onDialogClick: () => {} };
const skill = { toolId: "skill-1", name: "Writer", description: "Writes copy.", enabled: true } as SkillRowView["skill"];
const PlainTextBlocks = ({ text, className }: { text: string | null | undefined; className?: string }): ReactNode => <div className={className}>{text}</div>;

/** Every class the screen renders is either its own `jini-*` class or one the host bound. */
function expectOnlyBoundClasses(container: HTMLElement) {
  const bound = new Set(Object.values(CLASS_NAMES));
  const classes = [...container.querySelectorAll("[class]")].flatMap(element => [...element.classList]);
  expect(classes.length).toBeGreaterThan(0);
  expect(classes.filter(name => !name.startsWith("jini-") && !bound.has(name))).toEqual([]);
}

it("renders a skill row's shared jini-plugin-row look only through the host's bound class names", () => {
  const row: SkillRowView = { skill, busy: false, expanded: false, detailId: "d1", onToggleExpanded() {}, onToggleEnabled() {}, onRemove() {}, onInspect() {} };
  const view = renderWithAdminKit(<ul><SkillRow row={row} PlainTextBlocks={PlainTextBlocks} classNames={CLASS_NAMES} /></ul>);
  expect(view.container.querySelector("li")?.className).toBe("host-row");
  expect(view.getByRole("switch").className).toBe("host-switch");
  expect(view.getByRole("button", { name: "Show or hide details — Writer" }).className).toBe("host-iconButton jini-skills-row-expander");
  expect(view.container.querySelector("#d1 > div")?.className).toBe("host-detailDescription");
  expectOnlyBoundClasses(view.container);
});

it("renders the remove dialog's backdrop, dialog, error and buttons through the bound class names", () => {
  const controller = { removing: skill, busy: false, failure: null, error: "Could not change skills.", confirmation, onCancelRemove() {}, onConfirmRemove() {} } as unknown as SkillsScreenController;
  const view = renderWithAdminKit(<SkillRemoveConfirmDialog controller={controller} classNames={CLASS_NAMES} />);
  expect(view.getByRole("dialog").className).toBe("host-dialog jini-skills-confirm-dialog");
  expect(view.getByRole("alert").className).toBe("host-noticeError");
  expect(view.getByRole("button", { name: "Confirm remove" }).className).toBe("host-buttonDanger");
  expect(view.getByRole("button", { name: "Cancel" }).className).toBe("host-buttonSecondary");
  expectOnlyBoundClasses(view.container);
});

it("renders the install confirmation and its read-failure row through the bound class names", () => {
  const hooks = { useSkillInstallConfirmation: () => ({ ...confirmation, source: "GitHub", onConfirm() {} }) };
  const failureHost = { ApiError: Error, describeApiError: ({ fallback }: { fallback: string }) => fallback, redactionOptions: {} } as unknown as SkillFailureHost;
  const base = { busy: false, error: null, cancel() {}, confirm() {} };
  const pending = { ...base, pending: { files: [] } } as unknown as SkillInstallView;
  const view = renderWithAdminKit(<SkillInstallConfirmation install={pending} hooks={hooks} failureHost={failureHost} classNames={CLASS_NAMES} />);
  expect(view.getByRole("dialog").className).toBe("host-dialog jini-skills-confirm-dialog");
  expect(view.getByRole("button", { name: "Confirm install" }).className).toBe("host-buttonPrimary");
  expectOnlyBoundClasses(view.container);
  view.unmount();
  const failed = { ...base, pending: null, error: "SKILL.md is missing." } as SkillInstallView;
  const row = renderWithAdminKit(<SkillInstallConfirmation install={failed} hooks={hooks} failureHost={failureHost} classNames={CLASS_NAMES} />);
  expect(row.container.firstElementChild?.className).toBe("host-noticeError jini-skills-install-error");
  expect(row.getByRole("button", { name: "Dismiss" }).className).toBe("host-buttonSecondary");
  expectOnlyBoundClasses(row.container);
});

const realSkill = { toolId: "skill-writer", name: "Writer", description: "Writes copy.", enabled: false, source: "uploaded" } as const;
type FilePreview = { name: string; onClose: () => void };
const components: SkillsScreenComponents<FilePreview> = {
  PlainTextBlocks,
  InstallTabCard: ({ titleId, title, children }) => <section aria-labelledby={titleId}><h2 id={titleId}>{title}</h2>{children}</section>,
  InstallTabOption: ({ children }) => <div>{children}</div>,
  InstallTabFieldRow: ({ inputId, label, value, onChange, onSubmit, action }) => <form onSubmit={onSubmit}>
    <label htmlFor={inputId}>{label}</label><input id={inputId} value={value} onChange={onChange} />
    <button type="submit" disabled={action?.disabled}>{action?.label}</button>
  </form>,
  PackageFilesModal: ({ name, onClose }) => <div role="dialog" aria-label={`Files for ${name}`}><button type="button" onClick={onClose}>Close files</button></div>,
};
const failureHost: SkillFailureHost = { ApiError: Error, describeApiError: ({ fallback }) => fallback, redactionOptions: {} };

function skillsHarness(initial: "loading" | "empty" | "installed", overrides: Partial<Pick<SkillsScreenController, "failure" | "addBusy">> = {}) {
  const confirmInstall = vi.fn();
  const proposeGithub = vi.fn();
  const upload = vi.fn();
  const chooseFiles = vi.fn();
  const chooseFolder = vi.fn();
  const hooks: SkillsScreenHooks<FilePreview> = {
    useLocale: () => "en",
    useAdminThemeBoundary: () => ({ "data-theme": "night" }),
    useSkillsTranslator,
    useSkillInstallConfirmation,
    useSkillFilesModal: ({ skill: inspected, onClose }) => inspected ? { name: inspected.name, onClose } : null,
    useSkills: () => {
      const [tab, setTab] = useState("skills");
      const [enabled, setEnabled] = useState(false);
      const [removed, setRemoved] = useState(false);
      const [removing, setRemoving] = useState(false);
      const [expanded, setExpanded] = useState(false);
      const [inspecting, setInspecting] = useState(false);
      const [githubUrl, setGithubUrl] = useState("");
      const [pending, setPending] = useState<SkillInstallView["pending"]>(null);
      const current = { ...realSkill, enabled };
      const onCancelRemove = () => setRemoving(false);
      const confirmRemove = useSkillConfirmation({ active: removing, onCancel: onCancelRemove });
      return {
        activeTabId: tab, onTabChange: setTab, onShowAdd: () => setTab("add"),
        loading: initial === "loading", empty: initial === "empty" || removed,
        rows: initial === "installed" && !removed ? [{
          skill: current, busy: false, expanded, detailId: "writer-details",
          sourceUrl: "https://github.com/example/writer", shortCommit: "d34db33",
          onToggleExpanded: () => setExpanded(value => !value), onToggleEnabled: () => setEnabled(value => !value),
          onRemove: () => setRemoving(true), onInspect: () => setInspecting(true),
        }] : [],
        githubUrl, githubDisabled: !githubUrl, addBusy: false, busy: false,
        onGithubUrlChange: event => setGithubUrl(event.target.value),
        onSubmitGithub: event => { event.preventDefault(); proposeGithub(githubUrl); setPending({ githubUrl }); },
        onChooseFiles: () => chooseFiles(), onChooseFolder: () => chooseFolder(),
        onFilesChange: event => upload(Array.from(event.target.files ?? [])),
        filesInput: createRef<HTMLInputElement>(), folderInput: createRef<HTMLInputElement>(),
        failure: null, error: null, removing: removing ? current : null, inspecting: inspecting ? current : null,
        onCloseFiles: () => setInspecting(false), onCancelRemove,
        onConfirmRemove: () => { setRemoved(true); setRemoving(false); },
        confirmation: confirmRemove,
        ...overrides,
        install: { pending, busy: false, error: null, cancel: () => setPending(null), confirm: () => { confirmInstall(pending); setPending(null); } },
      };
    },
  };
  return { ui: <Skills components={components} hooks={hooks} classNames={CLASS_NAMES} failureHost={failureHost} />, confirmInstall, proposeGithub, chooseFiles, chooseFolder, upload };
}

it("selects the add panel from the empty state and delivers a GitHub proposal only on confirmation", async () => {
  const user = userEvent.setup();
  const h = skillsHarness("empty");
  renderWithAdminKit(h.ui);
  expect(screen.getByRole("region", { name: "Skills" })).toHaveAttribute("data-theme", "night");
  expect(screen.getByRole("status")).toHaveTextContent("No skills installed yet");
  await user.click(screen.getByRole("button", { name: "Add a skill" }));
  expect(screen.getByRole("tab", { name: "Add a skill", selected: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "Add from GitHub" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Upload files" }));
  await user.click(screen.getByRole("button", { name: "Upload folder" }));
  expect(h.chooseFiles.mock.calls).toEqual([[]]);
  expect(h.chooseFolder.mock.calls).toEqual([[]]);
  const doc = new File(["instructions"], "SKILL.md", { type: "text/markdown" });
  await user.upload(screen.getByLabelText("Choose skill files"), doc);
  expect(h.upload.mock.calls).toEqual([[[doc]]]);

  const url = "https://github.com/example/publish-checklist";
  await user.type(screen.getByRole("textbox", { name: "GitHub URL" }), url);
  await user.click(screen.getByRole("button", { name: "Add from GitHub" }));
  expect(h.proposeGithub.mock.calls).toEqual([[url]]);
  const dialog = screen.getByRole("dialog", { name: "Install skill" });
  expect(within(dialog).getByText(url)).toBeVisible();
  expect(h.confirmInstall).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Confirm install" }));
  expect(h.confirmInstall.mock.calls).toEqual([[{ githubUrl: url }]]);
  expect(screen.queryByRole("dialog", { name: "Install skill" })).toBeNull();
});

it("lets the operator inspect, enable, and explicitly remove the installed skill", async () => {
  const user = userEvent.setup();
  const h = skillsHarness("installed");
  renderWithAdminKit(h.ui);
  const row = within(screen.getByRole("listitem", { name: "Writer" }));
  expect(row.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/example/writer");
  expect(row.getByText("d34db33")).toBeVisible();
  const expand = row.getByRole("button", { name: "Show or hide details — Writer" });
  expect(expand).toHaveAttribute("aria-expanded", "false");
  await user.click(expand);
  expect(expand).toHaveAttribute("aria-expanded", "true");
  expect(row.getByText("Writes copy.", { selector: "div" })).toBeVisible();
  const enabled = row.getByRole("switch", { name: "Enable Writer", checked: false });
  await user.click(enabled);
  expect(row.getByRole("switch", { name: "Enable Writer", checked: true })).toBeVisible();
  await user.click(row.getByRole("button", { name: "Inspect skill files — Writer" }));
  const files = screen.getByRole("dialog", { name: "Files for Writer" });
  await user.click(within(files).getByRole("button", { name: "Close files" }));
  expect(screen.queryByRole("dialog", { name: "Files for Writer" })).toBeNull();

  await user.click(row.getByRole("button", { name: "Remove Writer" }));
  const removal = screen.getByRole("dialog", { name: "Remove skill" });
  expect(within(removal).getByRole("heading", { name: "Remove Writer?" })).toBeVisible();
  await user.click(within(removal).getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("listitem", { name: "Writer" })).toBeVisible();
  await user.click(row.getByRole("button", { name: "Remove Writer" }));
  await user.click(within(screen.getByRole("dialog", { name: "Remove skill" })).getByRole("button", { name: "Confirm remove" }));
  expect(screen.queryByRole("listitem", { name: "Writer" })).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("No skills installed yet");
});

it("announces a loading list without showing the empty-state action", () => {
  renderWithAdminKit(skillsHarness("loading").ui);
  expect(screen.getByRole("status").textContent).toBe("Loading skills…");
  expect(screen.queryByRole("button", { name: "Add a skill" })).toBeNull();
});

it("keeps translated text stable until the Skills locale changes", () => {
  const { result, rerender } = renderHook(useSkillsTranslator, { initialProps: { locale: "es" } });
  const spanish = result.current;
  expect(spanish("Skills")).toBe("Habilidades");
  rerender({ locale: "es" });
  expect(result.current).toBe(spanish);
  rerender({ locale: "fr" });
  expect(result.current("Skills")).toBe("Compétences");
  expect(spanish("Skills")).toBe("Habilidades");
});

it("loads skill tabs from the address and replaces history as navigation changes", () => {
  const previous = window.location.href;
  const previousState: unknown = window.history.state;
  try {
    window.history.replaceState(null, "", "/admin/addons/skills?tab=add");
    const startLength = window.history.length;
    const { result } = renderHook(useSkillsTabs);
    expect(result.current.activeTabId).toBe("add");
    act(() => result.current.onShowSkills());
    expect(result.current.activeTabId).toBe("skills");
    expect(window.location.search).toBe("?tab=skills");
    act(() => result.current.onShowAdd());
    expect(result.current.activeTabId).toBe("add");
    expect(window.location.search).toBe("?tab=add");
    act(() => result.current.onTabChange("invalid"));
    expect(result.current.activeTabId).toBe("skills");
    expect(window.location.pathname + window.location.search).toBe("/admin/addons/skills?tab=skills");
    expect(window.history.length).toBe(startLength);
  } finally {
    window.history.replaceState(previousState, "", previous);
  }
});

it("shows an upload source and keeps a failed confirmation available without enabling busy buttons", async () => {
  const user = userEvent.setup();
  const install: SkillInstallView = {
    pending: { files: [{ path: "SKILL.md", contentBase64: "eA==" }] }, busy: true,
    error: "Could not install skill.", cause: new Error("Temporary refusal"), cancel: vi.fn(), confirm: vi.fn(),
  };
  const hooks = { useSkillInstallConfirmation };
  const view = renderWithAdminKit(<SkillInstallConfirmation install={install} hooks={hooks} failureHost={failureHost} classNames={CLASS_NAMES} />);
  const dialog = screen.getByRole("dialog", { name: "Install skill" });
  expect(within(dialog).getByText("Uploaded skill files")).toBeVisible();
  expect(within(dialog).getByText("Could not install skill.")).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Confirm install" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  view.unmount();

  renderWithAdminKit(<SkillInstallConfirmation install={{ ...install, pending: null, busy: false }} hooks={hooks} failureHost={failureHost} classNames={CLASS_NAMES} />);
  await user.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(install.cancel).toHaveBeenCalledTimes(1);
  expect(install.confirm).not.toHaveBeenCalled();
});

it("provides every Skills page key and preserves interpolation tokens across all admin locales", () => {
  const source = SKILLS_PAGE_DICT["es"];
  if (!source) throw new Error("The Skills page is missing its reference locale");
  const keys = Object.keys(source).sort();
  expect(keys).toContain("Show or hide details — {name}");
  expect(keys).toContain("Choose a skill folder, ZIP, or SKILL.md.");
  expect(Object.keys(SKILLS_PAGE_DICT).sort()).toEqual(Object.keys(ADMIN_COMMON_I18N).filter(locale => locale !== "en").sort());
  for (const [locale, copy] of Object.entries(SKILLS_PAGE_DICT)) {
    expect(Object.keys(copy).sort(), locale).toEqual(keys);
    for (const key of keys) {
      const translated = copy[key] ?? "";
      expect(translated.trim(), `${locale}: ${key}`).not.toBe("");
      expect(translated.match(/\{\w+\}/g) ?? [], `${locale}: ${key}`).toEqual(key.match(/\{\w+\}/g) ?? []);
      for (const token of ["/sk", "SKILL.md"]) {
        if (key.includes(token)) expect(translated, `${locale}: ${key}`).toContain(token);
      }
    }
  }
});

it("discloses a string incident ID from the host error but not a malformed or foreign body", () => {
  const input = {
    ApiError: AdminApiError, message: "Could not install skill.", t: (key: string) => key,
    describeApiError: ({ fallback }: { fallback: string }) => fallback, redactionOptions: {},
  };
  const known = new AdminApiError({ message: "Save refused", status: 409 }, { body: { errorId: "case-91" } });
  const malformed = new AdminApiError({ message: "Save refused", status: 409 }, { body: { errorId: 91 } });
  const unadorned = new AdminApiError({ message: "Save refused", status: 409 });
  const foreign = Object.assign(new Error("Read failed"), { body: { errorId: "foreign-93" } });
  const approved = skillFailure({ ...input, error: known });
  expect(approved).toMatchObject({ message: "Could not install skill.", errorId: "case-91", action: "Reload skills before trying the change again." });
  expect(approved.copyText).toContain("Error ID: case-91");
  for (const error of [malformed, unadorned, foreign]) {
    const failure = skillFailure({ ...input, error });
    expect(failure.message).toBe("Could not install skill.");
    expect(failure.errorId).toBeUndefined();
    expect(failure.copyText).not.toMatch(/^Error ID:/m);
  }
});

it("prefers the structured removal error to the plain fallback and leaves a busy dialog non-actionable", async () => {
  const user = userEvent.setup();
  const onConfirmRemove = vi.fn();
  const onCancelRemove = vi.fn();
  const failure = skillFailure({
    ...failureHost, error: new Error("storage refused"), t: key => key, message: "The skill is still in use.",
  });
  const controller: SkillsScreenController = {
    activeTabId: "skills", onTabChange: () => {}, onShowAdd: () => {}, loading: false, empty: false, rows: [],
    githubUrl: "", githubDisabled: true, addBusy: false, busy: true, onGithubUrlChange: () => {}, onSubmitGithub: () => {},
    onChooseFiles: () => {}, onChooseFolder: () => {}, onFilesChange: () => {},
    filesInput: createRef<HTMLInputElement>(), folderInput: createRef<HTMLInputElement>(),
    failure, error: "Legacy generic error", removing: realSkill, inspecting: null, onCloseFiles: () => {},
    onCancelRemove, onConfirmRemove, confirmation,
    install: { pending: null, busy: false, error: null, cancel: () => {}, confirm: () => {} },
  };
  renderWithAdminKit(<SkillRemoveConfirmDialog controller={controller} classNames={CLASS_NAMES} />);
  const dialog = within(screen.getByRole("dialog", { name: "Remove skill" }));
  expect(dialog.getByRole("alert")).toHaveTextContent("The skill is still in use.");
  expect(dialog.queryByText("Legacy generic error")).toBeNull();
  const confirmButton = dialog.getByRole("button", { name: "Confirm remove" });
  expect(confirmButton).toBeDisabled();
  await user.click(confirmButton);
  expect(onConfirmRemove).not.toHaveBeenCalled();
});

it("shows the page failure while disabling both upload routes during an active install", async () => {
  const user = userEvent.setup();
  const failure = skillFailure({ ...failureHost, error: new Error("previous attempt"), message: "Could not install skill.", t: key => key });
  const h = skillsHarness("empty", { failure, addBusy: true });
  renderWithAdminKit(h.ui);
  expect(screen.getByRole("alert")).toHaveTextContent("Could not install skill.");
  await user.click(screen.getByRole("tab", { name: "Add a skill" }));
  const files = screen.getByRole("button", { name: "Upload files" });
  const folder = screen.getByRole("button", { name: "Upload folder" });
  expect(files).toBeDisabled();
  expect(folder).toBeDisabled();
  await user.click(files);
  await user.click(folder);
  expect(h.chooseFiles).not.toHaveBeenCalled();
  expect(h.chooseFolder).not.toHaveBeenCalled();
});
