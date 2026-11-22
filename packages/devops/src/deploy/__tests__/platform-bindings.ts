import { assertSafePublicUrl, createValidatingLookup } from '@jini-ai/platform';
import type { NodeReachabilityRequired } from '../node.js';

/** Platform's own functions, as a host hands them to the Node reachability ports. */
export const platformBindings: NodeReachabilityRequired = { assertSafeUrl: assertSafePublicUrl, createValidatingLookup };
