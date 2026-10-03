import assert from "node:assert/strict";
import { test } from "vitest";

import { Command } from "commander";

import { introspectProgram, toMcpTools } from "../introspection.js";

/**
 * @file (added 2026-07-29, `CLI_INTROSPECT`) — unit tier for the pure introspection
 * functions, isolated from `commander`'s parsing/process-spawn concerns.
 * See docs/decisions/DR-001-live-command-introspection.md.
 */

function buildTestProgram(): Command {
  const program = new Command("example");
  program.description("test program");

  program
    .command("init")
    .description("init description")
    .argument("<dir>", "target dir")
    .option("--name <name>", "display name")
    .action(() => undefined);

  program
    .command("serve")
    .description("serve description")
    .argument("<dir>", "install dir")
    .option("--port <port>", "port", "3000")
    .option("--dry-run", "boolean switch, no value")
    .action(() => undefined);

  program.command("help").action(() => undefined);
  program.command("introspect").action(() => undefined);

  return program;
}

/** Separate from {@link buildTestProgram} deliberately — a nested command group added to that
 * shared fixture would change every other test's command count/order in this file for no reason. */
function buildTestProgramWithNestedGroup(): Command {
  const program = new Command("example");
  program.description("test program");

  const themeProgram = program.command("theme").description("theme commands group");
  themeProgram
    .command("validate")
    .description("validate description")
    .argument("<dir>", "theme dir")
    .option("--profile <profile>", "profile", "author")
    .action(() => undefined);

  return program;
}

test("introspectProgram: reads real commands/arguments/options off the live Command tree", () => {
  const manifest = introspectProgram({ program: buildTestProgram(), excludedCommands: ["help", "introspect"] });

  assert.equal(manifest.name, "example");
  assert.equal(manifest.commands.length, 2, "meta commands (help, introspect) must be excluded");
  assert.deepEqual(
    manifest.commands.map((c) => c.name),
    ["init", "serve"]
  );

  const serve = manifest.commands.find((c) => c.name === "serve")!;
  assert.equal(serve.description, "serve description");
  assert.deepEqual(serve.arguments, [{ name: "dir", required: true, description: "install dir" }]);
  assert.equal(serve.options.length, 2);
  assert.deepEqual(serve.options[0], {
    flags: "--port <port>",
    attributeName: "port",
    description: "port",
    required: false,
    defaultValue: "3000",
    takesValue: true,
  });
  assert.equal(serve.options[1]!.takesValue, false, "a switch with no <value>/[value] must report takesValue: false");
});

test("toMcpTools: reshapes the manifest into MCP tool definitions, one per command, prefixed example_", () => {
  const manifest = introspectProgram({ program: buildTestProgram(), excludedCommands: ["help", "introspect"] });
  const tools = toMcpTools({ manifest, toolNamePrefix: "example_" });

  assert.equal(tools.length, 2);
  const initTool = tools.find((t) => t.name === "example_init")!;
  assert.equal(initTool.description, "init description");
  assert.deepEqual(initTool.inputSchema, {
    type: "object",
    properties: {
      dir: { type: "string", description: "target dir" },
      name: { type: "string", description: "display name" },
    },
    required: ["dir"],
  });
});

test("introspectProgram: a nested subcommand group (theme -> validate) is flattened to its full invocation path, and the empty parent group itself is not listed", () => {
  const manifest = introspectProgram({ program: buildTestProgramWithNestedGroup(), excludedCommands: [] });

  assert.equal(manifest.commands.length, 1, "only the invocable leaf, not the non-actionable 'theme' group itself");
  const [validate] = manifest.commands;
  assert.equal(validate!.name, "theme validate", "the manifest name must be the full space-separated invocation, not just the leaf's own name");
  assert.equal(validate!.description, "validate description");
  assert.deepEqual(validate!.arguments, [{ name: "dir", required: true, description: "theme dir" }]);
});

test("toMcpTools: a nested subcommand's tool name replaces spaces with underscores (example_theme_validate)", () => {
  const manifest = introspectProgram({ program: buildTestProgramWithNestedGroup(), excludedCommands: [] });
  const tools = toMcpTools({ manifest, toolNamePrefix: "example_" });

  assert.equal(tools.length, 1);
  assert.equal(tools[0]!.name, "example_theme_validate");
});

test("toMcpTools: a boolean switch (--dry-run) is omitted from inputSchema properties — an agent has nothing to supply for it", () => {
  const manifest = introspectProgram({ program: buildTestProgram(), excludedCommands: ["help", "introspect"] });
  const tools = toMcpTools({ manifest, toolNamePrefix: "example_" });
  const serveTool = tools.find((t) => t.name === "example_serve")!;

  assert.ok(!("dryRun" in serveTool.inputSchema.properties), "a valueless switch must not appear in the MCP inputSchema");
  assert.ok("port" in serveTool.inputSchema.properties);
});

test("excluded commands are supplied by each host, including nested groups", () => {
  const manifest = introspectProgram({ program: buildTestProgramWithNestedGroup(), excludedCommands: ["theme"] });
  assert.deepEqual(manifest.commands, []);
});

test("different required prefixes change the actual exported tool names", () => {
  const manifest = introspectProgram({ program: buildTestProgramWithNestedGroup(), excludedCommands: [] });
  assert.equal(toMcpTools({ manifest, toolNamePrefix: "first_" })[0]!.name, "first_theme_validate");
  assert.equal(toMcpTools({ manifest, toolNamePrefix: "second_" })[0]!.name, "second_theme_validate");
});

test("required value options and optional arguments map to a flat schema", () => {
  const program = new Command("example");
  program.command("publish").argument("[dir]", "optional directory").requiredOption("--token <token>", "token");
  const manifest = introspectProgram({ program, excludedCommands: [] });
  assert.deepEqual(toMcpTools({ manifest, toolNamePrefix: "example_" })[0]!.inputSchema, {
    type: "object", properties: { dir: { type: "string", description: "optional directory" }, token: { type: "string", description: "token" } }, required: ["token"],
  });
});
