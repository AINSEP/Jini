import os from "node:os";
import { createPgFixture } from "../pg-fixture.js";
export type { PsqlResult } from "../pg-fixture.js";

// Compatibility for existing internal test helpers; all execution belongs to the public fixture.
const fixture = createPgFixture({
  host: process.env.PGHOST ?? "/tmp",
  user: process.env.PGUSER ?? os.userInfo().username,
  port: process.env.PGPORT,
});

export function psql(database: string, sql: string) {
  return fixture.psql({ database, sql });
}
export function recreateDatabase(database: string): void {
  fixture.recreateDatabase({ database });
}
export function dropDatabase(database: string): void {
  fixture.dropDatabase({ database });
}
