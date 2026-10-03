import { allChatContracts } from './all-contracts.js';
import { postgresFixture, twoPostgresConnections } from './pg-fixtures.js';
import { twoConnectionContract } from './two-connection-contract.js';
allChatContracts({ name: 'Postgres', fixture: postgresFixture });
twoConnectionContract({ name: 'Postgres', open: twoPostgresConnections });
