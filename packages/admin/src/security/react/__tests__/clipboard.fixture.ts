import type { RevealClipboard } from '../../controllers/root-key-reveal.js';
/** A stand-in for the host's clipboard (the host binds its browser clipboard): accepts every write, stores nothing. */
export const testClipboard: RevealClipboard = { writeText: async () => {} };
