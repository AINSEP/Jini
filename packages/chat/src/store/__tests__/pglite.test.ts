import { allChatContracts } from './all-contracts.js';
import { pgliteFixture } from './pg-fixtures.js';
allChatContracts({ name: 'PGlite', fixture: pgliteFixture });
