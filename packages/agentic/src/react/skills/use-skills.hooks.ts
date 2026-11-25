import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import type { UserFacingError } from "@jini-ai/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type RefObject, type MouseEvent } from "react";
import type { InstalledSkill } from "@jini-ai/core/contracts/site/installed-skill";
import type { createSkillsApi } from "./api.js";
import type { useSkillInstall } from "./use-skill-install.hooks.js";
import { type Translate } from '@jini-ai/core/text';

function getSkillsAvailability(
  { skills, error, githubUrl, busy, installBusy }: {
    skills: readonly InstalledSkill[] | null;
    error: string | null;
    githubUrl: string;
    busy: boolean;
    installBusy: boolean;
  },
  _options = {},
) {
  const addBusy = busy || installBusy;
  return {
    addBusy,
    githubDisabled: !githubUrl.trim() || addBusy,
    loading: skills === null && !error,
    empty: skills?.length === 0,
  };
}

/** Writes take presentation precedence over a read error without losing their original cause. */
function skillsFailureState({ actionError, actionCause, queryError, t, describeFailure }: { describeFailure: Parameters<typeof useSkills>[0]["describeFailure"]; actionError: string | null; actionCause: unknown; queryError: Error | null; t: Translate }) {
  const message = actionError ?? (queryError ? "Could not load skills." : null);
  const failure = message ? describeFailure({ error: actionError ? actionCause : queryError, message, t }) : null;
  return { error: failure?.message ?? null, failure };
}

type SkillsPort = Pick<ReturnType<typeof createSkillsApi>, "listSkills" | "enableSkill" | "removeSkill">;

/** The cached skills list: the query that renders it and the loader that force-refreshes it. */
function useSkillsList({ port, t, queryHooks, describeFailure }: { port: SkillsPort; t: Translate; queryHooks: Pick<FetchQueryAdapter, "useFetchQuery" | "useInvalidate" | "useCachedLoader">; describeFailure: Parameters<typeof useSkills>[0]["describeFailure"] }) {
  const { useFetchQuery, useInvalidate, useCachedLoader } = queryHooks;
  const queryFetch = useCallback(async () => {
    try { return await port.listSkills(); }
    catch (error) { if (error instanceof Error) throw error; throw new Error(describeFailure({ error, message: "Could not load skills.", t }).message, { cause: error }); }
  }, [port, t, describeFailure]);
  const key = useMemo(() => ["skills", "list"] as const, []);
  const query = useFetchQuery({ key, fetch: queryFetch }, { staleTime: 0 });
  const skills = query.data ?? null;
  const invalidate = useInvalidate();
  const loader = useCachedLoader({ key, fetch: queryFetch }, { staleTime: 0 });
  return { query, skills, invalidate, loader };
}

type SkillsList = ReturnType<typeof useSkillsList>;

/** Reloads the list on the skills-changed event, and tracks whether the view is still mounted for async callbacks. */
function useSkillsReload({ list, setError, subscribeChanged }: { subscribeChanged: Parameters<typeof useSkills>[0]["subscribeChanged"]; list: SkillsList; setError: (error: string | null) => void }) {
  const { invalidate, loader } = list;
  const mounted = useRef(true);
  const reload = useCallback(async () => {
    setError(null);
    invalidate({ key: ["skills"] });
    try { await loader.load(); } catch { /* The query exposes the read error. */ }
  }, [invalidate, loader, setError]);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => void reload();
    const unsubscribe = subscribeChanged(refresh);
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [reload, subscribeChanged]);
  return { mounted, reload };
}

