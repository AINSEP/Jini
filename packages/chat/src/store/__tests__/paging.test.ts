import { chatPagingContract } from './paging-contract.js';
import { sqliteFixture } from './fixtures.js';
chatPagingContract({ name: 'SQLite', makeFixture: sqliteFixture });
