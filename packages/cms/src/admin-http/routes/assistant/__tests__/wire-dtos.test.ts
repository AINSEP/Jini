import { describe, expect, it } from "vitest";
import type {
  AssistantDetectAgentsResponseDto, AssistantExecutionTabAgentDto, AssistantListModelsResponseDto, AssistantProbeVerdictDto,
} from "@jini-ai/core/contracts/site/cms-assistant";

import { assistantBody } from "../shared.js";
import { readProbeRequestFields, resolveTestAgentOutcome, type ExecutionDetectedAgent } from "../execution-shared.js";
import { toExecutionTabAgent } from "../detect-agents.js";

/**
 * @file rv1123e K1 migration: the assistant wire DTOs are declared once in neutral Core (the admin
 * client consumes the same declarations); CMS keeps only the projection and verdict rules, called
 * with object arguments.
 */
/** Mutual assignability, checked by the compiler: `true` only when each side accepts the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const agent: ExecutionDetectedAgent = { id: "cli-a", name: "CLI A", available: true, modelsSource: "fallback", authStatus: "ok" };

describe("assistant wire DTOs", () => {
  it("projects and reads through object arguments with byte-identical output", () => {
    const row: AssistantExecutionTabAgentDto = toExecutionTabAgent({ agent });
    expect(row).toEqual({ id: "cli-a", label: "CLI A", installed: true, modelsSource: "fallback", authStatus: "ok" });
    const verdict: AssistantProbeVerdictDto = resolveTestAgentOutcome({ agent, model: "" });
    expect(verdict).toEqual({ ok: true, message: "CLI A is installed and authenticated." });
    expect(assistantBody({ body: undefined })).toEqual({});
    expect(assistantBody({ body: { a: 1 } })).toEqual({ a: 1 });
    expect(readProbeRequestFields({ rawBody: { protocol: "openai", apiKey: 1, useStoredCredential: "true" } })).toEqual({
      protocol: "openai", baseUrl: "", apiVersion: undefined, typedKey: "", useStoredCredential: false, useAdminStoredCredential: false,
    });
  });

  it("keeps Core's restated unions identical to the detected-agent fields they mirror", () => {
    // Core cannot import CMS, so it restates these unions; a drift on either side fails `tsc` here.
    const parity: [
      Same<ExecutionDetectedAgent["modelsSource"], AssistantExecutionTabAgentDto["modelsSource"]>,
      Same<ExecutionDetectedAgent["authStatus"], AssistantExecutionTabAgentDto["authStatus"]>,
      Same<AssistantDetectAgentsResponseDto["data"][number]["discoveryPending"], boolean>,
      Same<AssistantListModelsResponseDto["models"], string[]>,
    ] = [true, true, true, true];
    expect(parity).toEqual([true, true, true, true]);
  });
});
