import { useState, type FormEvent } from "react";
import type { RoutineRow, RoutineSchedule } from "@jini-ai/core/contracts/site/routines";
import type { RoutineDraft } from "./routines-api.js";
import type { RoutinesKit, SchedulePickerHook } from "./Routines.js";
import type { RoutinesT } from "./Routines.js";

/**
 * @file Create/edit form for one routine. Why: schedule editing is the picker's job (injected, so the
 * form never owns timezone or minute logic); this file only gathers name, prompt, agent and model and
 * hands one draft to `onSave`. A blank agent or model means "use the default" (null), not an empty string.
 */
const blankToNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

export function RoutineForm({ row, onSave, onCancel, useSchedulePicker, kit, locale, t, desktopNoticeKey }: {
  desktopNoticeKey: string;
  row: RoutineRow | null; onSave: (draft: RoutineDraft) => void; onCancel: () => void;
  useSchedulePicker: SchedulePickerHook; kit: RoutinesKit; locale: string; t: RoutinesT;
}, _optional: { timezone?: string } = {}) {
  const timezone = _optional.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [name, setName] = useState(row?.name ?? "");
  const [prompt, setPrompt] = useState(row?.prompt ?? "");
  const [agent, setAgent] = useState(row?.agentId ?? "");
  const [model, setModel] = useState(row?.model ?? "");
  const [schedule, setSchedule] = useState<RoutineSchedule>(row?.schedule ?? { kind: "daily", time: "09:00", timezone });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ name: name.trim(), prompt, schedule, agentId: blankToNull(agent), model: blankToNull(model) });
  };
  const label = (key: Parameters<RoutinesT>[0]["key"]) => t({ locale, key });
  return (
    <form className="routine-form" onSubmit={submit} aria-label={row === null ? label("New routine") : label("Edit")}>
      <label>{label("Name")}<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
      <label>{label("Prompt")}<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} required /></label>
      <label>{label("Agent")}<input value={agent} placeholder={label("Agent default")} onChange={(event) => setAgent(event.target.value)} /></label>
      <label>{label("Model")}<input value={model} onChange={(event) => setModel(event.target.value)} /></label>
      <div><span>{label("Schedule")}</span>
        <kit.RecurringSchedulePicker value={schedule} onChange={(next) => setSchedule(next)} useRecurringSchedulePicker={useSchedulePicker} />
      </div>
      <p className="routine-form__note">{label(desktopNoticeKey)}</p>
      <button type="submit">{label("Save")}</button>
      <button type="button" onClick={onCancel}>{label("Cancel")}</button>
    </form>
  );
}
