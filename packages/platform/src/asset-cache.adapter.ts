import { createRequire } from 'node:module';
import type { LookupFunction } from 'node:net';
import type { Agent } from 'undici';

const require = createRequire(import.meta.url);

/** Load the optional vendor only for a default dispatcher; the cache owns lookup validation.
 * @throws When the optional peer cannot be loaded or its Agent cannot be constructed.
 */
export function createUndiciAssetCacheDispatcher({ lookup }: { lookup: LookupFunction }, _options: Record<string, never> = {}): Agent {
  const { Agent } = require('undici') as typeof import('undici');
  return new Agent({ connect: { lookup } });
}
