import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPluginRow } from '../components/AgentPluginRow.js';
import type { AgentPluginRowView } from '../hooks/AgentPluginPanel.hooks.js';

afterEach(cleanup);
function rowView(overrides: Partial<AgentPluginRowView> = {}): AgentPluginRowView {
  return { id: 'ui-ux-design', name: 'UI UX Design', version: '1.0.0', description: 'Design interfaces', glyph: '◇', enabled: false, stateLabel: 'Disabled', busy: false, expanded: false, mode: 'installed', canWrite: true,
    toggleLabel: 'Enable UI UX Design', actionLabel: 'Enable UI UX Design', actionText: 'Enable', skills: [{ name: 'design', summary: 'A design skill' }], keywords: ['UI'], servers: ['design-api'], hasSkills: true, hasKeywords: true, hasServers: true,
    toggle: vi.fn(), act: vi.fn(), expand: vi.fn(), inspect: vi.fn(),
    expandAttrs: { 'aria-label': 'Expand UI UX Design', 'aria-expanded': false, 'data-agent-handle': 'agent-plugin-ui-ux-design-expand' },
    actionAttrs: { 'aria-label': 'Enable UI UX Design', 'data-agent-handle': 'agent-plugin-ui-ux-design-activation' },
    inspectAttrs: { 'data-agent-handle': 'agent-plugin-ui-ux-design-inspect' }, uninstallAttrs: { 'aria-describedby': 'note' },
    inspectLabel: 'Inspect UI UX Design package files', uninstallLabel: 'Uninstall UI UX Design — unavailable', ...overrides };
}
describe('AgentPluginRow', () => {
  it('renders the version and description when present', () => { const { container } = render(<AgentPluginRow row={rowView()} />); expect(container.querySelector('h3 small')?.textContent).toBe('1.0.0'); expect(container.querySelectorAll('p')[0]?.textContent).toBe('Design interfaces'); });
  it('omits the version and description when absent', () => { const { container } = render(<AgentPluginRow row={rowView({ version: null, description: null })} />); expect(container.querySelector('h3 small')).toBeNull(); expect(container.querySelector('[data-jini-part="agent-plugins.row"] > p')).toBeNull(); expect(container.querySelector('div[id] > p')).toBeNull(); });
  it('shows a switch for installed rows that calls toggle', () => { const toggle = vi.fn(); render(<AgentPluginRow row={rowView({ toggle })} />); fireEvent.click(screen.getByRole('switch', { name: 'Enable UI UX Design' })); expect(toggle).toHaveBeenCalledTimes(1); });
  it('disables the installed switch without write permission', () => { render(<AgentPluginRow row={rowView({ canWrite: false })} />); expect(screen.getByRole('switch', { name: 'Enable UI UX Design' })).toHaveProperty('disabled', true); });
  it('disables the installed switch while busy', () => { render(<AgentPluginRow row={rowView({ busy: true })} />); expect(screen.getByRole('switch', { name: 'Enable UI UX Design' })).toHaveProperty('disabled', true); });
  it('shows an action button for downloaded rows that calls act', () => { const act = vi.fn(); render(<AgentPluginRow row={rowView({ mode: 'downloaded', act })} />); expect(screen.queryByRole('switch')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Enable UI UX Design' })); expect(act).toHaveBeenCalledTimes(1); });
  it('disables the downloaded action without write permission', () => { render(<AgentPluginRow row={rowView({ mode: 'downloaded', canWrite: false })} />); expect(screen.getByRole('button', { name: 'Enable UI UX Design' })).toHaveProperty('disabled', true); });
  it('lists skills, servers and keywords in the details section', () => { render(<AgentPluginRow row={rowView({ expanded: true })} />); expect(screen.getByRole('region', { name: 'Portable components' }).textContent).toContain('design'); expect(screen.getByRole('region', { name: 'MCP servers' }).textContent).toBe('MCP serversdesign-api'); expect(screen.getByRole('region', { name: 'Keywords' }).textContent).toBe('KeywordsUI'); });
  it('omits empty detail sections and hides collapsed details', () => { const { container } = render(<AgentPluginRow row={rowView({ hasSkills: false, hasServers: false, hasKeywords: false })} />); expect(container.querySelectorAll('section')).toHaveLength(0); expect(container.querySelector('div[hidden]')).not.toBeNull(); });
  it('wires the details button to the details section', () => { const expand = vi.fn(); const { container } = render(<AgentPluginRow row={rowView({ expand })} />); const button = screen.getByRole('button', { name: 'Expand UI UX Design' }); fireEvent.click(button); expect(expand).toHaveBeenCalledTimes(1); expect(container.querySelector(`#${CSS.escape(button.getAttribute('aria-controls')!)}`)).not.toBeNull(); });
});
