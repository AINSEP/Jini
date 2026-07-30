import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BoundedDataError,
  readBoundedResponseJson,
  readBoundedResponseText,
  readPrivateBoundedUtf8File,
  readBoundedUtf8File,
  toStructurallyBoundedJsonValue,
  type JsonStructureLimits,
} from '../../src/bounded-data.js';
import { protectConnectorOutput } from '../../src/output-protection.js';

const temporaryDirectories: string[] = [];
const tinyLimits: JsonStructureLimits = {
  maxDepth: 2,
  maxNodes: 5,
  maxArrayItems: 2,
  maxObjectKeys: 2,
  maxStringBytes: 4,
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('bounded untrusted data helpers', () => {
  it('bounds response bodies before decoding or parsing', async () => {
    await expect(readBoundedResponseText(new Response(null), 4)).resolves.toBe('');
    await expect(readBoundedResponseText(new Response('safe'), 4)).resolves.toBe('safe');
    await expect(readBoundedResponseText(new Response('unsafe', {
      headers: { 'content-length': '6' },
    }), 4)).rejects.toBeInstanceOf(BoundedDataError);
    await expect(readBoundedResponseText(new Response('unsafe'), 4)).rejects.toThrow('exceeds');
    await expect(readBoundedResponseJson(new Response('{"ok":true}'), 32)).resolves.toEqual({ ok: true });
    await expect(readBoundedResponseJson(new Response('{bad-json'), 32)).rejects.toThrow('not valid JSON');
    await expect(readBoundedResponseJson(new Response(new Uint8Array([0xff])), 32)).rejects.toBeInstanceOf(TypeError);
  });

  it('bounds file reads even when the file exceeds the first read buffer', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jini-bounded-test-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'data.json');
    fs.writeFileSync(filePath, '{"ok":true}');
    expect(readBoundedUtf8File(filePath, 32)).toBe('{"ok":true}');
    expect(() => readBoundedUtf8File(filePath, 4)).toThrow('exceeds');
  });

  it('rejects a non-regular private path before reading secret data', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jini-bounded-private-test-'));
    temporaryDirectories.push(directory);

    expect(() => readPrivateBoundedUtf8File(directory, 32)).toThrow(
      'Secret JSON path must be a regular file',
    );
  });

  it('rejects cycles, unsupported values, and every structural limit', () => {
    expect(toStructurallyBoundedJsonValue({ ok: [true, 1] }, {
      ...tinyLimits,
      maxNodes: 10,
    })).toEqual({ ok: [true, 1] });
    expect(() => toStructurallyBoundedJsonValue(Number.POSITIVE_INFINITY, tinyLimits)).toThrow('non-finite');
    expect(() => toStructurallyBoundedJsonValue(undefined, tinyLimits)).toThrow('unsupported');
    expect(() => toStructurallyBoundedJsonValue('unsafe', tinyLimits)).toThrow('string');
    expect(() => toStructurallyBoundedJsonValue([1, 2, 3], tinyLimits)).toThrow('array');
    expect(() => toStructurallyBoundedJsonValue({ one: 1, two: 2, three: 3 }, tinyLimits)).toThrow('object');
    expect(() => toStructurallyBoundedJsonValue({ one: { two: { three: true } } }, tinyLimits)).toThrow('depth');
    expect(() => toStructurallyBoundedJsonValue({ one: [1, 2], two: { value: true } }, tinyLimits)).toThrow('node');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => toStructurallyBoundedJsonValue(cyclic, tinyLimits)).toThrow('cycle');
  });

  it('preserves a literal __proto__ JSON key without changing the clone prototype', () => {
    const input = JSON.parse('{"__proto__":{"polluted":"local"},"safe":1}') as Record<string, unknown>;
    const output = toStructurallyBoundedJsonValue(input) as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(output, '__proto__')).toBe(true);
    expect(output.__proto__).toEqual({ polluted: 'local' });
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);

    const protectedOutput = protectConnectorOutput(input as never).output as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(protectedOutput, '__proto__')).toBe(true);
    expect(protectedOutput.__proto__).toEqual({ polluted: 'local' });
    expect(Object.getPrototypeOf(protectedOutput)).toBe(Object.prototype);
  });

  it('maps structural output failures to the public output error', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => protectConnectorOutput(cyclic as never)).toThrow('structural safety limits');
    expect(() => protectConnectorOutput('x'.repeat(256 * 1024))).toThrow('max serialized size');
    expect(protectConnectorOutput([
      { token: 'secret' },
      { safe: 'visible' },
    ])).toMatchObject({
      redacted: true,
      output: [
        { token: '[redacted]' },
        { safe: 'visible' },
      ],
    });
  });

  it('redacts exact bearer, pwd, passphrase, and pat secret keys', () => {
    expect(protectConnectorOutput({
      bearer: 'bearer-secret',
      pwd: 'password-secret',
      passphrase: 'passphrase-secret',
      pat: 'personal-access-token',
      safe: 'visible',
    })).toMatchObject({
      redacted: true,
      output: {
        bearer: '[redacted]',
        pwd: '[redacted]',
        passphrase: '[redacted]',
        pat: '[redacted]',
        safe: 'visible',
      },
    });
  });
});