/** Enable/disable and remove writes, with the busy flag, the pending-removal row and its confirmation dialog. */
function useSkillChanges({ port, list, mounted, errors, t, useFetchMutation, useSkillConfirmationHook, describeFailure }: { useFetchMutation: FetchQueryAdapter["useFetchMutation"]; useSkillConfirmationHook: Parameters<typeof useSkills>[0]["useSkillConfirmationHook"]; describeFailure: Parameters<typeof useSkills>[0]["describeFailure"]; t: Translate; port: SkillsPort; list: SkillsList; mounted: { current: boolean }; errors: { setError: (error: string | null) => void; setActionCause: (cause: unknown) => void } }) {
  const { loader } = list;
  const { setError, setActionCause } = errors;
  // The skills API publishes SKILLS_CHANGED_EVENT after accepted writes; that notification
  // already invalidates the list. A second mutation invalidation would restart that fresh read.
  const write = useFetchMutation({ run: ({ input }: { input: () => Promise<unknown> }) => input() });
  const [removing, setRemoving] = useState<InstalledSkill | null>(null);
  const [busy, setBusy] = useState(false);

  async function change({ work }: { work: () => Promise<unknown> }, _optional = {}) {
    setError(null);
    setBusy(true);
    try {
      await write.mutate({ input: work });
      await loader.load().catch(() => {}); // The query exposes refresh failures separately from accepted writes.
      if (mounted.current) setRemoving(null);
    } catch (e) {
      if (mounted.current) {
        setActionCause(e);
        setError(describeFailure({ error: e, message: "Could not change skill.", t }).message);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const onCancelRemove = useCallback(() => { if (!busy) setRemoving(null); }, [busy]);
  const confirmation = useSkillConfirmationHook({ active: removing !== null, onCancel: onCancelRemove });
  function onConfirmRemove() {
    if (removing) {
      const toolId = removing.toolId;
      void change({ work: () => port.removeSkill({ toolId }) });
    }
  }
  const toggleEnabled = (skill: InstalledSkill) => { void change({ work: () => port.enableSkill({ toolId: skill.toolId, enabled: !skill.enabled }) }); };
  return { removing, setRemoving, busy, confirmation, onCancelRemove, onConfirmRemove, toggleEnabled };
}

/** One row view per installed skill, wired to the expand, enable, remove and inspect actions. */
function buildSkillRows({ skills, busy, expandedIds, actions }: { skills: readonly InstalledSkill[] | null; busy: boolean; expandedIds: ReadonlySet<string>; actions: { toggleExpanded: (required: { id: string }) => void; toggleEnabled: (skill: InstalledSkill) => void; remove: (skill: InstalledSkill) => void; inspect: (skill: InstalledSkill) => void } }) {
  return (skills ?? []).map(skill => ({
    skill,
    busy,
    ...(skill.source === "uploaded" ? {} : { sourceUrl: skill.source.githubUrl, shortCommit: skill.source.commit.slice(0, 7) }),
    expanded: expandedIds.has(skill.toolId),
    detailId: `skill-detail-${encodeURIComponent(skill.toolId)}`,
    onToggleExpanded: () => actions.toggleExpanded({ id: skill.toolId }),
    onToggleEnabled: () => actions.toggleEnabled(skill),
    onRemove: () => actions.remove(skill),
    onInspect: () => actions.inspect(skill),
  }));
}

/** Keeps the existing API, refresh event and stale-load guard behind a render-only view.
 * The injected port lets action tests exercise retry/refetch ordering without module mocks. */
export function useSkills({ port, t, queryHooks, subscribeChanged, useSkillInstallHook, useSkillConfirmationHook, useSkillsTabsHook, describeFailure }: {
  port: SkillsPort;
  t: Translate;
  queryHooks: FetchQueryAdapter;
  subscribeChanged(listener: () => void): () => void;
  useSkillInstallHook(required: Record<string, never>, optional: { onInstalled: () => void | Promise<void> }): ReturnType<typeof useSkillInstall>;
  useSkillConfirmationHook(required: { active: boolean; onCancel: () => void }): { dialogRef: RefObject<HTMLDivElement | null>; onDialogClick(event: MouseEvent<HTMLDivElement>): void };
  useSkillsTabsHook(): { activeTabId: "skills" | "add"; onTabChange(tabId: string): void; onShowSkills(): void; onShowAdd(): void };
  describeFailure(required: { error: unknown; message: string; t: Translate }, optional?: Record<string, never>): UserFacingError;
}, _optional: Record<string, never> = {}) {
  const tabs = useSkillsTabsHook();
  const list = useSkillsList({ port, t, queryHooks, describeFailure });
  const { query, skills, loader } = list;
  const [actionError, setError] = useState<string | null>(null);
  const [actionCause, setActionCause] = useState<unknown>(null);
  const { error, failure } = skillsFailureState({ actionError, actionCause, queryError: query.error, t, describeFailure });
  const [githubUrl, setGithubUrl] = useState("");
  const [inspecting, setInspecting] = useState<InstalledSkill | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const { mounted, reload } = useSkillsReload({ list, setError, subscribeChanged });
  const changes = useSkillChanges({ port, list, mounted, t, useFetchMutation: queryHooks.useFetchMutation, useSkillConfirmationHook, describeFailure, errors: { setError, setActionCause } });
  const { removing, setRemoving, busy, confirmation, onCancelRemove, onConfirmRemove, toggleEnabled } = changes;
  const onInstalled = useCallback(async () => {
    await loader.load().catch(() => {}); // The query exposes refresh failures separately from accepted writes.
    if (mounted.current) tabs.onShowSkills();
  }, [loader, mounted, tabs.onShowSkills]);
  const install = useSkillInstallHook({}, { onInstalled });

  function onSubmitGithub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    install.propose({ githubUrl: githubUrl.trim() });
  }
  function onGithubUrlChange(event: ChangeEvent<HTMLInputElement>) { setGithubUrl(event.target.value); }
  function onFilesChange(event: ChangeEvent<HTMLInputElement>) {
    void install.proposeFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }
  function toggleExpanded({ id }: { id: string }, _optional = {}) {
    setExpandedIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const rows = buildSkillRows({ skills, busy, expandedIds, actions: { toggleExpanded, toggleEnabled, remove: setRemoving, inspect: setInspecting } });
  return {
    ...tabs,
    skills, rows, error, failure, githubUrl, removing, inspecting, busy, install, confirmation,
    onCloseFiles: () => setInspecting(null),
    filesInput, folderInput,
    ...getSkillsAvailability({ skills, error, githubUrl, busy, installBusy: install.busy }),
    reload, onCancelRemove, onConfirmRemove, onSubmitGithub, onGithubUrlChange, onFilesChange,
    onChooseFiles: () => filesInput.current?.click(),
    onChooseFolder: () => folderInput.current?.click(),
  };
}

export type SkillsController = ReturnType<typeof useSkills>;
