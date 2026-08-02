import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SkillsPort } from '../../ports.js';
import {
  EMPTY_SKILL_DRAFT,
  filterSkills,
  hasAnyCategory,
  isBuiltInSkill,
  parseTriggers,
  skillFilterOptions,
  summaryToDraft,
  validateSkillDraft,
} from '../../rules.js';
import type {
  SkillDetail,
  SkillDraft,
  SkillDraftError,
  SkillFileEntry,
  SkillFilterOption,
  SkillFilters,
  SkillSummary,
  SourceFilter,
} from '../../types.js';

export interface UseSkillsTabOptions {
  port: SkillsPort;
  /** Locale for `localizedSkillName`/`localizedSkillDescription` and the
   *  search that matches against them. Defaults to `'en'`. */
  locale?: string | undefined;
}

export interface SkillFilterRow {
  all: number;
  options: readonly SkillFilterOption[];
}

export interface UseSkillsTabResult {
  skills: readonly SkillSummary[];
  loading: boolean;
  loadError: string | null;

  filters: SkillFilters;
  setSearch: (value: string) => void;
  setSourceFilter: (value: SourceFilter) => void;
  setModeFilter: (value: string) => void;
  setCategoryFilter: (value: string) => void;

  filteredSkills: readonly SkillSummary[];
  sourceOptions: SkillFilterRow;
  modeOptions: SkillFilterRow;
  /** `null` when no skill in the listing carries a category — the tab
   *  renders no category row at all rather than one with nothing but an
   *  "all" pill. See `hasAnyCategory`. */
  categoryOptions: SkillFilterRow | null;

  expandedId: string | null;
  toggleExpanded: (id: string) => void;
  bodyById: Readonly<Record<string, string>>;
  bodyLoadingId: string | null;
  filesById: Readonly<Record<string, readonly SkillFileEntry[]>>;
  filesLoadingId: string | null;

  editingId: string | null;
  creating: boolean;
  draft: SkillDraft;
  setDraft: (updater: (draft: SkillDraft) => SkillDraft) => void;
  draftError: SkillDraftError | null;
  draftSaving: boolean;
  startCreate: () => void;
  /** Built-in skills gate through `confirmBuiltInEditId` first; a `'user'`
   *  skill starts editing immediately. */
  requestEdit: (skill: SkillSummary) => void;
  confirmBuiltInEditId: string | null;
  confirmBuiltInEdit: () => void;
  cancelBuiltInEdit: () => void;
  cancelDraft: () => void;
  submitDraft: () => void;

  confirmDeleteId: string | null;
  armDelete: (id: string) => void;
  cancelDelete: () => void;
  commitDelete: (id: string) => void;
}

/**
 * Owns every async edge and piece of interaction state for the Skills tab:
 * the initial list load, lazy per-skill body/file-tree fetches, the
 * create/edit draft form (including the built-in "creates a shadow copy"
 * confirmation), and the two-click delete confirmation. Origin:
 * `SkillsSection`'s own `useState` block — ported as a hook rather than
 * inline so the component stays render-only, same split as every other tab
 * in this feature.
 *
 * Filtering/search/counts are NOT recomputed here beyond calling this
 * feature's own pure `rules.ts` functions over the current `skills` +
 * `filters` — see
 * `filterSkills`/`skillFilterOptions` for the actual logic.
 */
