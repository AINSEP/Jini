import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { readStreamText } from './prompt.js';

/**
 * One line from `input`: piped input is read to EOF under the byte cap, then its
 * first CRLF/LF line is returned. A terminal receives `prompt`, reads without
 * echo, and closes the prompt with a newline on `output`; EOF resolves empty.
 * @throws {PayloadTooLargeError} when piped input exceeds maxBytes (default 10 MiB).
 */
export async function readQuietLine(
  { input, output, prompt }: {
    input: NodeJS.ReadableStream & { isTTY?: boolean };
    output: Pick<NodeJS.WritableStream, 'write'>;
    prompt: string;
  },
  optional: { maxBytes?: number } = {},
): Promise<string> {
  if (!input.isTTY) {
    const text = await readStreamText({ input }, optional);
    // Only the first line is returned; anything after it is ignored.
    const lineEnd = text.search(/\r?\n/);
    return lineEnd === -1 ? text : text.slice(0, lineEnd);
  }
  output.write(prompt);
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input, output: muted, terminal: true });
  try {
    return await new Promise<string>((resolve) => {
      rl.once('line', resolve);
      rl.once('close', () => resolve(''));
    });
  } finally {
    rl.close();
    output.write('\n');
  }
}
