import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { PayloadTooLargeError } from '../prompt.js';
import { readQuietLine } from '../quiet-line.js';

function sink() {
  let text = '';
  return { stream: { write: (chunk: string) => { text += chunk; return true; } }, text: () => text };
}

describe('readQuietLine', () => {
  it('returns the first piped CRLF line and prints nothing', async () => {
    const input = new PassThrough();
    const out = sink();
    const reading = readQuietLine({ input, output: out.stream, prompt: 'secret: ' });
    input.end('secret-value\r\nsecond line ignored\n');
    await expect(reading).resolves.toBe('secret-value');
    expect(out.text()).toBe('');
  });

  it('returns piped text without a newline and accepts empty input', async () => {
    const input = new PassThrough();
    const reading = readQuietLine({ input, output: sink().stream, prompt: 'secret: ' });
    input.end('secret-value');
    await expect(reading).resolves.toBe('secret-value');
    const empty = new PassThrough();
    const none = readQuietLine({ input: empty, output: sink().stream, prompt: 'secret: ' });
    empty.end();
    await expect(none).resolves.toBe('');
  });

  it('prompts a terminal once without echo and closes the prompt line', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const out = sink();
    const prompt = 'secret: ';
    const reading = readQuietLine({ input, output: out.stream, prompt });
    input.write('typed-secret\n');
    await expect(reading).resolves.toBe('typed-secret');
    expect(out.text()).toBe(`${prompt}\n`);
    input.destroy();
  });

  it('rejects piped input over the byte cap even after its first line', async () => {
    const input = new PassThrough();
    const out = sink();
    const reading = readQuietLine({ input, output: out.stream, prompt: 'secret: ' }, { maxBytes: 10 });
    const rejection = expect(reading).rejects.toBeInstanceOf(PayloadTooLargeError);
    input.end('secret\nmore');
    await rejection;
    expect(out.text()).toBe('');
    input.destroy();
  });

  it('resolves empty on terminal EOF before a line', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const out = sink();
    const prompt = 'secret: ';
    const reading = readQuietLine({ input, output: out.stream, prompt });
    input.end();
    await expect(reading).resolves.toBe('');
    expect(out.text()).toBe(`${prompt}\n`);
  });
});
