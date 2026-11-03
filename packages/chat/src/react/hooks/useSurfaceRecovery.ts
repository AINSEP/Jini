import { useEffect, useRef, useState } from 'react';
import { parseUIResource, type McpUiToolCallHandler, type UIResource } from '@jini-ai/ui/mcp-ui';
import type { SurfaceEmission } from '@jini-ai/core';
import type { ExtEventCall } from '../ext-event-renderer-registry.js';
import type { RecoverableMcpUiToolCaller } from '../features/chat-pane/create-mcp-ui-tool-caller.js';
import { recoverableSurfaceResource, surfaceRecoveryInfo, SURFACE_EXCHANGE_META } from '../../core/surface-recovery.js';

/** Restore only an unanswered call: completed decisions must never execute twice. */
export function surfaceNeedsRecovery({ call, runStreaming }: { call: ExtEventCall | undefined; runStreaming: boolean }, _options = {}): boolean {
  if (!call) return false;
  if (!call.result) return !runStreaming;
  return call.result.isError || /\b(expired|abandoned|did not respond|run ended)\b/i.test(call.result.content);
}

function recoveryCaller(call: McpUiToolCallHandler | undefined): RecoverableMcpUiToolCaller | undefined {
  if (!call || !('restore' in call) || !('answer' in call)) return undefined;
  if (typeof call.restore !== 'function' || typeof call.answer !== 'function') return undefined;
  return call as RecoverableMcpUiToolCaller;
}

/** Nonvisual card lifecycle: mount/focus restores the server's original invocation; late clicks
 * use the same stream. A component owns its subscription and aborts it on teardown.
 * @complexity O(card document size) per emission; O(1) subscriptions per visible card.
 */
export function useSurfaceRecovery({ resource, call, runStreaming, onToolCall }: {
  resource: UIResource | undefined; call: ExtEventCall | undefined; runStreaming: boolean; onToolCall: McpUiToolCallHandler | undefined;
}, _options = {}) {
  const [restored, setRestored] = useState<UIResource>();
  const [live, setLive] = useState(false);
  const pending = useRef<AbortController | undefined>(undefined);
  const answerController = useRef<AbortController | undefined>(undefined);
  const completed = useRef(false);
  const info = surfaceRecoveryInfo({ value: resource?.resource._meta?.[SURFACE_EXCHANGE_META] });
  const caller = info ? recoveryCaller(onToolCall) : undefined;
  const needsRecovery = surfaceNeedsRecovery({ call, runStreaming });
  const onSurface = (emission: SurfaceEmission) => {
    if (emission.channel !== 'mcp-ui') return;
    const next = parseUIResource(recoverableSurfaceResource({ resource: emission.payload['resource'], exchange: emission.payload['surfaceExchange'] }));
    if (next) { setRestored(next); setLive(true); }
  };
  useEffect(() => {
    if (!caller || !info || !needsRecovery) return;
    let disposed = false;
    const restore = () => {
      if (pending.current || disposed || completed.current) return;
      const controller = new AbortController();
      pending.current = controller;
      void caller.restore({ ...info, signal: controller.signal, onSurface: emission => { if (!disposed) onSurface(emission); } })
        .then(() => { if (!disposed) completed.current = true; })
        .catch(() => { /* Original closed-card state stays authoritative if recovery is unavailable. */ })
        .finally(() => { if (!disposed) { pending.current = undefined; setLive(false); } });
    };
    restore();
    window.addEventListener('focus', restore);
    return () => {
      disposed = true;
      window.removeEventListener('focus', restore);
      pending.current?.abort(); pending.current = undefined;
      answerController.current?.abort(); answerController.current = undefined;
    };
  }, [caller, info?.exchangeId, needsRecovery]);
  useEffect(() => () => answerController.current?.abort(), []);
  const toolCall: McpUiToolCallHandler | undefined = caller ? async submitted => {
    const controller = new AbortController();
    answerController.current = controller;
    try {
      return await caller.answer({ call: submitted, signal: controller.signal, onSurface });
    } finally { answerController.current = undefined; }
  } : onToolCall;
  return { resource: restored ?? resource, restored: restored !== undefined, live, onToolCall: toolCall };
}
