import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import { deriveRunActivity, describeRunActivity, formatActivityClock, humanizeToolName, isAwaitingAnswer } from '../run-activity.js';

const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? key.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars[name])) : key;

function line(events: AgentEvent[], seconds = 0, idleMs = 0): string {
  return describeRunActivity({ activity: deriveRunActivity({ events: events }).activity, clock: { seconds, idleMs }, t: t });
}

describe('run activity line — one table, exact words', () => {
  it('says Thinking with a clock before anything arrives, and Still working after 20 s of nothing new', () => {
    expect(line([], 8)).toBe('Thinking… 8 s');
    expect(line([{ kind: 'status', label: 'initializing' }], 3)).toBe('Thinking… 3 s');
    expect(line([], 45, 20_000)).toBe('Still working… 45 s');
  });

  it('keeps showing after the first tool row finishes (thinking between steps)', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 't1', name: 'mcp__jini__search_tools', input: {} },
      { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
    ];
    expect(line(events, 12)).toBe('Thinking… 12 s');
  });

  it('says Finding the right tool while a discovery call is open', () => {
    expect(line([{ kind: 'tool_use', id: 't1', name: 'ToolSearch', input: {} }], 4)).toBe('Finding the right tool… 4 s');
    expect(line([{ kind: 'tool_use', id: 't2', name: 'mcp__jini__describe_tool', input: {} }], 2)).toBe('Finding the right tool… 2 s');
  });

  it('names the running tool, unwrapping the delegated-tool wrapper, with minutes', () => {
    const wrapper: AgentEvent = { kind: 'tool_use', id: 'w', name: 'mcp__jini__execute_delegated_tool', input: { toolId: 'content.post_create', input: {} } };
    expect(line([wrapper], 80)).toBe('Running Content Post Create… 1 m 20 s');
    expect(line([{ kind: 'tool_use', id: 'x', name: 'mcp__supabase__list_projects', input: {} }], 5)).toBe('Running List Projects… 5 s');
  });

  it('uses a tool_progress report when it is ahead of the local clock (tab joined mid-call)', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'x', name: 'page.fill', input: {} },
      { kind: 'status', label: 'tool_progress', code: 'tool_progress', data: { elapsedSeconds: 90 } },
    ];
    const state = deriveRunActivity({ events: events });
    expect(state.activity).toEqual({ kind: 'running-tool', tool: 'Page Fill', reportedSeconds: 90 });
  });

  // Demo dry-run 2026-10-05: a clock ticking under an open form read as a hung run. The run is
  // waiting on the person, not working, so the line says so with no running timer.
  it('says Waiting for your answer, with no clock, when a card arrives while its tool call is open', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w', name: 'mcp__jini__execute_delegated_tool', input: { toolId: 'assistant.ask_choice' } },
      { kind: 'ext', name: 'mcp-ui', data: {} },
    ];
    expect(line(events, 220)).toBe('Waiting for your answer above');
  });

  it('stays Waiting for your answer while tool_progress heartbeats and a slow-run notice arrive under the card', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w', name: 'mcp__jini__execute_delegated_tool', input: { toolId: 'source_control_propose_credential' } },
      { kind: 'tool_use', id: 'inner', name: 'source_control_propose_credential', input: {} },
      { kind: 'ext', name: 'mcp-ui', data: {} },
      { kind: 'status', label: 'tool_progress', code: 'tool_progress', data: { elapsedSeconds: 30 } },
      { kind: 'ext', name: 'slow_running', data: { type: 'slow_running' } },
    ];
    expect(isAwaitingAnswer({ events })).toBe(true);
    expect(line(events, 75)).toBe('Waiting for your answer above');
  });

  it('is not awaiting an answer once the card\'s tool call has returned', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'w', name: 'mcp__jini__execute_delegated_tool', input: {} },
      { kind: 'ext', name: 'mcp-ui', data: {} },
      { kind: 'tool_result', toolUseId: 'w', content: 'ok', isError: false },
    ];
    expect(isAwaitingAnswer({ events })).toBe(false);
  });

  // Demo V3 2026-10-05: assistant_render_ui holds its call open ~4 s after drawing a chart (to hear a
  // browser refusal), and the chart's a2ui events read as a question under it. A surface whose
  // createSurface declares displayOnly asks nothing, so the line keeps naming the running tool.
  it('is not awaiting an answer for a display-only a2ui surface under its still-open call', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'r', name: 'mcp__jini__execute_delegated_tool', input: { toolId: 'assistant_render_ui' } },
      { kind: 'ext', name: 'a2ui', data: { version: 'v1.0', createSurface: { surfaceId: 's1', catalogId: 'c', surfaceProperties: { displayOnly: true } } } },
      { kind: 'ext', name: 'a2ui', data: { version: 'v1.0', updateComponents: { surfaceId: 's1', components: [{ id: 'root', component: 'Text' }] } } },
    ];
    expect(isAwaitingAnswer({ events })).toBe(false);
    expect(line(events, 3)).toBe('Running Assistant Render Ui… 3 s');
  });

  it('still awaits an answer for an a2ui surface that does not declare displayOnly', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'd', name: 'mcp__jini__execute_delegated_tool', input: { toolId: 'assistant_demo_a2ui' } },
      { kind: 'ext', name: 'a2ui', data: { version: 'v1.0', createSurface: { surfaceId: 's1', catalogId: 'c', surfaceProperties: { displayOnly: true } } } },
      { kind: 'ext', name: 'a2ui', data: { version: 'v1.0', createSurface: { surfaceId: 's2', catalogId: 'c' } } },
      { kind: 'ext', name: 'a2ui', data: { version: 'v1.0', updateComponents: { surfaceId: 's2', components: [{ id: 'root', component: 'Button' }] } } },
    ];
    expect(isAwaitingAnswer({ events })).toBe(true);
    expect(line(events, 9)).toBe('Waiting for your answer above');
  });

  it('says the servers are busy with the attempt count while an API retry is the latest signal', () => {
    const events: AgentEvent[] = [
      { kind: 'text', text: 'Let me check.' },
      { kind: 'status', label: 'api_retry', code: 'api_retry', data: { attempt: 4, maxAttempts: 10, service: 'Claude' } },
    ];
    expect(line(events)).toBe("Claude's servers are busy — retrying (4 of 10)…");
    expect(line([{ kind: 'status', label: 'api_retry', code: 'api_retry' }])).toBe('The AI service is busy — retrying…');
    // Once words arrive again, the retry is over.
    expect(line([...events, { kind: 'text', text: ' Done.' }])).toBe('Writing…');
  });

  it('formats the clock', () => {
    expect(formatActivityClock({ totalSeconds: 0 })).toBe('0 s');
    expect(formatActivityClock({ totalSeconds: 59.9 })).toBe('59 s');
    expect(formatActivityClock({ totalSeconds: 120 })).toBe('2 m 0 s');
    expect(humanizeToolName({ name: 'daemon.db.vacuum' })).toBe('Daemon Db Vacuum');
  });

  it('names the real tool behind the read-only wrapper, not the wrapper itself', () => {
    expect(humanizeToolName({ name: 'mcp__jini__execute_readonly_delegated_tool' }, { input: { toolId: 'content_stats' } })).toBe('Content Stats');
    expect(humanizeToolName({ name: 'execute_readonly_delegated_tool' }, { input: { toolId: 'content_stats' } })).toBe('Content Stats');
  });

  it('restarts the clock key per signal and counts only visible events', () => {
    const a = deriveRunActivity({ events: [{ kind: 'tool_use', id: 't1', name: 'Bash', input: {} }] });
    const b = deriveRunActivity({ events: [
      { kind: 'tool_use', id: 't1', name: 'Bash', input: {} },
      { kind: 'raw', line: 'x' },
      { kind: 'status', label: 'thinking', code: 'thinking' },
    ] });
    expect(a.key).toBe('tool:t1');
    expect(b.key).toBe('tool:t1');
    expect(b.visibleCount).toBe(1);
  });
});
