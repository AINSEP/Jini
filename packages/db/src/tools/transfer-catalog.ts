import type { AgentToolDefinition } from "@jini-ai/core";
import type { TransferNaming } from "../transfer/types.js";
const SET_DESTINATION_TOOL_ID = "database_transfer_set_destination";
const DATABASE_TRANSFER_RUN_TOOL_ID = "database_transfer_run";
export const DOMAIN = "database-transfer";
export const PLAN_TOOL_ID = "database_transfer_plan";
export const STATUS_TOOL_ID = "database_transfer_status";
const NO_INPUT_SCHEMA = { type: "object", additionalProperties: false, properties: {} } as const;
/** Owner-only: in no built-in role but the owner's `*`. */ 
export const RUN_PERMISSION = "database-transfer.run";
export const SNAPSHOT_SCOPE_ID = "database-transfer";
/** Postgres 14, the oldest this copy is tested against. */ 
export const MIN_SERVER_VERSION_NUM = 140000;

import { defaultDbMessages, type DbTransferMessages } from "../core/messages.js";

/**
 * Builds fresh catalog metadata using host naming and replaceable model-facing messages.
 * Naming defaults describe a generic source; they never choose a persisted schema or marker.
 * @returns Four tool definitions with unchanged IDs, permissions, schemas and risk classifications.
 * @complexity O(1) entries and space, plus O(n) description text for n naming/message characters.
 * @example getDatabaseTransferAgentToolCatalog({}, { naming, messages: defaultDbMessages })
 */
export function getDatabaseTransferAgentToolCatalog(
  _required: Record<string, never>,
  { naming = { defaultSchema: "app", schemaPrefix: "app_" }, messages = defaultDbMessages }: {
    naming?: Pick<TransferNaming, "defaultSchema" | "schemaPrefix">;
    messages?: DbTransferMessages;
  } = {},
): AgentToolDefinition[] {
  return [
    {
      name: PLAN_TOOL_ID,
      description: messages.plan({ naming }),
      sideEffects: "none",
      authorization: { permission: RUN_PERMISSION },
      inputSchema: NO_INPUT_SCHEMA,
    },
    {
      name: SET_DESTINATION_TOOL_ID,
      description: messages.setDestination,
      sideEffects: "mutates-durable-state",
      authorization: { permission: RUN_PERMISSION },
      inputSchema: NO_INPUT_SCHEMA,
    },
    {
      name: STATUS_TOOL_ID,
      description: messages.status,
      sideEffects: "none",
      authorization: { permission: RUN_PERMISSION },
      inputSchema: NO_INPUT_SCHEMA,
    },
    {
      name: DATABASE_TRANSFER_RUN_TOOL_ID,
      description: messages.run,
      sideEffects: "mutates-durable-state",
      authorization: { permission: RUN_PERMISSION },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["planId"],
        properties: { planId: { type: "string", description: messages.planIdDescription } },
      },
    },
  ];
}

/** Default display catalog; registrations render the actual host naming instead. */
export const databaseTransferAgentToolCatalog = getDatabaseTransferAgentToolCatalog({});
