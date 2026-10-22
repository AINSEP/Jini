import { chatIsolationContract } from './isolation-contract.js';
import { sqliteFixture } from './fixtures.js';
chatIsolationContract({ name: 'SQLite', makeFixture: sqliteFixture });
