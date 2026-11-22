import Database from "better-sqlite3";
import type { Kysely } from "kysely";
import { expect, it } from "vitest";

import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { KyselyKernel } from "../port.js";
import { openMemorySqliteKernel } from "../sqlite/index.js";

type Schema = { t: { id: string } };

it("a KyselyKernel is the neutral core kernel bound to a Kysely handle", async () => {
  const kernel: KyselyKernel<Schema> = openMemorySqliteKernel<Schema>({ open: (filePath, options) => new Database(filePath, options) });
  const neutral: StorageKernel<Kysely<Schema>, Schema> = kernel;
  try {
    expect(neutral.dialect).toBe("sqlite");
    expect(kernel.transport).toBe("better-sqlite3");
  } finally {
    await kernel.close();
  }
});

it("the schema witness still rejects a kernel that lacks the required tables", () => {
  const assertRejects = (empty: KyselyKernel<{}>) => {
    // @ts-expect-error a kernel over no tables is not a kernel over `Schema`
    const required: StorageKernel<Kysely<Schema>, Schema> = empty;
    return required;
  };
  expect(typeof assertRejects).toBe("function");
});
