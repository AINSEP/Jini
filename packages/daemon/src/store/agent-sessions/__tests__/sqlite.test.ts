import {sqlSessionContract} from './sql-contract.js';
import {sqliteFixture} from './fixtures.js';
import {createSqliteAgentSessionStore} from '../sqlite.js';

// A package test supplies its own clock port; the system clock lives in the platform package.
const testClock = { nowMs: () => Date.now() };
sqlSessionContract(sqliteFixture,(input)=>createSqliteAgentSessionStore({clock:testClock,...input}));
