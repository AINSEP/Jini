import { useCallback as useQueryFetchCallback } from "react";
import { createElement, useState, type ComponentType } from "react";
import type { FetchQueryAdapter, QueryResult } from "@jini-ai/core/fetch";
import type { UserFacingError } from "@jini-ai/core";
import type { SkillFiles } from "./api.js";
import type { InstalledSkill } from "@jini-ai/core/contracts/site/installed-skill";
import { type Translate } from '@jini-ai/core/text';
interface SkillFilesDependencies {
  readonly toolId: string | null;
  readonly read: (required: { toolId: string }, optional?: Record<string, never>) => Promise<SkillFiles>;
  readonly t: Translate;
  readonly useFetchQueryHook: FetchQueryAdapter["useFetchQuery"];
  readonly packageFilesRead: (query: QueryResult<SkillFiles>) => { listing: Pick<SkillFiles, "files" | "truncated"> | null; error: string | null } | null;
  readonly packageFilesViewState: (required: { read: ReturnType<SkillFilesDependencies["packageFilesRead"]>; selectedPath: string; translate: Translate }) => {
    files: readonly { relativePath: string; content: string | null; unavailableReason?: string | null }[];
    selectedFile: { relativePath: string; content: string | null; unavailableReason?: string | null } | null;
    status: { text: string; role: "status" | "alert" } | null;
    listNotice: string | null;
  };
  readonly describeFailure: (required: { error: unknown; message: string; t: Translate }, optional?: Record<string, never>) => UserFacingError;
}

const identity: Translate = key => key;

/** A missing or removed selection returns to the skill instructions instead of showing stale bytes. */
function skillSelectedPath({ loaded, selectedPath }: { loaded: ReturnType<SkillFilesDependencies["packageFilesRead"]>; selectedPath: string }): string {
  return loaded?.listing?.files.some(file => file.relativePath === selectedPath) ? selectedPath : "SKILL.md";
}

/** Mirrors the plugin files hook's stale-read guard; defaults to the skill's instructions. */
export function useSkillFiles({ toolId, read, t, useFetchQueryHook, packageFilesRead, packageFilesViewState, describeFailure }: SkillFilesDependencies) {
  const [selection, setSelection] = useState<{ toolId: string | null; path: string } | null>(null);
  const queryFetch = useQueryFetchCallback(async () => {
    if (toolId === null) throw new Error("skill files have no selected skill id");
    try { return await read({ toolId }); }
    catch (error) { if (error instanceof Error) throw error; throw new Error("Could not load skill files.", { cause: error }); }
  }, [read, toolId]);
  const query = useFetchQueryHook({ key: ["skills", "files", toolId ?? ""], fetch: queryFetch }, { enabled: toolId !== null, staleTime: 0 });
  const skillCopy: Translate = key => {
    if (key === "Loading package files…") return t("Loading skill files…");
    if (key === "No files to show for this plugin.") return t("No files to show for this skill.");
    return t(key);
  };
  const readResult = packageFilesRead(query);
  const loaded: ReturnType<SkillFilesDependencies["packageFilesRead"]> = readResult?.error ? { ...readResult, error: t(readResult.error) } : readResult;
  const failure = query.error ? describeFailure({ error: query.error, message: "Could not load skill files.", t }) : null;
  const selectedPath = selection !== null && selection.toolId === toolId ? selection.path : "SKILL.md";
  const validPath = skillSelectedPath({ loaded, selectedPath });
  return {
    ...packageFilesViewState({ read: loaded, selectedPath: validPath, translate: skillCopy }),
    failure,
    selectFile: ({ path }: { path: string }, _optional = {}) => setSelection({ toolId, path }),
    t: skillCopy,
  };
}

/** The shared modal accepts these props directly; no Skills-specific modal component needed. */
export function useSkillFilesModal({ skill, onClose, read, useSkillFilesHook, FailureNotice }: {
  skill: InstalledSkill | null; onClose: () => void;
  read: SkillFilesDependencies["read"];
  useSkillFilesHook: (required: Pick<SkillFilesDependencies, "toolId" | "read" | "t">) => ReturnType<typeof useSkillFiles>;
  FailureNotice: ComponentType<{ failure: UserFacingError; t: Translate }>;
}, { t = identity }: { t?: Translate } = {}) {
  const files = useSkillFilesHook({ toolId: skill?.toolId ?? null, read, t });
  if (!skill) return null;
  return {
    title: t("{name} skill files").replace("{name}", () => skill.name),
    subtitle: t("Read-only view of this skill's files; nothing runs from this screen."),
    ...(files.failure ? { headerExtras: createElement(FailureNotice, { failure: files.failure, t }) } : {}),
    files: files.files, selectedFile: files.selectedFile, onSelectFile: (path: string) => files.selectFile({ path }),
    status: files.status, listNotice: files.listNotice,
    handlePrefix: "skill-file", t: files.t, onClose,
  };
}
