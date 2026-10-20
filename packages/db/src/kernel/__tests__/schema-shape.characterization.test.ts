import Database from "better-sqlite3";
import { sql } from "kysely";
import { expect, test } from "vitest";
import { sqliteKernel } from "../sqlite/index.js";
import { readSchemaShape } from "../schema-shape.js";

test("SQLite shapes retain composite keys, auto-index identity, expression/partial indexes, views and triggers", async () => {
  const kernel = sqliteKernel(new Database(":memory:"));
  const parent = "CREATE TABLE parent (a TEXT, b TEXT, UNIQUE (a, b))";
  const child = "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_a TEXT NOT NULL DEFAULT 'none', parent_b TEXT, CHECK (length(parent_a) > 0), FOREIGN KEY (parent_a, parent_b) REFERENCES parent(a, b) ON DELETE CASCADE ON UPDATE RESTRICT)";
  const view = "CREATE VIEW child_view AS SELECT id FROM child";
  const trigger = "CREATE TRIGGER child_guard BEFORE INSERT ON child WHEN NEW.parent_a = '' BEGIN SELECT RAISE(ABORT, 'empty'); END";
  try {
    for (const ddl of [parent, child,
      "CREATE UNIQUE INDEX child_partial ON child(parent_a) WHERE parent_b IS NOT NULL",
      "CREATE INDEX child_expression ON child(lower(parent_a))", view, trigger]) await kernel.execute(sql.raw(ddl));
    const shape = await readSchemaShape(kernel);
    expect(shape).toEqual({
      tables: {
        child: {
          columns: ["id integer PK1", "parent_a text NOT NULL DEFAULT 'none'", "parent_b text"],
          indexes: ["child_expression ()", "child_partial UNIQUE (parent_a) WHERE parent_b IS NOT NULL"],
          constraints: [`DEFINITION ${child}`, "FOREIGN KEY (parent_a, parent_b) REFERENCES parent (a, b) ON DELETE CASCADE ON UPDATE RESTRICT"],
        },
        parent: { columns: ["a text", "b text"], indexes: ["(u) UNIQUE (a, b)"], constraints: [`DEFINITION ${parent}`] },
      },
      others: [`trigger child_guard: ${trigger}`, `view child_view: ${view}`],
    });
    expect(await readSchemaShape(kernel, { exclude: ["child", "absent"] })).toEqual({
      tables: { parent: shape.tables.parent }, others: shape.others,
    });
  } finally { await kernel.close(); }
});
