/**
 * @file The admin `assistant` wire DTOs: the JSON bodies the assistant settings and "Execution mode"
 * probe routes answer with and an admin client reads. Declared here, once, so the CMS route specs
 * (`@jini-ai/cms/admin-http/routes/assistant/*`) and any client mirror read the same shapes without
 * the client depending on CMS. The projection and verdict rules stay in CMS; only the declarations
 * sit in Core.
 *
 * Only shapes the specs themselves declare live here. The settings, credential and visitor-tools
 * payloads inside each `{ data }` envelope are host views the specs never name (typed `unknown`
 * there), so the settings envelope is generic over its payload, like `AdminMenuDto<Target>`.
 *
 * Core cannot import CMS, so the two detected-agent unions (`modelsSource`, `authStatus`) are
 * restated structurally. CMS's `admin-http/routes/assistant/__tests__/wire-dtos.test.ts` pins them
 * against the route's `ExecutionDetectedAgent` in both directions; keep the two sides identical.
 */

/** One `{ id, label }` option: a model's or an agent's reasoning-effort level. */
export interface AssistantIdLabelDto {
  id: string;
  label: string;
}

/** One model a detected agent offers, with its OWN effort levels when the runtime reports them. */
export interface AssistantAgentModelDto {
  id: string;
  label: string;
  /** Absent means "this runtime does not report per-model levels", never "this model supports none". */
  reasoning?: AssistantIdLabelDto[];
}

/** One detected code-agent CLI as the execution tab's agent picker reads it. */
export interface AssistantExecutionTabAgentDto {
  id: string;
  label: string;
  installed: boolean;
  version?: string;
  path?: string;
  models?: AssistantAgentModelDto[];
  modelsSource?: 'live' | 'fallback';
  reasoningOptions?: AssistantIdLabelDto[];
  reasoningInModelId?: { levels: AssistantIdLabelDto[] };
  authStatus?: 'ok' | 'missing' | 'unknown';
  authMessage?: string;
}

/** A detect-agents row: the agent plus whether the host's background scan is still running. */
export type AssistantDetectedAgentRowDto = AssistantExecutionTabAgentDto & { discoveryPending: boolean };

/** `POST .../assistant/execution/detect-agents` answers every detected agent in a `{ data }` envelope. */
export interface AssistantDetectAgentsResponseDto {
  data: AssistantDetectedAgentRowDto[];
}

/**
 * A probe's verdict (`test-agent`, `test-connection`): `ok: false` means the probe RAN and the target
 * is not usable; a probe that could not run at all is a 5xx instead, with no verdict.
 */
export interface AssistantProbeVerdictDto {
  ok: boolean;
  message: string;
}

/** `POST .../assistant/execution/models`: discovered model ids, plus the probe's message when it gave one. */
export interface AssistantListModelsResponseDto {
  ok: boolean;
  models: string[];
  message?: string;
}

/**
 * `GET .../assistant/settings`: the host's settings view plus the sibling admin-assistant switch
 * (piggy-backed here because this route is mounted unconditionally).
 */
export interface AssistantSettingsEnvelopeDto<Settings = unknown> {
  data: Settings;
  adminAssistantEnabled: boolean;
}
