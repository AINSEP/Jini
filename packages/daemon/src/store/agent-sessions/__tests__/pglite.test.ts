import {sqlSessionContract} from './sql-contract.js';
import {pgliteFixture} from './fixtures.js';
import {createPgliteAgentSessionStore} from '../pglite.js';

// A package test supplies its own clock port; the system clock lives in the platform package.
const testClock = { nowMs: () => Date.now() };
sqlSessionContract(pgliteFixture,(input)=>createPgliteAgentSessionStore({clock:testClock,...input}));
