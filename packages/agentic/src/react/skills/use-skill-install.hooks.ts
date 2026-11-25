import { useCallback, useRef, useState } from "react";
import type { SkillInstallPayload } from "@jini-ai/core/contracts/site/skill-install";
import type { UserFacingError } from "@jini-ai/core";
import type { Translate } from "@jini-ai/core/text";

/** Holds an upload until the user confirms. A superseded read cannot install an older drop. */
export function useSkillInstall({ installSkill, prepareSkillUpload, describeFailure }: {
  installSkill(payload: SkillInstallPayload): Promise<void>;
  prepareSkillUpload(required: { files: readonly File[] }, optional?: { paths?: readonly string[] }): Promise<SkillInstallPayload>;
  describeFailure(required: { error: unknown; message: string; t: Translate }, optional?: Record<string, never>): UserFacingError;
}, { onInstalled }: { onInstalled?: () => void | Promise<void> } = {}) {
  const [pending, setPending] = useState<SkillInstallPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cause, setCause] = useState<unknown>(null);
  const generation = useRef(0);
  const confirmLock = useRef(false);
  const propose = useCallback((payload: SkillInstallPayload) => { ++generation.current; setError(null); setPending(payload); }, []);
  const proposeFiles = useCallback(async (files: readonly File[], paths?: readonly string[]) => {
    generation.current += 1;
    const current = generation.current;
    setError(null);
    try { const payload = await prepareSkillUpload({ files }, paths === undefined ? {} : { paths }); if (current === generation.current) setPending(payload); }
    catch (e) { if (current === generation.current) { setCause(e); setError(describeFailure({ error: e, message: "Could not read skill.", t: key => key }).message); } }
  }, [prepareSkillUpload, describeFailure]);
  const cancel = useCallback(() => { if (!confirmLock.current) { ++generation.current; setPending(null); setError(null); } }, []);
  const confirm = useCallback(async () => {
    if (!pending || confirmLock.current) return;
    confirmLock.current = true;
    const current = generation.current;
    setBusy(true); setError(null);
    try {
      await installSkill(pending);
      if (current === generation.current) setPending(null);
      await onInstalled?.();
    }
    catch (e) { setCause(e); setError(describeFailure({ error: e, message: "Could not install skill.", t: key => key }).message); }
    finally { confirmLock.current = false; setBusy(false); }
  }, [pending, onInstalled, installSkill, describeFailure]);
  const fail = useCallback((message: string) => { setCause(message); setError(message); }, []);
  return { pending, busy, error, cause, propose, proposeFiles, cancel, confirm, fail };
}
