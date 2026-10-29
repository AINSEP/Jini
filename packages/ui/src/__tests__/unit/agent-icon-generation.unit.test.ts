import { basename } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ readdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn() }));
vi.mock('node:fs', () => io);
const generator = '../../../scripts/generate-agent-icon-data-uris.mjs';
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); vi.resetModules(); });

it('generates deterministic inline SVG and PNG bytes while excluding unsupported assets', async () => {
  const svg = Buffer.from('<svg>fixture</svg>'), png = Buffer.from([0, 255, 137, 80]);
  io.readdirSync.mockReturnValue(['zeta.png', 'notes.txt', 'alpha.svg', 'UPPER.SVG']);
  io.readFileSync.mockImplementation((path: string) => ({ 'alpha.svg': svg, 'zeta.png': png })[basename(path)]);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await import(generator);
  expect(io.readFileSync.mock.calls.map(([path]) => basename(path))).toEqual(['alpha.svg', 'zeta.png']);
  expect(io.writeFileSync).toHaveBeenCalledTimes(1);
  const [path, generated] = io.writeFileSync.mock.calls[0]!;
  expect(basename(path)).toBe('agent-icon-data-uris.generated.ts');
  expect(generated.slice(generated.indexOf('export const'))).toBe(`export const AGENT_ICON_DATA_URIS: Record<string, string> = {\n  "alpha": "data:image/svg+xml;base64,${svg.toString('base64')}",\n  "zeta": "data:image/png;base64,${png.toString('base64')}",\n};\n`);
  expect(log).toHaveBeenCalledWith(`Generated 2 agent icon data URIs -> ${path}`);
});

it('generates an empty map when there are no supported icons', async () => {
  io.readdirSync.mockReturnValue(['readme.md']);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await import(generator);
  expect(io.readFileSync).not.toHaveBeenCalled();
  expect(io.writeFileSync.mock.calls[0]![1]).toContain('export const AGENT_ICON_DATA_URIS: Record<string, string> = {\n\n};');
});
