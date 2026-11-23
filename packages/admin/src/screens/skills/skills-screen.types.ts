import type { ChangeEvent, ComponentType, FormEvent, MouseEvent, ReactNode, RefObject } from "react";
import type { UserFacingError } from "@jini-ai/core";
import type { InstalledSkill } from "@jini-ai/core/contracts/site/installed-skill";
import type { SkillInstallPayload } from "@jini-ai/core/contracts/site/skill-install";
import type { Translate } from "@jini-ai/core/text";
import type { skillFailure } from "./skill-failure.js";

/**
 * @file The view shapes the Skills screen reads and the collaborators its host injects: the data
 * controller its `useSkills` hook returns, the pending install its install hook holds, the host's
 * shared list/install/file components, and the transport bindings `skillFailure` needs.
 */

export interface SkillRowView {
  skill: InstalledSkill;
  busy: boolean;
  sourceUrl?: string;
  shortCommit?: string;
  expanded: boolean;
  detailId: string;
  onToggleExpanded: () => void;
  onToggleEnabled: () => void;
  onRemove: () => void;
  onInspect: () => void;
}

/** The host's transport error class, its describer and its product redaction options, bound once by the host. */
export type SkillFailureHost = Omit<Parameters<typeof skillFailure>[0], "error" | "message" | "t">;

/** The fields of the host's held install (`useSkillInstall`) the confirmation reads. */
export interface SkillInstallView {
  readonly pending: SkillInstallPayload | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly cause?: unknown;
  readonly cancel: () => void;
  readonly confirm: () => Promise<unknown> | void;
}

/** Escape, contained Tab navigation and focus return for one Skills dialog. */
export interface SkillConfirmationView {
  readonly dialogRef: RefObject<HTMLDivElement | null>;
  readonly onDialogClick: (event: MouseEvent<HTMLDivElement>) => void;
}

/** The fields of the host's Skills controller (`useSkills`) the screen, its panels and the remove dialog read. */
export interface SkillsScreenController {
  readonly activeTabId: string; readonly onTabChange: (tabId: string) => void; readonly onShowAdd: () => void;
  readonly loading: boolean; readonly empty: boolean; readonly rows: readonly SkillRowView[];
  readonly githubUrl: string; readonly githubDisabled: boolean; readonly addBusy: boolean; readonly busy: boolean;
  readonly onGithubUrlChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onSubmitGithub: (event: FormEvent<HTMLFormElement>) => void;
  readonly onChooseFiles: () => void; readonly onChooseFolder: () => void;
  readonly onFilesChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly filesInput: RefObject<HTMLInputElement | null>; readonly folderInput: RefObject<HTMLInputElement | null>;
  readonly failure: UserFacingError | null; readonly error: string | null;
  readonly removing: InstalledSkill | null; readonly inspecting: InstalledSkill | null; readonly onCloseFiles: () => void;
  readonly onCancelRemove: () => void; readonly onConfirmRemove: () => unknown;
  readonly confirmation: SkillConfirmationView; readonly install: SkillInstallView;
}

/** The install confirmation's dialog behavior, bound by the host to `useSkillInstallConfirmation`. */
export interface SkillInstallConfirmationHooks {
  useSkillInstallConfirmation(install: SkillInstallView): SkillConfirmationView & { readonly source: string; readonly onConfirm: () => void };
}

/** Every hook the Skills screen calls; the host binds its data, locale and theme hooks. */
export interface SkillsScreenHooks<TFilesModal extends object> extends SkillInstallConfirmationHooks {
  useSkills(required: { t: Translate }): SkillsScreenController;
  useLocale(): string;
  useAdminThemeBoundary(required: object, optional: object): Readonly<Record<`data-${string}`, string | undefined>>;
  useSkillsTranslator(required: { locale: string }): Translate;
  useSkillFilesModal(required: { skill: InstalledSkill | null; onClose: () => void }, optional: { t: Translate }): TFilesModal | null;
}

/** The props of the host's shared install-tab text field row the add panel reads. */
export interface SkillsInstallFieldRowProps {
  inputId: string; label?: string; value?: string; placeholder?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void; onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  action?: { label: string; disabled?: boolean; primary?: boolean };
  inputProps?: Record<string, unknown>; actionProps?: Record<string, unknown>;
}

/** The host's shared list, install-tab and package-files components the screen composes. */
export interface SkillsScreenComponents<TFilesModal extends object> {
  readonly PlainTextBlocks: ComponentType<{ text: string | null | undefined; className?: string }>;
  readonly PackageFilesModal: ComponentType<TFilesModal>;
  readonly InstallTabCard: ComponentType<{ titleId: string; title: string; children: ReactNode }>;
  readonly InstallTabOption: ComponentType<{ children?: ReactNode }>;
  readonly InstallTabFieldRow: ComponentType<SkillsInstallFieldRowProps>;
}

/** The host design-system classes the Skills dialogs (install confirmation and remove) render. */
export interface SkillDialogClassNames {
  readonly dialogBackdrop: string; readonly dialog: string; readonly noticeError: string; readonly editorActions: string;
  readonly buttonPrimary: string; readonly buttonSecondary: string; readonly buttonDanger: string;
}

/** The host design-system classes an installed-skill row renders (the shared plugin-row look). */
export interface SkillRowClassNames {
  readonly row: string; readonly rowMain: string; readonly rowSummary: string; readonly rowGlyph: string;
  readonly rowText: string; readonly rowHeading: string; readonly rowName: string; readonly rowDesc: string;
  readonly iconButton: string; readonly rowActions: string; readonly state: string; readonly switch: string;
  readonly switchKnob: string; readonly rowDetail: string; readonly detailDescription: string;
}

/**
 * Every host design-system class the Skills screen renders, bound once by the host. This package
 * emits only `jini-*` classes of its own; the shared page, card, notice, button, dialog and row
 * looks belong to the host, so their class names arrive here instead of being hard-coded.
 */
export interface SkillsScreenClassNames extends SkillDialogClassNames, SkillRowClassNames {
  readonly page: string; readonly section: string; readonly notice: string; readonly card: string;
  readonly emptyState: string; readonly pageDescription: string; readonly rows: string; readonly fieldHint: string;
}
