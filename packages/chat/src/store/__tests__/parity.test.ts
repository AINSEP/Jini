import { chatParityContract } from './parity-contract.js';
import { sqliteFixture } from './fixtures.js';
chatParityContract({ name: 'SQLite', makeFixture: sqliteFixture });
