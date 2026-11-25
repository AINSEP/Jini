import { describe, expect, it } from 'vitest';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import { opencodeAgentDef } from '../defs/opencode/index.js';
import { opencodeAcpAgentDef } from '../defs/opencode-acp/index.js';
import { claudeAgentDef } from '../defs/claude/index.js';
import { codebuddyAgentDef } from '../defs/codebuddy/index.js';
import { mimoAgentDef } from '../defs/mimo/index.js';
import { createNativeAgentRuntime } from '../native-runtime.js';
import { createAgentRuntimeBindings } from '../runtime-port-bindings.js';

/**
 * @file K03a pin: the Gemini-dialect and OpenCode-dialect receipts, and the env keys the daemon no longer imports,
 * reach the daemon only through the bound strategies. Fixtures carry distinct correlation values, so a receipt that
 * emits one generic id (or ignores the event it was given) cannot pass for both.
 */
const ports = () => createAgentRuntimeBindings({ runtime: createNativeAgentRuntime({ env: {} }) });
const forDialect = (eventParser: string) => ports().strategies.for({ def: { eventParser } as RuntimeAgentDef });

describe('tool-call receipts bound by dialect', () => {
  it.each([
    ['legacy-google-stream-json', 'theme_read_file', { path: 'a.md' }, { name: 'theme_read_file', input: { path: 'a.md' } }],
    ['legacy-google-stream-json', 'site_list_pages', { limit: 7 }, { name: 'site_list_pages', input: { limit: 7 } }],
    ['opencode', 'host_theme_read_file', { path: 'b.md' }, { name: 'theme_read_file', input: { path: 'b.md' }, buffered: true }],
    ['opencode', 'server_site_list_pages', { limit: 9 }, { name: 'site_list_pages', input: { limit: 9 }, buffered: true }],
  ])('%s: %s carries its own correlation candidate', (dialect, name, input, bridgeCall) => {
    const receipt = forDialect(dialect).toolCallReceipt!;
    const event = { type: 'tool_use', id: `id-${name}`, name, input };
    expect(receipt({ event })).toEqual({ ...event, bridgeCall });
  });

  it('leaves a bridge-named call, a non-tool event and a name with no server prefix unchanged', () => {
    const opencode = forDialect('opencode').toolCallReceipt!;
    const gemini = forDialect('legacy-google-stream-json').toolCallReceipt!;
    for (const event of [{ type: 'tool_use', name: 'mcp__srv__tool', input: {} }, { type: 'text', name: 'x_y' }]) {
      expect(opencode({ event })).toBe(event);
      expect(gemini({ event })).toBe(event);
    }
    const bare = { type: 'tool_use', name: 'native', input: {} };
    expect(opencode({ event: bare })).toBe(bare);
  });

  it('binds nothing for a dialect with no receipt or a def that declares none', () => {
    // Only the shared folder-limit policy is bound for every def; no receipt, delivery, bridge or staging slot appears.
    expect(forDialect('codex')).toEqual({ filesystem: { supported: expect.any(Function) } });
    expect(ports().strategies.for({ def: {} as RuntimeAgentDef })).toEqual({ filesystem: { supported: expect.any(Function) } });
  });
});

describe('bound plans keep the same config and executable env keys the daemon used to import', () => {
  it('names the MCP config variable per delivery strategy, including the ACP variant of OpenCode', () => {
    const var_ = (def: RuntimeAgentDef) => ports().strategies.for({ def }).mcpDelivery?.envContentVar;
    expect(var_(opencodeAgentDef)).toBe('OPENCODE_CONFIG_CONTENT');
    expect(var_(opencodeAcpAgentDef)).toBe('OPENCODE_CONFIG_CONTENT');
    expect(var_(mimoAgentDef)).toBe('MIMOCODE_CONFIG_CONTENT');
    expect(var_({ externalMcpInjection: 'acp-merge' } as RuntimeAgentDef)).toBeUndefined();
  });

  it('and still supplies the Vela executable override, the Claude config dir name and the Codex home name beside the runtime state names', () => {
    expect(ports().launch.hostEnvNames()).toEqual(['AGENT_RUNTIME_HOME', 'AGENT_RUNTIME_RESOURCE_ROOT', 'VELA_OPENCODE_BIN', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME']);
  });

  it('gives OpenCode and MiMo the receipt their shared dialect declares, bound from the def', () => {
    expect(mimoAgentDef.eventParser).toBe(opencodeAgentDef.eventParser);
    expect(ports().strategies.for({ def: mimoAgentDef }).toolCallReceipt).toBe(ports().strategies.for({ def: opencodeAgentDef }).toolCallReceipt);
  });
});

describe('claude staging slots bound by definition', () => {
  const slots = (def: RuntimeAgentDef) => ports().strategies.for({ def });

  it('binds the config dir, subagent-start and filesystem extras to claude alone', () => {
    const claude = slots(claudeAgentDef);
    expect(claude.configDir?.envKey).toBe('CLAUDE_CONFIG_DIR');
    expect(claude.subagentStart).toBeDefined();
    expect(claude.filesystem?.prepare).toBeDefined();
    expect(claude.filesystem?.unsupported).toBeDefined();
    const buddy = slots(codebuddyAgentDef);
    expect(buddy.configDir).toBeUndefined();
    expect(buddy.subagentStart).toBeUndefined();
    expect(buddy.filesystem?.prepare).toBeUndefined();
  });

  it('shares the claude-mcp-json config-file slot with every def declaring that strategy', () => {
    expect(slots(claudeAgentDef).mcpConfigFile).toBeDefined();
    expect(slots(codebuddyAgentDef).mcpConfigFile).toBe(slots(claudeAgentDef).mcpConfigFile);
    expect(slots({ externalMcpInjection: 'acp-merge' } as RuntimeAgentDef).mcpConfigFile).toBeUndefined();
  });
});
