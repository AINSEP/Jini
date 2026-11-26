import { expect, test } from "vitest";

import {
  FS_FILES_READ_PERMISSION,
  FS_LIST_FILES_TOOL_ID,
  FS_READ_FILE_TOOL_ID,
  FS_WRITE_FILES_TOOL_ID,
  FS_WRITE_LIMITS,
  getFsFilesAgentToolCatalog,
} from "../agent-tools.js";
import { FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION } from "../custom-root-permission.js";

type RootProperty = { enum: readonly string[]; description: string };
type SchemaWithRoot = { properties: { root: RootProperty } };

function rootProperty(schema: unknown): RootProperty {
  return (schema as SchemaWithRoot).properties.root;
}

/** Pins that the package holds no root list of its own: whichever host builds the catalog owns it. */
test("root enum and descriptions come from the selected host", () => {
  const rootIds = ["alpha", "beta"] as const;
  const rootDescriptors = [
    { id: "alpha", description: "the first host folder" },
    { id: "beta", description: "the second host folder" },
  ];
  const catalog = getFsFilesAgentToolCatalog({ rootIds, rootDescriptors, maxFileBytes: 4096 });
  const list = catalog.find(tool => tool.name === FS_LIST_FILES_TOOL_ID)!;
  const read = catalog.find(tool => tool.name === FS_READ_FILE_TOOL_ID)!;
  for (const tool of [list, read]) {
    const root = rootProperty(tool.inputSchema);
    expect(root.enum).toEqual(["alpha", "beta"]);
    expect(root.description).toBe("Which allowed root to look inside. One of: 'alpha': the first host folder | 'beta': the second host folder");
  }
  const other = getFsFilesAgentToolCatalog({ rootIds: ["solo"], rootDescriptors: [{ id: "solo", description: "only" }], maxFileBytes: 1 });
  expect(rootProperty(other[0]!.inputSchema).enum).toEqual(["solo"]);
  expect(rootProperty(list.inputSchema).enum).toEqual(["alpha", "beta"]);
});

test("the read ceiling is the host's and the write batch keeps the shared CMS limits", () => {
  const catalog = getFsFilesAgentToolCatalog({ rootIds: ["site"], rootDescriptors: [{ id: "site", description: "the site" }], maxFileBytes: 1234 });
  expect(catalog.map(tool => tool.name)).toEqual(["fs_list_files", "fs_read_file", "fs_write_files"]);
  expect(catalog[1]!.description).toContain("a file larger than 1234 bytes");
  const write = catalog[2]!;
  const files = (write.inputSchema as { properties: { files: { maxItems: number } } }).properties.files;
  expect(files.maxItems).toBe(FS_WRITE_LIMITS.maxFiles);
  expect(FS_WRITE_LIMITS).toEqual({ maxFiles: 50, maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 });
  expect(write.description).toContain("At most 50 files, 2 MiB each, 10 MiB per call.");
});

test("tool IDs, side effects and permissions are the canonical ones", () => {
  expect([FS_LIST_FILES_TOOL_ID, FS_READ_FILE_TOOL_ID, FS_WRITE_FILES_TOOL_ID]).toEqual(["fs_list_files", "fs_read_file", "fs_write_files"]);
  expect(FS_FILES_READ_PERMISSION).toBe("content.read");
  const catalog = getFsFilesAgentToolCatalog({ rootIds: ["site"], rootDescriptors: [{ id: "site", description: "the site" }], maxFileBytes: 10 });
  expect(catalog.map(tool => [tool.sideEffects, tool.authorization.permission])).toEqual([
    ["none", "content.read"],
    ["none", "content.read"],
    ["mutates-durable-state", FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION],
  ]);
});
