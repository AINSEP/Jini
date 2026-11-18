import type { BlobStorage as CoreBlobStorage } from '@jini-ai/core/contracts/blob';
import type { RuntimePlatform } from "@jini-ai/core/contracts/runtime";
import type { LocalBlobStorage } from '../blob-storage.js';

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const platformUnionInSync: Mutual<RuntimePlatform, NodeJS.Platform> = true;
export const localBlobSatisfies: LocalBlobStorage extends CoreBlobStorage<Buffer> ? true : never = true;
