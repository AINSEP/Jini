import assert from "node:assert/strict";
import { test } from "vitest";

import { membersAgentToolCatalog } from "../agent-tools.js";

/**
 * @file F6 fix wave (L7 Stryker: 19 schema-literal survivors in agent-tools.ts, AP5). Inline contract
 * for every Members tool: permission, side effects and the strict input schema (descriptions aside).
 */

const withoutDescriptions = (value: unknown): unknown => Array.isArray(value) ? value.map(withoutDescriptions)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "description").map(([key, inner]) => [key, withoutDescriptions(inner)]))
  : value;
const MEMBER_ID = { type: "string", minLength: 1 };
const ID_ONLY = { type: "object", additionalProperties: false, required: ["memberId"], properties: { memberId: MEMBER_ID } };
const write = { sideEffects: "mutates-durable-state", authorization: { permission: "member.manage" } };
const read = { sideEffects: "none", authorization: { permission: "member.manage" } };

test("every Members agent tool keeps its exact permission, side effect and strict input schema", () => {
  assert.deepEqual(membersAgentToolCatalog.map(({ name, sideEffects, authorization, inputSchema, actorClassRule }) =>
    withoutDescriptions({ name, sideEffects, authorization, inputSchema, actorClassRule })), [
    { name: "members_create", ...write, inputSchema: { type: "object", additionalProperties: false, required: ["email"], properties: { email: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 } } }, actorClassRule: undefined },
    { name: "members_update_profile", ...write, inputSchema: { type: "object", additionalProperties: false, required: ["memberId", "name"], properties: { memberId: MEMBER_ID, name: { type: "string", minLength: 1 } } }, actorClassRule: undefined },
    { name: "members_list", ...read, inputSchema: { type: "object", additionalProperties: false, required: [], properties: { cursor: { type: "string" }, afterId: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100, clamp: true } } }, actorClassRule: undefined },
    { name: "members_get_by_id", ...read, inputSchema: ID_ONLY, actorClassRule: undefined },
    { name: "members_delete", ...write, inputSchema: ID_ONLY, actorClassRule: undefined },
    { name: "members_disable", ...write, inputSchema: ID_ONLY, actorClassRule: undefined },
    { name: "members_request_magic_link", ...write, inputSchema: { type: "object", additionalProperties: false, required: ["email"], properties: { email: { type: "string" }, redirectPath: { type: "string" } } }, actorClassRule: undefined },
  ]);
});

test("the member id field tells the model where ids come from", () => {
  const schema = membersAgentToolCatalog.find((tool) => tool.name === "members_get_by_id")!.inputSchema as { properties: { memberId: { description: string } } };
  assert.match(schema.properties.memberId.description, /content_read\.member/);
});
