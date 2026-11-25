import { expect, it } from "vitest";
import { InMemoryMigrationRunsRepo } from "../repo.memory.js";

it("resolving a migration clears only the tracked run", async () => {
  const repo = new InMemoryMigrationRunsRepo();
  repo.setNonTerminal({ value: { id: "tracked", status: "running" } });
  await repo.markResolved({ id: "different" });
  expect(await repo.findNonTerminalForSite("site")).toEqual({ id: "tracked", status: "running" });
  await repo.markResolved({ id: "tracked" });
  expect(await repo.findNonTerminalForSite("site")).toBeNull();
});
