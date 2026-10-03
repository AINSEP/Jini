import { chatClockMethodsContract } from './clock-methods-contract.js';
import type { Fixture } from './fixtures.js';
import { chatIsolationContract } from './isolation-contract.js';
import { chatParityContract } from './parity-contract.js';
import { chatPagingContract } from './paging-contract.js';
import { chatAdditionalContract } from './additional-contract.js';
import { chatTransactionContract } from './transactions-contract.js';
export function allChatContracts({ name, fixture }: { name: string; fixture: ()=>Promise<Fixture> }){
 chatClockMethodsContract({ name, fixture });
 chatIsolationContract({ name: name, makeFixture: fixture });chatParityContract({ name: name, makeFixture: fixture });chatPagingContract({ name: name, makeFixture: fixture });
 chatAdditionalContract({ name: name, makeFixture: fixture });chatTransactionContract({ name: name, makeFixture: fixture });
}
