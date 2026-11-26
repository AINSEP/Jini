import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

it.each([
  ["cms", "./core/days-remaining"],
  ["cms", "./admin-http/routes/external-mcp/provider-refusal"],
  ["cms", "./publish/content/peer-transport-error"],
  ["cms", "./publish/trust/handshake-error"],
  ["core", "./contracts/standing-draft"],
])("classifies %s %s as universal", (pkg, entry) => {
  const file = new URL(`../../packages/${pkg}/package.json`, import.meta.url);
  const root = ts.parseJsonText(file.pathname, readFileSync(file, "utf8")).statements[0];
  const properties = root && ts.isExpressionStatement(root) && ts.isObjectLiteralExpression(root.expression)
    ? root.expression.properties : [];
  const values = properties.filter(ts.isPropertyAssignment).flatMap(jini =>
    ts.isStringLiteral(jini.name) && jini.name.text === "jini" && ts.isObjectLiteralExpression(jini.initializer)
      ? jini.initializer.properties.filter(ts.isPropertyAssignment).flatMap(entries =>
        ts.isStringLiteral(entries.name) && entries.name.text === "entries" && ts.isObjectLiteralExpression(entries.initializer)
          ? entries.initializer.properties.filter(ts.isPropertyAssignment)
            .filter(property => ts.isStringLiteral(property.name) && property.name.text === entry)
            .map(property => ts.isStringLiteral(property.initializer) ? property.initializer.text : undefined)
          : [])
      : []);
  expect(values).toEqual(["universal"]);
});
