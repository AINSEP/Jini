/** port test, not run in the sandbox; complete contract over an actual PGlite socket kernel. */
import { allChatContracts } from './all-contracts.js';
import { pgliteSocketFixture } from './pg-fixtures.js';
allChatContracts({ name: 'PGlite socket', fixture: pgliteSocketFixture });
