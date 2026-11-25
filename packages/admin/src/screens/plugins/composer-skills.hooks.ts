import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { ChatPaneComposerHandle, ComposerDiscoveryGroup } from "../../react/kit.js";
import { rankComposerDiscoveryGroups } from "./composer-capabilities.js";
import type { SelectedComposerSkill } from "./selected-skills.js";

/** Uses the existing plugin tray and the same sticky-until-removed context behavior. */
export function useSelectedSkills() {
  const [selectedSkills, setSkills] = useState<readonly SelectedComposerSkill[]>([]);
  const addSkill = useCallback((skill: SelectedComposerSkill) => {
    setSkills(previous => [...previous.filter(existing => existing.toolId !== skill.toolId), skill]);
  }, []);
  const removeSkill = useCallback((toolId: string) => {
    setSkills(previous => previous.filter(skill => skill.toolId !== toolId));
  }, []);
  const chips = useMemo(() => selectedSkills.map(skill => ({ pluginRefId: skill.toolId, label: `${skill.name} · Skill` })), [selectedSkills]);
  const skillOnlyPrompt = selectedSkills.map(skill => skill.name).join(", ");
  return { selectedSkills, addSkill, removeSkill, chips, skillOnlyPrompt };
}

/** The only two facts the dock reads from the draft: whether it is blank, and its leading `/query`
 * (the one input `rankComposerDiscoveryGroups` uses). Held instead of the text so a keystroke that
 * changes neither does not re-render the dock, `ChatPane` and the whole transcript under it — the
 * typing lag the owner reported 2026-10-08. */
interface DraftShape {
  readonly blank: boolean;
  readonly slashQuery: string;
}

const BLANK_DRAFT: DraftShape = { blank: true, slashQuery: "" };

function draftShapeOf({ draft }: { draft: string }, _options: Record<string, never> = {}): DraftShape {
  return { blank: draft.trim().length === 0, slashQuery: /^\/[^\s/]*/.exec(draft)?.[0] ?? "" };
}

/** Jini owns filtering/keyboard behavior but exposes no rank or draft-change slot. Capture the
 * composer's change event at its existing host wrapper and supply an ordered catalog. Read the
 * live textarea for picks too, covering programmatic voice/draft restore without polling. */
export function useComposerDiscoveryDraft(catalog: readonly ComposerDiscoveryGroup[]) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<DraftShape>(BLANK_DRAFT);
  // Returning `previous` when nothing the dock reads changed is what lets React skip the render.
  const adoptDraft = useCallback((draft: string) => {
    const next = draftShapeOf({ draft });
    setShape(previous => (previous.blank === next.blank && previous.slashQuery === next.slashQuery ? previous : next));
  }, []);
  const captureDraft = useCallback((event: FormEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLTextAreaElement && event.target.closest(".jini-composer")) adoptDraft(event.target.value);
  }, [adoptDraft]);
  const readDraft = useCallback(() => rootRef.current?.querySelector<HTMLTextAreaElement>(".jini-composer textarea")?.value ?? "", []);
  const groups = useMemo(() => rankComposerDiscoveryGroups({ groups: catalog, draft: shape.slashQuery }), [catalog, shape.slashQuery]);
  const refreshDraft = useCallback(() => adoptDraft(readDraft()), [adoptDraft, readDraft]);
  return { rootRef, captureDraft, readDraft, groups, draftBlank: shape.blank, refreshDraft };
}

const IDLE_SEND_BUTTON = ".jini-composer-send:not(.jini-composer-send--stop)";

/** Seeding is only safe while the composer accepts input and shows Send (not Stop). */
function composerAcceptsSend({ root }: { root: HTMLDivElement | null }, _options: Record<string, never> = {}): boolean {
  const textarea = root?.querySelector<HTMLTextAreaElement>(".jini-composer textarea");
  return !textarea?.disabled && Boolean(root?.querySelector(IDLE_SEND_BUTTON));
}

/** The package disables Send for empty drafts and exposes only insertText to hosts. This explicit
 * send action uses that public handle to seed a skill-name-only turn at send time, then delegates
 * to the pane's usual Send (including its runtime/upload guards). Selection itself stays blank. */
export function useSkillOnlySend(input: {
  prompt: string;
  composerHandle: RefObject<ChatPaneComposerHandle | null>;
  discovery: ReturnType<typeof useComposerDiscoveryDraft>;
}) {
  const { prompt, composerHandle, discovery } = input;
  useEffect(() => { discovery.refreshDraft(); }, [prompt, discovery.refreshDraft]);
  const sendSkills = useCallback(() => {
    const handle = composerHandle.current;
    if (!prompt || discovery.readDraft().trim() || !handle || !composerAcceptsSend({ root: discovery.rootRef.current })) return;
    flushSync(() => handle.insertText(prompt));
    discovery.rootRef.current?.querySelector<HTMLButtonElement>(IDLE_SEND_BUTTON)?.click();
  }, [prompt, composerHandle, discovery.readDraft, discovery.rootRef]);
  return { sendSkills, canSendSkills: prompt.length > 0 && discovery.draftBlank };
}
