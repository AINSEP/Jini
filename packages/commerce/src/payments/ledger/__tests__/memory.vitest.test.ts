import { memoryPaymentsLedger } from "../repo.memory.js";
import { ledgerContract } from "./ledger-contract.js";

ledgerContract("memory", async () => ({ ledger: memoryPaymentsLedger(), close: async () => {} }));
