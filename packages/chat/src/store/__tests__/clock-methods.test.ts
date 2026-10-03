import { chatClockMethodsContract } from './clock-methods-contract.js';
import { sqliteFixture } from './fixtures.js';
chatClockMethodsContract({ name: 'SQLite', fixture: sqliteFixture });
