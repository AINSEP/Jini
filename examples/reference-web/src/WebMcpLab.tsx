import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '@jini-ai/chat-core';
import { ChatFab, ChatPane, createFrontendSessionBridge, type FrontendSessionBridge } from '@jini-ai/chat-react';
import {
  findCapabilityInputError,
  toWebMcpTool,
  toWebMcpTools,
  type CapabilityDef,
  type WebMcpUserInteraction,
} from '@jini-ai/agentic';
import { getAgentModelContext } from '@jini-ai/agentic/dom';
import { uploadChatAttachments } from './attachments.js';
import { createDaemonChatTransport } from './daemon-transport.js';
import { PLAYGROUND_RUNTIME_ACCESS } from './runtime-access.js';
import { installWebMcpLabPolyfill } from './webmcp-lab-polyfill.js';
import { WEBMCP_LAB_CAPABILITIES } from './webmcp-lab-capabilities.js';

/**
 * `#/webmcp-lab` — a real-browser stress-test fixture for `@jini-ai/agentic`'s `webmcp.ts`, proven
 * against the REAL imperative `document.modelContext.registerTool()` API (via
 * `webmcp-lab-polyfill.ts`, since this Chromium build has no native WebMCP), not the
 * `data-agent-*` declarative convention `AgentLab.tsx` proves `page.*` against.
 *
 * Every `webmcp.*` capability here is reachable through TWO independent paths at once — see
 * `webmcp-lab-capabilities.ts`'s module doc for the full architecture:
 *
 * 1. Real WebMCP: registered on `document.modelContext` via `toWebMcpTool`/`toWebMcpTools`.
 * 2. Jini's daemon relay: claimed by `createFrontendSessionBridge`'s `executors` option, keyed on
 *    the `'webmcp.'` prefix, so a real coding-agent subprocess (this environment's actual agent —
 *    it has no browser, so path 1 is unreachable to it) can call them via `execute_delegated_tool`
 *    the same way `AgentLab.tsx` proves `page.*`/`chat.*` work.
 *
 * Four registrations, deliberately different shapes:
 *
 * - `webmcp.list_notes` — read, no confirmation.
 * - `webmcp.add_note` — write, no confirmation, one required field.
 * - `webmcp.clear_notes` — write, `requiresConfirmation: true` — the confirmation banner below is
 *   Jini's OWN gate (`toWebMcpTool`'s `requestUserInteraction`), not a browser mechanism; see
 *   `webmcp.ts`'s module doc for why the spec defines no such thing.
 * - `webmcp.log_event` — registered RAW, bypassing `toWebMcpTool`/`CapabilityDef` entirely, with a
 *   genuinely nested `inputSchema`. `CapabilityDef.inputSchema` is intentionally flat
 *   (`capability.ts`: "these schemas are flat by construction"), so this is the one tool on the
 *   page that could not have come from Jini's own capability vocabulary — proof the real spec's
 *   `inputSchema` (arbitrary `object`) accepts depth Jini's projection does not attempt to model,
 *   and that page-native and Jini-backed WebMCP tools coexist on one `document.modelContext`.
 *
 * Plus an ephemeral, signal-scoped registration a person can toggle on and off from the page
 * (`webmcp.ping_ephemeral`) to exercise the spec's ONLY unregistration mechanism live, and a
 * "register late" control for testing whether a tool added mid-session is picked up.
 *
 * The rest of the adversarial matrix (double-registration, an invalid tool name, `execute()` that
 * throws/rejects/hangs, concurrent calls, unregistering mid-call, a confirmation handler that never
 * answers) is deliberately NOT built as page UI — an LLM will not reliably stumble into most of
 * those, so they are driven directly against the live `document.modelContext` via
 * `browser_evaluate` instead. See this session's report for what each one found.
 */

interface PendingConfirmation {
  readonly id: string;
  readonly interaction: WebMcpUserInteraction;
  readonly resolve: (approved: boolean) => void;
}

const MAX_LOG_LINES = 200;

