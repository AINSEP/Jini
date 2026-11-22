/** Compatibility adapter; single-use/TTL/memory rationale now lives in @jini-ai/db/tools. */
import { DatabaseTransferPlanStore } from "../tools/index.js";
export const databaseTransferPlanStore = new DatabaseTransferPlanStore();
