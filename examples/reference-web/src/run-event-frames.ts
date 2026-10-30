/** The playground's JSON run envelope; each consumer interprets its own event kinds. */
export interface RunEventEnvelope { kind: string; payload: unknown }

/** Drains complete records using the playground's existing whitespace and EOF contract.
 * Core owns record decoding; this adapter retains the host's data-colon-only and trimStart
 * grammar, complete-record boundary and EOF policy.
 * @returns The unconsumed tail. JSON errors and consumer errors propagate unchanged.
 */
export function drainRunEventFrames({ buffered, onEvent }: { buffered: string; onEvent: (event: RunEventEnvelope) => void }, _options = {}): string {
  let boundary = buffered.indexOf('\n\n');
  while (boundary >= 0) {
    const frame = buffered.slice(0, boundary);
    buffered = buffered.slice(boundary + 2);
    boundary = buffered.indexOf('\n\n');
    const rawFrame = frame.split('\n').filter(line => line.startsWith('data:')).join('\n');
    const { dataLines } = parseSseRecord({ rawFrame });
    const data = dataLines.map(line => line.trimStart()).join('\n');
    if (data.length > 0) {
      const event = JSON.parse(data) as RunEventEnvelope | null;
      if (event) onEvent(event);
    }
  }
  return buffered;
}
import { parseSseRecord } from '@jini-ai/core/primitives';

