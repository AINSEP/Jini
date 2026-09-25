import { useState } from 'react';
import { McpUiHost } from '@jini-ai/ui/mcp-ui';
import { buildConfirmationSurface, buildFormSurface } from '@jini-ai/ui/mcp-ui/surfaces';

/**
 * A plain React page, served at `/#/mcpui-official-swap-lab`.
 *
 * Real-browser verification for the 2026-08-18 swap from the hand-rolled `McpUiHost`/`useMcpUiHost`
 * to the official `@mcp-ui/client` `AppRenderer` — see `@jini-ai/ui`'s `useMcpUiHost.ts` module doc
 * for the full picture. This page exercises the same protocol path as Tovu's two real production
 * callers, end to end, against a REAL sandbox proxy page (`public/sandbox_proxy.html`) served by
 * this app's own dev server — not a mock, not jsdom:
 *
 * 1. A confirmation surface shaped exactly like Tovu's `content_post_delete` (danger-styled affirm
 *    button, a cancel, a warning) — `buildConfirmationSurface`, completely unmodified by this swap.
 * 2. A form surface shaped exactly like Tovu's `assistant_demo_choices` dev tool (an enum field
 *    presented as radios, plus a multi-enum checklist) — `buildFormSurface`, also unmodified.
 *
 * Both resources render through the SAME `McpUiHost` this page imports from `@jini-ai/ui/mcp-ui` —
 * the real one, backed by `AppRenderer` — with a mock `onToolCall` shaped like Tovu's actual
 * `/api/admin/v1/mcp-ui/tool-calls` redemption route (`{ delivered: true }`, per
 * `packages/ui/src/features/mcp-ui/surfaces/outcome.ts`'s own documented wire shape for that
 * endpoint), so this proves the full round trip: server-generated HTML → real sandboxed iframe →
 * real JSON-RPC handshake → a real button click → a real `tools/call` → this page's handler →
 * the surface's own script updating its visible status text.
 */
export function McpUiOfficialSwapLab() {
  const sandboxProxyUrl = new URL('/sandbox_proxy.html', globalThis.location.href);

  const [confirmLog, setConfirmLog] = useState<string[]>([]);
  const [formLog, setFormLog] = useState<string[]>([]);

  const confirmResource = buildConfirmationSurface({
    uri: 'ui://lab/content-post-delete/demo-1',
    title: 'Delete this post?',
    description: 'This mirrors Tovu\'s real content_post_delete confirmation surface.',
    details: [{ label: 'Post', value: '"Q3 roadmap" (id: post_42)' }],
    warning: 'This cannot be undone.',
    danger: true,
    confirm: { label: 'Delete', toolName: 'content_post_delete', params: { postId: 'post_42', confirmationToken: 'demo-token' } },
    cancel: { label: 'Cancel' },
  });

  const formResource = buildFormSurface({
    uri: 'ui://lab/assistant-demo-choices/demo-1',
    title: 'assistant_demo_choices',
    description: 'A radio group and a checklist — the exact shape Tovu\'s real assistant_demo_choices dev tool renders.',
    fields: [
      {
        kind: 'enum',
        name: 'mode',
        label: 'Mode',
        presentation: 'radio',
        required: true,
        options: [
          { value: 'draft', label: 'Draft' },
          { value: 'review', label: 'Review' },
          { value: 'publish', label: 'Publish' },
        ],
      },
      {
        kind: 'multi-enum',
        name: 'channels',
        label: 'Channels',
        options: [
          { value: 'email', label: 'Email' },
          { value: 'slack', label: 'Slack' },
          { value: 'sms', label: 'SMS' },
        ],
      },
    ],
    submitLabel: 'Submit',
    toolName: 'assistant_demo_choices',
    cancel: { label: 'Cancel' },
  });

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', display: 'grid', gap: 32, gridTemplateColumns: '1fr 1fr' }}>
      <section>
        <h2>content_post_delete (confirmation)</h2>
        <McpUiHost
          title={confirmResource.resource.uri}
          html={confirmResource.resource.text}
          sandboxProxyUrl={sandboxProxyUrl}
          toolName="content_post_delete"
          onToolCall={async (call) => {
            setConfirmLog((log) => [...log, `tools/call ${call.name} ${JSON.stringify(call.arguments)}`]);
            return { delivered: true };
          }}
        />
        <pre data-testid="confirm-log">{confirmLog.join('\n')}</pre>
      </section>
      <section>
        <h2>assistant_demo_choices (form)</h2>
        <McpUiHost
          title={formResource.resource.uri}
          html={formResource.resource.text}
          sandboxProxyUrl={sandboxProxyUrl}
          toolName="assistant_demo_choices"
          onToolCall={async (call) => {
            setFormLog((log) => [...log, `tools/call ${call.name} ${JSON.stringify(call.arguments)}`]);
            return { delivered: true };
          }}
        />
        <pre data-testid="form-log">{formLog.join('\n')}</pre>
      </section>
    </div>
  );
}
