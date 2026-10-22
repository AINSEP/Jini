import { chatTransactionContract } from './transactions-contract.js';
import { sqliteFixture } from './fixtures.js';
chatTransactionContract({ name: 'SQLite', makeFixture: sqliteFixture });

import { twoSqliteConnections } from './fixtures.js';
import { twoConnectionContract } from './two-connection-contract.js';
twoConnectionContract({ name: 'SQLite', open: twoSqliteConnections });
