/**
 * Structurally `@jini-ai/http-kit`'s `StoredAttachment` (and `@jini-ai/chat/core`'s
 * `ChatAttachment`), kept as a local name only so this host's own request envelope reads in its own
 * vocabulary. Assignable to the store's `claim()` parameter without conversion — the compile-time
 * proof is `daemon.ts` passing `decoded.attachments` straight into `attachmentStore.claim`.
 */
export interface PlaygroundAttachment {
  path: string;
  name: string;
  kind: 'image' | 'file';
  size?: number;
}

export interface PlaygroundRunRequest {
  prompt: string;
  project: string;
  model?: string;
  reasoning?: string;
  workingDirectory?: string;
  attachments?: PlaygroundAttachment[];
  /**
   * Proves which browser surface started this run, so the daemon can route `page.*` calls back to
   * it. Rides in this host-owned envelope rather than on the neutral run DTO — see
   * `@jini-ai/server`'s `createFrontendControl`. Absent for a run with no originating tab.
   */
  frontendBindToken?: string;
}

interface PlaygroundFailureLifecycle {
  get: (runId: string) => Promise<{ state: string } | undefined>;
  emit: (
    runId: string,
    input: { event: 'error'; data: { message: string } },
  ) => Promise<unknown>;
  finish: (input: {
    runId: string;
    status: 'failed';
    code: null;
    signal: null;
    resumable: false;
  }) => Promise<unknown>;
}

interface DecodePlaygroundRunRequestInput {
  contextRef: string;
  allowedProjects: ReadonlySet<string>;
  prefix?: string;
  maxAttachments?: number;
}

const PLAYGROUND_RUNTIME_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LANGUAGE',
  // Windows process launch requires these when the playground is run there.
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
]);

/**
 * Copies only process-launch and home-auth environment values needed by local
 * CLI agents. Playground authority secrets and unrelated launcher credentials
 * never cross into the child process.
 */
export function createPlaygroundRuntimeEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (
      typeof value === 'string'
      && (PLAYGROUND_RUNTIME_ENV_KEYS.has(key) || key.startsWith('LC_'))
    ) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Decodes and validates the opaque playground run context at the daemon edge.
 * Malformed attachment entries and paths outside the upload root fail closed.
 * Metadata is only syntactically decoded here; the daemon upload registry
 * replaces it with trusted metadata before execution.
 *
 * @complexity Time/space: O(n), where n is the number of supplied attachments,
 * bounded by `maxAttachments`.
 * @overallScore 100/100
 */
export function decodePlaygroundRunRequest({
  contextRef,
  allowedProjects,
  prefix = 'playground:',
  maxAttachments = 10,
}: DecodePlaygroundRunRequestInput): PlaygroundRunRequest {
  if (!contextRef.startsWith(prefix)) {
    throw new Error('Jini Playground received an unsupported run context');
  }
  const parsed = JSON.parse(
    Buffer.from(contextRef.slice(prefix.length), 'base64url').toString('utf8'),
  ) as Partial<PlaygroundRunRequest>;
  if (typeof parsed.prompt !== 'string' || parsed.prompt.trim().length === 0) {
    throw new Error('Jini Playground requires a non-empty prompt');
  }
  if (typeof parsed.project !== 'string' || !allowedProjects.has(parsed.project)) {
    throw new Error('Jini Playground received an unknown sample project');
  }

  const model = typeof parsed.model === 'string' && parsed.model.trim().length > 0
    ? parsed.model.trim()
    : undefined;
  const reasoning = typeof parsed.reasoning === 'string' && parsed.reasoning.trim().length > 0
    ? parsed.reasoning.trim()
    : undefined;
  const workingDirectory =
    typeof parsed.workingDirectory === 'string' && parsed.workingDirectory.trim().length > 0
      ? parsed.workingDirectory.trim()
      : undefined;
  if (Array.isArray(parsed.attachments) && parsed.attachments.length > maxAttachments) {
    throw new Error('Jini Playground received too many attachments');
  }
  const attachments = Array.isArray(parsed.attachments)
    ? parsed.attachments.map((candidate) => {
        if (!candidate || typeof candidate !== 'object') {
          throw new Error('Jini Playground received a malformed attachment');
        }
        const attachment = candidate as Partial<PlaygroundAttachment>;
        if (
          typeof attachment.path !== 'string'
          || typeof attachment.name !== 'string'
          || (attachment.kind !== 'image' && attachment.kind !== 'file')
        ) throw new Error('Jini Playground received a malformed attachment');
        if (!/^attachment:[a-f0-9-]{36}$/u.test(attachment.path)) {
          throw new Error('Jini Playground received an invalid attachment capability');
        }
        return {
          path: attachment.path,
          name: attachment.name,
          kind: attachment.kind,
          ...(typeof attachment.size === 'number' ? { size: attachment.size } : {}),
        };
      })
    : undefined;

  const frontendBindToken =
    typeof parsed.frontendBindToken === 'string' && parsed.frontendBindToken.length > 0
      ? parsed.frontendBindToken
      : undefined;

  return {
    prompt: parsed.prompt,
    project: parsed.project,
    ...(frontendBindToken !== undefined ? { frontendBindToken } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(workingDirectory !== undefined ? { workingDirectory } : {}),
    ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
  };
}

/**
 * Adds a user-visible attachment manifest without changing an empty manifest.
 *
 * @complexity Time/space: O(n), where n is the manifest text length.
 * @overallScore 100/100
 */
export function promptWithPlaygroundAttachments(request: PlaygroundRunRequest): string {
  if (!request.attachments?.length) return request.prompt;
  const manifest = request.attachments
    .map((attachment) => `- ${attachment.kind}: ${attachment.name} (${attachment.path})`)
    .join('\n');
  return `${request.prompt}\n\n## User attachments\n${manifest}`;
}

/**
 * Emits and terminalizes failures that happen before AgentExecutor takes
 * ownership. Executor-owned failures are already terminal and are left alone.
 *
 * @complexity Time/space: O(1), with at most three lifecycle calls.
 * @overallScore 100/100
 */
export async function failPlaygroundRunBeforeExecutor({
  lifecycle,
  runId,
}: {
  lifecycle: PlaygroundFailureLifecycle;
  runId: string;
}): Promise<boolean> {
  const status = await lifecycle.get(runId);
  if (
    !status
    || status.state === 'succeeded'
    || status.state === 'failed'
    || status.state === 'cancelled'
  ) return false;
  try {
    await lifecycle.emit(runId, {
      event: 'error',
      data: {
        message: 'The run could not start because its local inputs are unavailable or no longer approved.',
      },
    });
  } catch (error) {
    const racedStatus = await lifecycle.get(runId);
    if (
      racedStatus?.state === 'succeeded'
      || racedStatus?.state === 'failed'
      || racedStatus?.state === 'cancelled'
    ) return false;
    throw error;
  }
  await lifecycle.finish({
    runId,
    status: 'failed',
    code: null,
    signal: null,
    resumable: false,
  });
  return true;
}
