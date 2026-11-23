import { describe, expect, it } from 'vitest';
import { INTROSPECTION_FORMATS, printIntrospection, toMcpTools, type CliManifest } from '../introspection.js';

const manifest: CliManifest = {
  name: 'demo',
  description: 'demo cli',
  commands: [{
    name: 'site init',
    description: 'init a site',
    arguments: [{ name: 'dir', required: true, description: 'target dir' }],
    options: [{ flags: '--name <name>', attributeName: 'name', description: 'display name', required: false, takesValue: true }],
  }],
};

class HostValidationError extends Error {}

function ports() {
  const out: string[] = [];
  return {
    out,
    output: ({ message }: { message: string }) => { out.push(message); },
    invalid: ({ message }: { message: string }) => new HostValidationError(message),
  };
}

describe('printIntrospection', () => {
  it('offers exactly the commander and mcp formats', () => {
    expect(INTROSPECTION_FORMATS).toEqual(['commander', 'mcp']);
  });

  it('commander format prints the manifest as 2-space JSON plus newline', () => {
    const io = ports();
    printIntrospection({ manifest, format: 'commander', toolNamePrefix: 'demo_', output: io.output, invalid: io.invalid });
    expect(io.out).toEqual([`${JSON.stringify(manifest, null, 2)}\n`]);
  });

  it('mcp format prints toMcpTools(manifest, prefix)', () => {
    const io = ports();
    printIntrospection({ manifest, format: 'mcp', toolNamePrefix: 'demo_', output: io.output, invalid: io.invalid });
    expect(io.out).toEqual([`${JSON.stringify(toMcpTools({ manifest, toolNamePrefix: 'demo_' }), null, 2)}\n`]);
    expect(JSON.parse(io.out[0]!).map((tool: { name: string }) => tool.name)).toEqual(['demo_site_init']);
  });

  it('format defaults to commander', () => {
    const io = ports();
    printIntrospection({ manifest, toolNamePrefix: 'demo_', output: io.output, invalid: io.invalid });
    expect(io.out).toEqual([`${JSON.stringify(manifest, null, 2)}\n`]);
  });

  it('unknown format calls invalid with the exact message and prints nothing', () => {
    const io = ports();
    expect(() => printIntrospection({ manifest, format: 'yaml', toolNamePrefix: 'demo_', output: io.output, invalid: io.invalid }))
      .toThrow(new HostValidationError('--format must be one of: commander, mcp (got "yaml")'));
    expect(io.out).toEqual([]);
  });

  it('the thrown error is the host-minted instance', () => {
    const io = ports();
    let thrown: unknown;
    try {
      printIntrospection({ manifest, format: 'xml', toolNamePrefix: 'demo_', output: io.output, invalid: io.invalid });
    } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(HostValidationError);
  });
});
