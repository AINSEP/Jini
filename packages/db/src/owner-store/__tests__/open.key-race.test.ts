import { beforeEach, expect, test, vi } from "vitest";

/** L2 §5 NO-COVERAGE open.ts:77-78: a competing initializer that wins the `wx` key-file race
 *  (SiteKeyFileAlreadyExistsError) is tolerated and the winner's key is used; any OTHER generation
 *  failure propagates. The real generator runs, then the race is simulated around it. */
const race = vi.hoisted(() => ({ mode: "none" as "none" | "lost" | "broken" }));
vi.mock("@jini-ai/platform/secrets", async (importOriginal) => {
  const real = await importOriginal<typeof import("@jini-ai/platform/secrets")>();
  return {
    ...real,
    generateFileSiteKey: (input: { keyFilePath: string }) => {
      if (race.mode === "broken") throw new Error("disk full");
      if (race.mode === "lost") {
        real.generateFileSiteKey(input); // the competitor wrote it first…
        return real.generateFileSiteKey(input); // …so our exclusive create throws AlreadyExists
      }
      return real.generateFileSiteKey(input);
    },
  };
});
const { fixture, input } = await import("./fixture.js");
beforeEach(() => { race.mode = "none"; });

test("losing the key-file creation race to a competitor still opens with the winner's key", async () => {
  race.mode = "lost";
  const item = fixture();
  try {
    const store = await item.open();
    const entry = await store.put(input);
    await item.close();
    race.mode = "none";
    const reopened = await item.open();
    expect((await reopened.vault.get({ ...entry, workspaceId: "owner", principalId: null, id: entry.id }))?.payload).toEqual(input.payload);
  } finally { await item.cleanup(); }
});

test("any other key-generation failure propagates", async () => {
  race.mode = "broken";
  const item = fixture();
  try {
    await expect(item.open()).rejects.toThrow("disk full");
  } finally { await item.cleanup(); }
});
