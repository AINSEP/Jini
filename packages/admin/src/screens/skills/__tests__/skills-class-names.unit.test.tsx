// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, expect, it } from "vitest";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import { SkillInstallConfirmation } from "../SkillInstallConfirmation.js";
import { SkillRemoveConfirmDialog } from "../SkillRemoveConfirmDialog.js";
import { SkillRow } from "../SkillRow.js";
import type { SkillFailureHost, SkillInstallView, SkillRowView, SkillsScreenClassNames, SkillsScreenController } from "../skills-screen.types.js";

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

it("renders a skill row's shared plugin-row look only through the host's bound class names", () => {
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
