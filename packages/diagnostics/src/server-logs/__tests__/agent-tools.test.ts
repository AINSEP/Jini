import { expect, it } from "vitest";

import { serverLogsAgentToolCatalog } from "../agent-tools.js";
import { MAX_CONTAINS_LENGTH, MAX_SERVER_LOG_LIMIT, SERVER_LOG_LEVELS } from "../read-server-logs.js";

it("publishes one read-only system.read tool whose schema bounds come from the read's own limits", () => {
  expect(serverLogsAgentToolCatalog).toHaveLength(1);
  const [tool] = serverLogsAgentToolCatalog;
  expect(tool!.name).toBe("system_read_server_logs");
  expect(tool!.sideEffects).toBe("none");
  expect(tool!.authorization).toEqual({ permission: "system.read" });
  expect(tool!.inputSchema).toEqual({
    type: "object",
    additionalProperties: false,
    properties: {
      level: { type: "string", enum: [...SERVER_LOG_LEVELS] },
      sinceIso: { type: "string", format: "date-time" },
      contains: { type: "string", maxLength: MAX_CONTAINS_LENGTH },
      limit: { type: "integer", minimum: 1, maximum: MAX_SERVER_LOG_LIMIT, clamp: true },
    },
  });
  expect(tool!.description).toContain(`at most ${MAX_CONTAINS_LENGTH} characters`);
  expect(tool!.description).toContain(`limit (1-${MAX_SERVER_LOG_LIMIT}, default 100)`);
  expect(tool!.description).toContain(SERVER_LOG_LEVELS.join(", "));
});