const LOG_EVENT_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    event: {
      type: 'object',
      description: 'A structured event to record.',
      properties: {
        kind: { type: 'string', description: 'What happened.' },
        payload: {
          type: 'object',
          description: 'Arbitrary nested detail — proves the real spec accepts depth CapabilityDef cannot express.',
          properties: {
            severity: { type: 'string', enum: ['info', 'warn', 'error'] },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      required: ['kind'],
    },
  },
  required: ['event'],
} as const;

const WEBMCP_LAB_CHAT_TRANSPORT = createDaemonChatTransport();

const WEBMCP_LAB_INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'webmcp-lab-welcome',
    role: 'assistant',
    content:
      'This page registers its tools imperatively on `document.modelContext` — the real WebMCP '
      + 'API — via `@jini-ai/agentic`\'s `toWebMcpTool`, polyfilled for this browser. Ask me to list, '
      + 'add, or clear notes.',
    runStatus: 'succeeded',
    createdAt: Date.now(),
  },
];

export function WebMcpLab() {
  const [notes, setNotes] = useState<string[]>(['Say hello to the WebMCP lab.']);
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingConfirmation[]>([]);
  const [registeredTools, setRegisteredTools] = useState<string[]>([]);
  const [ephemeralOn, setEphemeralOn] = useState(false);
  const [lateToolOn, setLateToolOn] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const bridgeRef = useRef<FrontendSessionBridge | null>(null);
  const ephemeralControllerRef = useRef<AbortController | null>(null);
  const lateToolControllerRef = useRef<AbortController | null>(null);
  const pendingCounter = useRef(0);

  const appendLog = (line: string) => {
    setEventLog((current) => [...current.slice(-(MAX_LOG_LINES - 1)), `${new Date().toISOString().slice(11, 23)}  ${line}`]);
  };

  /**
   * The one action function behind every `webmcp.*` capability — shared by the WebMCP path
   * (wrapped by `toWebMcpTool`, which already ran schema validation before calling this) and the
   * daemon-relay `executors` path below (which does NOT: `createFrontendCapabilityRegistrations`
   * carries `inputSchema` for discovery only, per its own module doc — nothing server-side
   * validates a call against it before relaying to the page). Checking here too, rather than
   * trusting the WebMCP wrapper's check to cover both paths, is the same defense-in-depth
   * `page-executor.ts` applies for `page.*`.
   */
  const executeWebMcpLabCapability = async (id: string, args: Record<string, unknown>): Promise<unknown> => {
    const capability = WEBMCP_LAB_CAPABILITIES.find((entry) => entry.id === id);
    if (capability === undefined) throw new Error(`unknown webmcp lab capability: ${id}`);
    const inputError = findCapabilityInputError(capability, args);
    if (inputError !== null) {
      throw new Error(`${id}: ${inputError}. Expected input: ${JSON.stringify(capability.inputSchema)}`);
    }

    switch (id) {
      case 'webmcp.list_notes':
        appendLog(`list_notes → ${notesRef.current.length} note(s)`);
        return { notes: notesRef.current };
      case 'webmcp.add_note': {
        const text = args['text'] as string;
        setNotes((current) => [...current, text]);
        appendLog(`add_note "${text}"`);
        return { added: text };
      }
      case 'webmcp.clear_notes':
        setNotes([]);
        appendLog('clear_notes → cleared');
        return { cleared: true };
      default:
        throw new Error(`unhandled webmcp lab capability: ${id}`);
    }
  };

  const askForConfirmation = (interaction: WebMcpUserInteraction): Promise<boolean> => {
    pendingCounter.current += 1;
    const id = `confirm-${pendingCounter.current}`;
    appendLog(`confirmation requested for "${interaction.capability.id}"`);
    return new Promise<boolean>((resolve) => {
      setPending((current) => [...current, { id, interaction, resolve }]);
    });
  };

  const settlePending = (id: string, approved: boolean) => {
    setPending((current) => {
      const found = current.find((entry) => entry.id === id);
      found?.resolve(approved);
      appendLog(`confirmation ${id} ${approved ? 'approved' : 'declined'}`);
      return current.filter((entry) => entry.id !== id);
    });
  };

  const refreshRegisteredTools = async () => {
    const raw = (globalThis as { document?: { modelContext?: { getTools?: () => Promise<Array<{ name: string }>> } } })
      .document?.modelContext;
    if (raw?.getTools === undefined) return;
    const tools = await raw.getTools();
    setRegisteredTools(tools.map((tool) => tool.name).sort());
  };

  // Registers the manifest (list_notes/add_note/clear_notes) plus the raw, deeply-nested
  // log_event tool that cannot be expressed as a CapabilityDef. One shared AbortController: this
  // whole batch unregisters together when the page leaves, exactly as a real page's teardown would.
  useEffect(() => {
    installWebMcpLabPolyfill();
    const modelContext = getAgentModelContext();
    if (!modelContext) {
      appendLog('document.modelContext is unavailable even after installing the polyfill — nothing registered.');
      return;
    }

    const controller = new AbortController();
    const registrations = toWebMcpTools(WEBMCP_LAB_CAPABILITIES, executeWebMcpLabCapability, {
      requestUserInteraction: askForConfirmation,
      signal: controller.signal,
    });
    for (const registration of registrations) {
      void modelContext
        .registerTool(registration, registration.registerOptions)
        .then(() => appendLog(`registered "${registration.name}"`))
        .catch((error: unknown) => appendLog(`FAILED to register "${registration.name}": ${String(error)}`));
    }

    // Raw registration — deliberately bypasses toWebMcpTool/CapabilityDef. See module doc.
    void modelContext
      .registerTool(
        {
          name: 'webmcp.log_event',
          title: 'Log a structured event',
          description: 'Records one structured, arbitrarily nested event. Not backed by a Jini capability.',
          inputSchema: LOG_EVENT_INPUT_SCHEMA,
          execute: async (args: Record<string, unknown>) => {
            appendLog(`log_event ${JSON.stringify(args)}`);
            return { logged: true };
          },
        },
        { signal: controller.signal },
      )
      .then(() => appendLog('registered "webmcp.log_event" (raw, nested schema)'))
      .catch((error: unknown) => appendLog(`FAILED to register "webmcp.log_event": ${String(error)}`));

    void refreshRegisteredTools();
    const rawForEvents = (globalThis as { document?: { modelContext?: EventTarget } }).document?.modelContext;
    const onToolChange = () => void refreshRegisteredTools();
    rawForEvents?.addEventListener?.('toolchange', onToolChange);

    return () => {
      controller.abort();
      rawForEvents?.removeEventListener?.('toolchange', onToolChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The daemon-relay half: claims the whole `webmcp.` prefix, so a real agent run (bound to this
  // tab via runContext below) reaches the exact same executeWebMcpLabCapability function above.
  useEffect(() => {
    const session = createFrontendSessionBridge({
      executors: { 'webmcp.': executeWebMcpLabCapability },
      onInvocation: (action) => appendLog(`daemon → ${action.capabilityId}`),
      onError: (error) => appendLog(`bridge error: ${String(error)}`),
    });
    session.ready.catch((error: unknown) => appendLog(`bridge never attached: ${String(error)}`));
    bridgeRef.current = session;
    // Test-only diagnostic hook (this whole page is a stress-test fixture, not a product surface —
    // see the module doc): exposes the live bind token and a manual tool-list refresh so an
    // out-of-band script (this session's `browser_evaluate`-driven adversarial tests) can start a
    // real daemon run bound to this exact tab without needing to click through the chat UI, and can
    // poll `document.modelContext.getTools()` state independent of React re-renders.
    (globalThis as unknown as { __webmcpLab?: unknown }).__webmcpLab = {
      bindToken: () => bridgeRef.current?.bindToken(),
      refreshRegisteredTools,
    };
    return () => {
      session.close();
      if (bridgeRef.current === session) bridgeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleEphemeral = () => {
    const modelContext = getAgentModelContext();
    if (!modelContext) return;
    if (ephemeralOn) {
      ephemeralControllerRef.current?.abort();
      ephemeralControllerRef.current = null;
      setEphemeralOn(false);
      appendLog('aborted signal for "webmcp.ping_ephemeral" — spec\'s only unregistration mechanism');
      void refreshRegisteredTools();
      return;
    }
    const controller = new AbortController();
    ephemeralControllerRef.current = controller;
    const ephemeralCapability: CapabilityDef = {
      id: 'webmcp.ping_ephemeral',
      description: 'A short-lived diagnostic tool, present only while this toggle is on.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      risk: 'read',
      surface: 'session',
    };
    const registration = toWebMcpTool(ephemeralCapability, async () => ({ pong: Date.now() }), {
      signal: controller.signal,
    });
    void modelContext
      .registerTool(registration, registration.registerOptions)
      .then(() => {
        appendLog('registered "webmcp.ping_ephemeral"');
        setEphemeralOn(true);
        void refreshRegisteredTools();
      })
      .catch((error: unknown) => appendLog(`FAILED to register "webmcp.ping_ephemeral": ${String(error)}`));
  };

  const toggleLateTool = () => {
    const modelContext = getAgentModelContext();
    if (!modelContext) return;
    if (lateToolOn) {
      lateToolControllerRef.current?.abort();
      lateToolControllerRef.current = null;
      setLateToolOn(false);
      void refreshRegisteredTools();
      return;
    }
    const controller = new AbortController();
    lateToolControllerRef.current = controller;
    const lateCapability: CapabilityDef = {
      id: 'webmcp.late_arrival',
      description: 'Registered after this page finished mounting — tests whether late registration is discoverable.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      risk: 'read',
      surface: 'session',
    };
    const registration = toWebMcpTool(lateCapability, async () => ({ arrived: true }), {
      signal: controller.signal,
    });
    void modelContext
      .registerTool(registration, registration.registerOptions)
      .then(() => {
        appendLog('registered "webmcp.late_arrival" (mid-session)');
        setLateToolOn(true);
        void refreshRegisteredTools();
      })
      .catch((error: unknown) => appendLog(`FAILED to register "webmcp.late_arrival": ${String(error)}`));
  };

  const runContext = useMemo(
    () => () => {
      const bindToken = bridgeRef.current?.bindToken();
      return {
        project: 'starter-site',
        ...(bindToken === undefined ? {} : { frontendBindToken: bindToken }),
      };
    },
    [],
  );

  return (
    <div className={`agent-lab-shell${chatOpen ? ' agent-lab-shell-open' : ''}`}>
      <main className="agent-lab">
        <header>
          <span className="eyebrow">Jini · WebMCP stress-test fixture</span>
          <h1>WebMCP lab</h1>
          <p>
            Tools here are registered with the real, imperative <code>document.modelContext.registerTool()</code>{' '}
            API (polyfilled — this Chromium build has none natively), projected through{' '}
            <code>@jini-ai/agentic</code>'s <code>toWebMcpTool</code>. They are also reachable through Jini's own
            daemon relay, the same path a real agent run uses.
          </p>
          <nav>
            <a href="#/">← Playground</a>
            <a href="#/agent-lab">Agent lab (page.* verbs) →</a>
          </nav>
        </header>

        {pending.length > 0 && (
          <fieldset>
            <legend>Pending WebMCP confirmation</legend>
            {pending.map((entry) => (
              <div className="input-row" key={entry.id}>
                <p>
                  <strong>{entry.interaction.capability.id}</strong> wants to run with{' '}
                  <code>{JSON.stringify(entry.interaction.args)}</code>
                </p>
                <button type="button" id={`approve-${entry.id}`} onClick={() => settlePending(entry.id, true)}>
                  Approve
                </button>
                <button type="button" id={`decline-${entry.id}`} onClick={() => settlePending(entry.id, false)}>
                  Decline
                </button>
              </div>
            ))}
          </fieldset>
        )}

        <section>
          <h2>Notebook</h2>
          <ul id="webmcp-lab-notes">
            {notes.length === 0 ? <li>(empty)</li> : notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}
          </ul>
        </section>

        <section>
          <h2>Registered WebMCP tools</h2>
          <div className="input-row">
            <button type="button" id="refresh-tools" onClick={() => void refreshRegisteredTools()}>
              Refresh
            </button>
            <button type="button" id="toggle-ephemeral" onClick={toggleEphemeral}>
              {ephemeralOn ? 'Unregister ephemeral tool (abort signal)' : 'Register ephemeral tool'}
            </button>
            <button type="button" id="toggle-late-tool" onClick={toggleLateTool}>
              {lateToolOn ? 'Unregister late tool' : 'Register late tool'}
            </button>
          </div>
          <ul id="webmcp-lab-registered-tools">
            {registeredTools.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Event log</h2>
          <ul id="webmcp-lab-log">
            {eventLog.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </section>
      </main>

      <aside className="agent-lab-chat" hidden={!chatOpen} aria-label="WebMCP lab chat">
        <ChatPane
          title="WebMCP lab"
          transport={WEBMCP_LAB_CHAT_TRANSPORT}
          runtimeAccess={PLAYGROUND_RUNTIME_ACCESS}
          initialMessages={WEBMCP_LAB_INITIAL_MESSAGES}
          initialSelection={{ agentId: 'claude' }}
          placeholder="Ask about the notebook…"
          uploadAttachments={uploadChatAttachments}
          initialWorkingDirectory="examples/reference-web"
          runContext={runContext}
        />
      </aside>

      <ChatFab open={chatOpen} onToggle={() => setChatOpen((current) => !current)} label="WebMCP lab chat" />
    </div>
  );
}
