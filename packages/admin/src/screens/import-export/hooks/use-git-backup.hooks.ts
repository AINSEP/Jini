import { useEffect, useRef, useState } from "react";
import { useFetchQuery } from "../../../react/kit.js";

import {
  EMPTY_GIT_BACKUP_FORM,
  backupConnectionLabels,
  gitBackupFormReady,
  gitBackupPlanInput,
  gitBackupRefusalMessage,
  isGitBackupInProgress,
  isGitBackupPlan,
  isGitBackupPushed,
  type GitBackupForm,
} from "../git-backup-rules.js";
import { type GitBackupPlan, type GitBackupPort, type GitBackupProgress, type GitBackupPushResult } from "./git-backup-port.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file State for the Import & Export panel's Git backup card: idle → planning → planned → pushing →
 * done, or refused with one plain line. Every effect goes through {@link GitBackupPort}; the card is
 * markup only.
 *
 * Host seam: the API-error describer (`GitBackupHost`) arrives on `host`, so this file reaches
 * neither the host's HTTP client nor the admin shell. The host keeps the live port and the
 * zero-argument `useWiredGitBackup` binding beside its admin HTTP client.
 */

export const GIT_BACKUP_CONNECTIONS_KEY = ["import-export", "git-backup-connections"] as const;

/** Each push POST waits ~1.5 s server-side, so re-posting at once is the poll. 2400 posts bound a
 *  stuck job at about an hour; a large backup on a slow link can take tens of minutes. */
const MAX_PUSH_POLLS = 2400;

export type GitBackupPhase = "idle" | "planning" | "planned" | "pushing" | "done" | "refused";

export interface GitBackupController {
  /** Labels of the connections a backup can use; `undefined` while loading. */
  connections: string[] | undefined;
  connectionsError: string | null;
  form: GitBackupForm;
  setField: (required: { field: keyof GitBackupForm; value: string }, optional?: Record<string, never>) => void;
  canPlan: boolean;
  phase: GitBackupPhase;
  plan: GitBackupPlan | null;
  progress: GitBackupProgress | null;
  done: { repository: string; commitUrl: string } | null;
  message: string | null;
  planBackup: () => Promise<void>;
  pushBackup: () => Promise<void>;
  /** Back to the form, keeping what was typed. */
  reset: () => void;
}

/** What the host supplies so this hook stays free of its HTTP client. */
export interface GitBackupHost {
  /** Words a failed request in the host's own API-error language, `fallback` when it has none. */
  describeError: (required: { e: unknown; fallback: string }) => string;
}

/** Posts the planId until the push finishes, the card unmounts or the poll cap is spent, reporting
 *  each answer's progress. @returns The last answer. */
async function pushUntilDone(required: { port: GitBackupPort; planId: string; alive: () => boolean; onProgress: (progress: GitBackupProgress) => void; maxPolls: number }): Promise<GitBackupPushResult> {
  const { port, planId, alive, onProgress } = required;
  let result = await port.push({ planId });
  for (let polls = 0; isGitBackupInProgress(result) && alive() && polls < required.maxPolls; polls += 1) {
    onProgress(result.progress);
    result = await port.push({ planId });
  }
  return result;
}

/**
 * Git backup: plan with the saved connection, show the plan, push it and poll to the commit.
 * @complexity O(polls) network round trips per push.
 */
export function useGitBackup({ port, t, host }: { port: GitBackupPort; t: Translate; host: GitBackupHost }, { maxPushPolls = MAX_PUSH_POLLS }: { maxPushPolls?: number } = {}): GitBackupController {
  const list = useFetchQuery({ key: [...GIT_BACKUP_CONNECTIONS_KEY], fetch: () => port.listConnections() });
  const connections = list.data ? backupConnectionLabels({ credentials: list.data }) : undefined;
  const [form, setForm] = useState<GitBackupForm>(EMPTY_GIT_BACKUP_FORM);
  const [phase, setPhase] = useState<GitBackupPhase>("idle");
  const [plan, setPlan] = useState<GitBackupPlan | null>(null);
  const [progress, setProgress] = useState<GitBackupProgress | null>(null);
  const [done, setDone] = useState<GitBackupController["done"]>(null);
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    // StrictMode replays setup after cleanup; each setup must mark this mount alive again.
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // The first usable connection is chosen for the owner; a select appears only when there are two.
  const effectiveForm = form.connection === "" && connections?.[0] ? { ...form, connection: connections[0] } : form;

  function refuse({ line }: { line: string }, _optional = {}) {
    setMessage(line);
    setPhase("refused");
  }

  async function planBackup() {
    if (phase === "planning" || !gitBackupFormReady(effectiveForm)) return;
    setPhase("planning");
    setMessage(null);
    try {
      const result = await port.plan(gitBackupPlanInput(effectiveForm));
      if (!alive.current) return;
      if (!isGitBackupPlan(result)) { refuse({ line: gitBackupRefusalMessage({ result, t }) }); return; }
      setPlan(result);
      setPhase("planned");
    } catch (failure) {
      if (alive.current) refuse({ line: host.describeError({ e: failure, fallback: t("Git backup failed.") }) });
    }
  }

  async function pushBackup() {
    if (phase !== "planned" || !plan) return;
    setPhase("pushing");
    setProgress(null);
    try {
      const result = await pushUntilDone({ port, planId: plan.planId, alive: () => alive.current, onProgress: setProgress, maxPolls: maxPushPolls });
      if (!alive.current) return;
      if (isGitBackupPushed(result)) { setDone({ repository: result.repository, commitUrl: result.commitUrl }); setPhase("done"); return; }
      refuse({ line: isGitBackupInProgress(result) ? t("The backup is taking too long. Check the repository later.") : gitBackupRefusalMessage({ result, t }) });
    } catch (failure) {
      if (alive.current) refuse({ line: host.describeError({ e: failure, fallback: t("Git backup failed.") }) });
    }
  }

  return {
    connections,
    connectionsError: list.error ? host.describeError({ e: list.error, fallback: t("Couldn't load connections.") }) : null,
    form: effectiveForm,
    // The shown connection is kept when another field is typed first, so it never silently changes.
    setField: ({ field, value }, _optional = {}) => setForm((current) => ({ ...current, connection: current.connection || (connections?.[0] ?? ""), [field]: value })),
    canPlan: gitBackupFormReady(effectiveForm) && phase !== "planning",
    phase,
    plan,
    progress,
    done,
    message,
    planBackup,
    pushBackup,
    reset: () => { setPhase("idle"); setPlan(null); setProgress(null); setDone(null); setMessage(null); },
  };
}