export function useSkillsTab({ port, locale = 'en' }: UseSkillsTabOptions): UseSkillsTabResult {
  const [skills, setSkills] = useState<readonly SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [filters, setFilters] = useState<SkillFilters>({ search: '', source: 'all', mode: 'all', category: 'all' });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bodyById, setBodyById] = useState<Record<string, string>>({});
  const [bodyLoadingId, setBodyLoadingId] = useState<string | null>(null);
  const [filesById, setFilesById] = useState<Record<string, readonly SkillFileEntry[]>>({});
  const [filesLoadingId, setFilesLoadingId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraftState] = useState<SkillDraft>(EMPTY_SKILL_DRAFT);
  const [draftError, setDraftError] = useState<SkillDraftError | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBuiltInEditId, setConfirmBuiltInEditId] = useState<string | null>(null);

  const portRef = useRef(port);
  portRef.current = port;
  const bodyByIdRef = useRef(bodyById);
  bodyByIdRef.current = bodyById;
  const filesByIdRef = useRef(filesById);
  filesByIdRef.current = filesById;

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<readonly SkillSummary[]> => {
    const list = await portRef.current.listSkills();
    if (alive.current) setSkills(list);
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh()
      .catch((error: unknown) => {
        if (cancelled || !alive.current) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const filteredSkills = useMemo(() => filterSkills(skills, filters, locale), [skills, filters, locale]);
  const sourceOptions = useMemo(() => skillFilterOptions(skills, filters, locale, 'source'), [skills, filters, locale]);
  const modeOptions = useMemo(() => skillFilterOptions(skills, filters, locale, 'mode'), [skills, filters, locale]);
  const categoryOptions = useMemo(
    () => (hasAnyCategory(skills) ? skillFilterOptions(skills, filters, locale, 'category') : null),
    [skills, filters, locale],
  );

  const setSearch = useCallback((value: string) => setFilters((f) => ({ ...f, search: value })), []);
  const setSourceFilter = useCallback((value: SourceFilter) => setFilters((f) => ({ ...f, source: value })), []);
  const setModeFilter = useCallback((value: string) => setFilters((f) => ({ ...f, mode: value })), []);
  const setCategoryFilter = useCallback((value: string) => setFilters((f) => ({ ...f, category: value })), []);

  const ensureBody = useCallback(async (id: string): Promise<string> => {
    const cached = bodyByIdRef.current[id];
    if (cached !== undefined) return cached;
    setBodyLoadingId(id);
    try {
      const detail: SkillDetail = await portRef.current.fetchSkillDetail(id);
      if (alive.current) setBodyById((cur) => ({ ...cur, [id]: detail.body }));
      return detail.body;
    } finally {
      if (alive.current) setBodyLoadingId((cur) => (cur === id ? null : cur));
    }
  }, []);

  const ensureFiles = useCallback(async (id: string): Promise<void> => {
    if (filesByIdRef.current[id]) return;
    setFilesLoadingId(id);
    try {
      const entries = await portRef.current.fetchSkillFiles(id);
      if (alive.current) setFilesById((cur) => ({ ...cur, [id]: entries }));
    } finally {
      if (alive.current) setFilesLoadingId((cur) => (cur === id ? null : cur));
    }
  }, []);

  const toggleExpanded = useCallback(
    (id: string) => {
      setExpandedId((cur) => {
        if (cur === id) return null;
        void ensureBody(id);
        void ensureFiles(id);
        return id;
      });
      setEditingId((cur) => (cur === id ? cur : null));
      setConfirmDeleteId(null);
      setConfirmBuiltInEditId(null);
    },
    [ensureBody, ensureFiles],
  );

  const startCreate = useCallback(() => {
    setCreating(true);
    setDraftState(EMPTY_SKILL_DRAFT);
    setDraftError(null);
    setEditingId(null);
    setConfirmDeleteId(null);
    setConfirmBuiltInEditId(null);
  }, []);

  const startEdit = useCallback(
    async (skill: SkillSummary) => {
      const body = await ensureBody(skill.id);
      if (!alive.current) return;
      setDraftState(summaryToDraft(skill, body));
      setDraftError(null);
      setEditingId(skill.id);
      setExpandedId(skill.id);
      setCreating(false);
      setConfirmDeleteId(null);
      setConfirmBuiltInEditId(null);
    },
    [ensureBody],
  );

  const requestEdit = useCallback(
    (skill: SkillSummary) => {
      if (isBuiltInSkill(skill)) {
        setConfirmBuiltInEditId(skill.id);
        setConfirmDeleteId(null);
        return;
      }
      void startEdit(skill);
    },
    [startEdit],
  );

  const confirmBuiltInEdit = useCallback(() => {
    const id = confirmBuiltInEditId;
    setConfirmBuiltInEditId(null);
    if (!id) return;
    const skill = skills.find((s) => s.id === id);
    if (skill) void startEdit(skill);
  }, [confirmBuiltInEditId, skills, startEdit]);

  const cancelBuiltInEdit = useCallback(() => setConfirmBuiltInEditId(null), []);

  const cancelDraft = useCallback(() => {
    setDraftState(EMPTY_SKILL_DRAFT);
    setDraftError(null);
    setEditingId(null);
    setCreating(false);
  }, []);

  const setDraft = useCallback((updater: (draft: SkillDraft) => SkillDraft) => {
    setDraftState((current) => updater(current));
  }, []);

  const submitDraft = useCallback(() => {
    if (draftSaving) return;
    const validation = validateSkillDraft(draft);
    if (validation) {
      setDraftError({ kind: validation });
      return;
    }
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      body: draft.body.trim(),
      triggers: parseTriggers(draft.triggers),
    };
    setDraftSaving(true);
    setDraftError(null);
    const write = editingId ? portRef.current.updateSkill(editingId, payload) : portRef.current.createSkill(payload);
    void write.then(
      async (updated: SkillDetail) => {
        if (!alive.current) return;
        setDraftSaving(false);
        await refresh();
        if (!alive.current) return;
        setBodyById((cur) => ({ ...cur, [updated.id]: updated.body }));
        // Drop the cached file tree so the next expand re-walks the on-disk
        // folder — the body may have been the only file before, but the
        // operator might have meant to add more.
        setFilesById((cur) => {
          const next = { ...cur };
          delete next[updated.id];
          return next;
        });
        setExpandedId(updated.id);
        setEditingId(null);
        setCreating(false);
        setDraftState(EMPTY_SKILL_DRAFT);
      },
      (error: unknown) => {
        if (!alive.current) return;
        setDraftSaving(false);
        setDraftError({ kind: 'submit-failed', message: error instanceof Error ? error.message : String(error) });
      },
    );
  }, [draft, draftSaving, editingId, refresh]);

  const armDelete = useCallback((id: string) => setConfirmDeleteId(id), []);
  const cancelDelete = useCallback(() => setConfirmDeleteId(null), []);

  const commitDelete = useCallback(
    (id: string) => {
      void portRef.current.deleteSkill(id).then(
        async () => {
          if (!alive.current) return;
          setConfirmDeleteId(null);
          await refresh();
          if (!alive.current) return;
          setBodyById((cur) => {
            const next = { ...cur };
            delete next[id];
            return next;
          });
          setFilesById((cur) => {
            const next = { ...cur };
            delete next[id];
            return next;
          });
          setExpandedId((cur) => (cur === id ? null : cur));
          setEditingId((cur) => {
            if (cur !== id) return cur;
            setDraftState(EMPTY_SKILL_DRAFT);
            return null;
          });
        },
        (error: unknown) => {
          if (!alive.current) return;
          setDraftError({ kind: 'submit-failed', message: error instanceof Error ? error.message : String(error) });
        },
      );
    },
    [refresh],
  );

  return {
    skills,
    loading,
    loadError,
    filters,
    setSearch,
    setSourceFilter,
    setModeFilter,
    setCategoryFilter,
    filteredSkills,
    sourceOptions,
    modeOptions,
    categoryOptions,
    expandedId,
    toggleExpanded,
    bodyById,
    bodyLoadingId,
    filesById,
    filesLoadingId,
    editingId,
    creating,
    draft,
    setDraft,
    draftError,
    draftSaving,
    startCreate,
    requestEdit,
    confirmBuiltInEditId,
    confirmBuiltInEdit,
    cancelBuiltInEdit,
    cancelDraft,
    submitDraft,
    confirmDeleteId,
    armDelete,
    cancelDelete,
    commitDelete,
  };
}
