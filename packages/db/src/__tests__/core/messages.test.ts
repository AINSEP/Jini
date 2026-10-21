import { expect, it } from "vitest";

import { defaultDbMessages } from "../../core/messages.js";

/**
 * @file The default model-facing copy's parameterised messages: each interpolates exactly the
 * values it is given (the transfer tools pass where/database/host), and nothing else.
 */

it("privateAreasTaken names the place every private area is already taken", () => {
  expect(defaultDbMessages.privateAreasTaken({ where: "store on db.example" })).toBe(
    "every private area the source could use in store on db.example already holds other data. Nothing will be overwritten."
  );
});

it("destinationSaved names the database and host the copies will go to", () => {
  expect(defaultDbMessages.destinationSaved({ database: "store", host: "db.example" })).toBe(
    "Copies of the source's data will go to store on db.example."
  );
});

it("missing source table and column messages name the table and the column", () => {
  expect(defaultDbMessages.missingSourceTable({ table: "posts" })).toBe("the source's database has no 'posts' table");
  expect(defaultDbMessages.missingSourceColumn({ table: "posts", column: "title" })).toBe("the source's database has no 'posts.title' column");
});
