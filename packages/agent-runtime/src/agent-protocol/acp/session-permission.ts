/** @module agent-protocol/acp/session-permission
 * Answers an ACP agent's `session/request_permission` calls for one attached
 * session: well-formed option filtering, the default policy, the injected
 * `onPermissionRequest` handler, and fail-closed cancellation. Split out of
 * `session-run.ts` to keep each module under the file-size limit.
 */
import type { JsonRpcId, UnknownRecord } from './types.js';
import { asObject } from './json.js';
import { sendRpcResult, isJsonRpcId, choosePermissionOutcome } from './rpc.js';
import { clearStageTimer, resetStageTimer, sendAgent, type AcpRun } from './session-run.js';
import type {
  AcpPermissionDecision,
  AcpPermissionOption,
  AcpPermissionRequest,
  AttachAcpSessionOptions,
} from './session.js';

/** ACP `PermissionOptionKind` values; other offered options are ignored. */
const ACP_PERMISSION_OPTION_KINDS: readonly string[] = ['allow_once', 'allow_always', 'reject_once', 'reject_always'];
/** ACP `ToolKind` values; anything else is logged as `other`. */
const ACP_TOOL_KINDS: readonly string[] = ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other'];

/** The well-formed options of a permission request: a non-empty `optionId`
 * and an ACP `PermissionOptionKind`; anything else offered is ignored. */
function offeredPermissionOptions(params: UnknownRecord | null): AcpPermissionOption[] {
  if (!Array.isArray(params?.options)) return [];
  return params.options.filter((option): option is AcpPermissionOption => {
    const record = asObject({ value: option });
    return typeof record?.optionId === 'string' && record.optionId !== '' &&
      typeof record.kind === 'string' && ACP_PERMISSION_OPTION_KINDS.includes(record.kind);
  });
}

/** The tool call's ACP `ToolKind` for permission logging, `other` when absent or unknown. */
function permissionToolKind(toolCall: UnknownRecord | null): string {
  return typeof toolCall?.kind === 'string' && ACP_TOOL_KINDS.includes(toolCall.kind) ? toolCall.kind : 'other';
}

/** The permission decision used when no `onPermissionRequest` handler is
 * injected: the option `choosePermissionOutcome` picks under the run's
 * `permissionMode` / `cliParity`, or a cancellation when it picks none. */
function defaultPermissionDecision(
  { optionRecords }: { optionRecords: AcpPermissionOption[] },
  {
    permissionMode,
    cliParity,
  }: { permissionMode?: AttachAcpSessionOptions['permissionMode']; cliParity?: boolean | undefined } = {},
): AcpPermissionDecision {
  const optionId = choosePermissionOutcome({ options: optionRecords }, { ...(permissionMode ? { permissionMode } : {}), ...(cliParity ? { cliParity: true } : {}) });
  return optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' };
}

interface PermissionReply {
  run: AcpRun;
  requestId: JsonRpcId;
  toolCall: UnknownRecord | null;
  optionRecords: AcpPermissionOption[];
}

// One status event per request. Only protocol categories leave this
// boundary: titles, names, option ids and raw arguments can contain
// commands, paths or credentials.
function logPermissionDecision({ run, toolCall }: { run: AcpRun; toolCall: UnknownRecord | null }, { selected }: { selected?: AcpPermissionOption } = {}): void {
  try {
    const tool = permissionToolKind(toolCall);
    sendAgent({ run,
      payload: { type: 'status', label: 'acp_permission', detail: `tool=${tool} decision=${selected?.kind ?? 'cancelled'}` },
    });
  } catch {
    // Host telemetry must not turn a handled request into a run failure.
  }
}

function respondToPermission(reply: PermissionReply, decision: AcpPermissionDecision): void {
  const { run, requestId, optionRecords, toolCall } = reply;
  run.pendingPermissionRequests.delete(requestId);
  if (run.aborted || run.finished) return;
  // Anything but an offered option (including an invalid handler result) cancels.
  const choice = asObject({ value: decision });
  const selected = choice?.outcome === 'selected'
    ? optionRecords.find((option) => option.optionId === choice.optionId)
    : undefined;
  resetStageTimer({ run, label: 'session/request_permission' });
  try {
    sendRpcResult({ writable: run.stdin, id: requestId, result: {
      outcome: selected ? { outcome: 'selected', optionId: selected.optionId } : { outcome: 'cancelled' },
    } });
  } catch {
    // A broken pipe cannot carry a response; ordinary transport lifecycle
    // handling still owns process failure, not the permission decision.
  }
  logPermissionDecision({ run, toolCall }, selected === undefined ? {} : { selected });
}

function askPermissionHandler(reply: PermissionReply, params: UnknownRecord): void {
  const { run, requestId, toolCall, optionRecords } = reply;
  const { onPermissionRequest, permissionMode, cliParity } = run.options;
  const cancel = () => respondToPermission(reply, { outcome: 'cancelled' });
  try {
    if (!onPermissionRequest) {
      respondToPermission(reply, defaultPermissionDecision({ optionRecords }, { permissionMode, cliParity }));
      return;
    }
    const request: AcpPermissionRequest = {
      requestId,
      sessionId: typeof params.sessionId === 'string' ? params.sessionId : null,
      toolCall: toolCall ?? null,
      options: optionRecords,
      rawParams: params,
    };
    Promise.resolve(onPermissionRequest(request)).then((decision) => respondToPermission(reply, decision), cancel);
  } catch {
    cancel();
  }
}

export function replyPermission({ run, raw }: { run: AcpRun; raw: UnknownRecord }, _optional: Record<string, never> = {}): void {
  const params = asObject({ value: raw.params });
  const toolCall = asObject({ value: params?.toolCall });
  if (!isJsonRpcId(raw.id)) {
    // No response can be correlated without a valid id; drop it rather
    // than failing the run.
    logPermissionDecision({ run, toolCall });
    return;
  }
  const reply: PermissionReply = {
    run, requestId: raw.id, toolCall, optionRecords: offeredPermissionOptions(params),
  };
  if (!params) {
    respondToPermission(reply, { outcome: 'cancelled' });
    return;
  }
  run.pendingPermissionRequests.set(raw.id, () => logPermissionDecision({ run, toolCall }));
  // Human decision time is outside the agent's inactivity budget. All timer
  // resets stay paused until the last pending permission response is sent.
  clearStageTimer({ run });
  askPermissionHandler(reply, params);
}
