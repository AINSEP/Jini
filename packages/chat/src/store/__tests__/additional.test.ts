import { chatAdditionalContract } from './additional-contract.js';
import { sqliteFixture } from './fixtures.js';
chatAdditionalContract({ name: 'SQLite', makeFixture: sqliteFixture });
