import {sqlSessionContract} from './sql-contract.js';
import {sqliteFixture} from './fixtures.js';
import {createSqliteAgentSessionStore} from '../sqlite.js';
sqlSessionContract(sqliteFixture,createSqliteAgentSessionStore);
