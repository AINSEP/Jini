import assert from "node:assert/strict";
import { test } from "vitest";

import { introspectProgram, toMcpTools, type IntrospectionCommand } from "../introspection.js";

/**
 * @file Hand-written {@link IntrospectionCommand} fakes. The port deliberately declares argument
 * and option `description` as optional (any structural Command tree, not only `commander`'s,
 * may be passed), and real `commander` always fills them with "" — so the missing-description
 * contract can only be exercised through a conforming non-commander port.
 */

function leaf(fields: Partial<Pick<IntrospectionCommand, "registeredArguments" | "options">> & { name: string; description: string }): IntrospectionCommand {
  return {
    name: () => fields.name,
    description: () => fields.description,
    commands: [],
    registeredArguments: fields.registeredArguments ?? [],
    options: fields.options ?? [],
  };
}

function program(children: IntrospectionCommand[]): IntrospectionCommand {
  return { name: () => "fake", description: () => "fake program", commands: children, registeredArguments: [], options: [] };
}

test("introspectProgram: an argument or option port without a description reports an empty string", () => {
  const manifest = introspectProgram({
    program: program([
      leaf({
        name: "sync",
        description: "sync things",
        registeredArguments: [{ name: () => "target", required: false }],
        options: [{ flags: "--mode [mode]", attributeName: () => "mode", mandatory: true }],
      }),
    ]),
    excludedCommands: [],
  });

  assert.deepEqual(manifest, {
    name: "fake",
    description: "fake program",
    commands: [{
      name: "sync",
      description: "sync things",
      arguments: [{ name: "target", required: false, description: "" }],
      options: [{ flags: "--mode [mode]", attributeName: "mode", description: "", required: true, defaultValue: undefined, takesValue: true }],
    }],
  });

  // The empty description flows straight through into the MCP projection; an optional-value
  // `[mode]` flag still takes a value, and a mandatory option is a required schema property.
  assert.deepEqual(toMcpTools({ manifest, toolNamePrefix: "x_" }), [{
    name: "x_sync",
    description: "sync things",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", description: "" }, mode: { type: "string", description: "" } },
      required: ["mode"],
    },
  }]);
});

test("introspectProgram: described argument/option ports keep their descriptions verbatim", () => {
  const manifest = introspectProgram({
    program: program([
      leaf({
        name: "run",
        description: "",
        registeredArguments: [{ name: () => "id", required: true, description: "run id" }],
        options: [{ flags: "--verbose", attributeName: () => "verbose", mandatory: false, description: "chatty" }],
      }),
    ]),
    excludedCommands: ["run-nested-only"],
  });

  assert.deepEqual(manifest.commands[0]!.arguments, [{ name: "id", required: true, description: "run id" }]);
  assert.equal(manifest.commands[0]!.options[0]!.description, "chatty");
  assert.equal(manifest.commands[0]!.options[0]!.takesValue, false);
});
