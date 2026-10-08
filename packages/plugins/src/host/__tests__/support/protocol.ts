import { decodeTier2Reply as decode, type Tier2Request } from '../../worker/protocol.js';
export * from '../../worker/protocol.js';
export function decodeTier2Reply(message: unknown, expectedKind: Tier2Request['kind']) { return decode({ message, expectedKind }); }
