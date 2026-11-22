import { describe, expect, it } from 'vitest';
import { assertNoConfigInjection } from '../index.js';

class HostError extends Error {
  constructor(required: { message: string }) { super(required.message); this.name = 'HostError'; }
}
const fail = (required: { message: string }): Error => new HostError(required);
const guard = (value: string): void => assertNoConfigInjection({ fieldLabel: 'field', value, fail });
const QUOTE = (value: string) => `field (${JSON.stringify(value)}) contains a quote or newline character, which would corrupt the generated config file`;
const YAML = (value: string) => `field (${JSON.stringify(value)}) contains a YAML-significant character (one of : # { [ & *), which would corrupt an unquoted YAML scalar in the generated config file`;
const EDGE = (value: string) => `field (${JSON.stringify(value)}) starts with "-" or has leading/trailing whitespace, which would corrupt an unquoted YAML scalar in the generated config file`;

describe('assertNoConfigInjection', () => {
  // One case per clause: removing any single character from a list, or either edge clause, turns exactly one case red.
  it.each([['"'], ['\n'], ['\r']])('a quote or newline character %j alone is refused as quoted-sink corruption', (char) => {
    expect(() => guard(`a${char}b`)).toThrow(new HostError({ message: QUOTE(`a${char}b`) }));
  });
  it.each([[':'], ['#'], ['{'], ['['], ['&'], ['*']])('the YAML-significant character %s alone is refused as plain-scalar corruption', (char) => {
    expect(() => guard(`a${char}b`)).toThrow(new HostError({ message: YAML(`a${char}b`) }));
  });
  it.each([['-evil', 'a leading hyphen'], [' evil', 'a leading space'], ['evil ', 'a trailing space']])('%j is refused for %s', (value) => {
    expect(() => guard(value)).toThrow(new HostError({ message: EDGE(value) }));
  });
  it.each([['acme-app_1'], ['a.b/c'], ['letters123'], ['inner-hyphen'], ['UPPER_and.dots/ok']])('the safe value %j is accepted', (value) => {
    expect(() => guard(value)).not.toThrow();
  });
  it('throws exactly what the host builds, built from the one message', () => {
    const seen: string[] = [];
    const error = new Error('host-built');
    expect(() => assertNoConfigInjection({ fieldLabel: 'f', value: 'x"y', fail: ({ message }) => { seen.push(message); return error; } })).toThrow(error);
    expect(seen).toEqual([QUOTE('x"y').replace('field', 'f')]);
  });
});
