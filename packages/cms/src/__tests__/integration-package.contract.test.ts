import assert from "node:assert/strict";
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const packageRoot = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')) as {
  exports: Record<string, { types: string; import: string; default: string }>;
  jini: { entries: Record<string, string>; isolation: { domains: Record<string, string[]> } };
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional: boolean }>;
};

it('keeps exports and entry runtime metadata synchronized', () => {
  expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(manifest.jini.entries).sort());
  expect(manifest.jini.entries['./core/tools']).toBe('universal');
  expect(manifest.jini.entries['./media/import']).toBe('universal');
  // REGRESSION: fails if the removed server entry is restored in either manifest map.
  expect(Object.hasOwn(manifest.exports, './server')).toBe(false);
  expect(Object.hasOwn(manifest.jini.entries, './server')).toBe(false);
  expect(manifest.jini.entries['./media']).toBe('node');
  expect(manifest.jini.entries['./media/node']).toBe('node');
  expect(manifest.jini.entries['./settings/express']).toBe('node');
  expect(Object.hasOwn(manifest.exports, './http/settings')).toBe(false);
  expect(Object.hasOwn(manifest.jini.entries, './http/settings')).toBe(false);
  expect(manifest.dependencies).toEqual({ "@jini-ai/core": "workspace:^" });
  expect(Object.hasOwn(manifest.peerDependencies, "@jini-ai/core")).toBe(false);
  expect(Object.hasOwn(manifest.peerDependenciesMeta, "@jini-ai/core")).toBe(false);
});

it('keeps the folded domain entries and optional adapter peers explicit', () => {
  expect(manifest.jini.entries['./forms']).toBe('universal');
  expect(manifest.jini.entries['./forms/html']).toBe('node');
  expect(manifest.jini.entries['./forms/sql']).toBe('node');
  expect(manifest.jini.entries['./forms/express']).toBe('node');
  expect(manifest.jini.entries["./comments"]).toBe("universal");
  expect(manifest.jini.entries["./comments/sql"]).toBe("node");
  expect(manifest.jini.entries["./comments/express"]).toBe("node");
  expect(manifest.exports["./comments"]).toEqual({types: "./dist/comments/index.d.ts", import: "./dist/comments/index.js", default: "./dist/comments/index.js"});
  expect(manifest.exports["./comments/sql"]).toEqual({types: "./dist/comments/sql/index.d.ts", import: "./dist/comments/sql/index.js", default: "./dist/comments/sql/index.js"});
  expect(manifest.exports["./comments/express"]).toEqual({types: "./dist/comments/express/index.d.ts", import: "./dist/comments/express/index.js", default: "./dist/comments/express/index.js"});
  expect(manifest.jini.isolation.domains.comments).toEqual(["src/comments"]);
  assert.ok(manifest.peerDependenciesMeta["@jini-ai/db"]);
  expect(manifest.peerDependenciesMeta["@jini-ai/db"].optional).toBe(true);
  assert.ok(manifest.peerDependenciesMeta["kysely"]);
  expect(manifest.peerDependenciesMeta["kysely"].optional).toBe(true);
  assert.ok(manifest.peerDependenciesMeta["express"]);
  expect(manifest.peerDependenciesMeta["express"].optional).toBe(true);
  assert.ok(manifest.peerDependenciesMeta["@jini-ai/http-kit"]);
  expect(manifest.peerDependenciesMeta["@jini-ai/http-kit"].optional).toBe(true);
  expect(manifest.jini.entries["./redirects"]).toBe("universal");
  expect(manifest.jini.entries["./redirects/sql"]).toBe("node");
  expect(manifest.jini.entries["./redirects/spa"]).toBe("universal");
  expect(manifest.jini.entries["./redirects/host-config"]).toBe("universal");
  expect(manifest.jini.entries["./redirects/express"]).toBe("node");
  assert.ok(manifest.exports["./redirects"]);
  expect(manifest.exports["./redirects"].types).toBe("./dist/redirects/index.d.ts");
  assert.ok(manifest.exports["./redirects/sql"]);
  expect(manifest.exports["./redirects/sql"].types).toBe("./dist/redirects/sql/index.d.ts");
  assert.ok(manifest.exports["./redirects/spa"]);
  expect(manifest.exports["./redirects/spa"].types).toBe("./dist/redirects/spa/index.d.ts");
  assert.ok(manifest.exports["./redirects/host-config"]);
  expect(manifest.exports["./redirects/host-config"].types).toBe("./dist/redirects/host-config/index.d.ts");
  assert.ok(manifest.exports["./redirects/express"]);
  expect(manifest.exports["./redirects/express"].types).toBe("./dist/redirects/express/index.d.ts");
  expect(manifest.jini.isolation.domains.redirects).toEqual(["src/redirects"]);
  expect(manifest.peerDependenciesMeta["@jini-ai/http-kit"].optional).toBe(true);
  expect(manifest.jini.entries['./seo']).toBe('universal');
  expect(manifest.jini.entries['./seo/dom']).toBe('browser');
  expect(manifest.peerDependencies['@jini-ai/http-kit']).toMatch(/^\^\d+\.\d+\.\d+/);
  expect(manifest.peerDependenciesMeta['@jini-ai/http-kit']?.optional).toBe(true);
  expect(manifest.jini.entries['./widgets']).toBe('universal');
  expect(manifest.jini.entries['./widgets/markers']).toBe('universal');
  expect(manifest.jini.entries['./widgets/html']).toBe('node');
  expect(manifest.jini.entries['./widgets/resolvers']).toBe('universal');
  expect(manifest.jini.entries['./widgets/sql']).toBe('node');
  expect(manifest.peerDependenciesMeta['parse5']?.optional).toBe(true);
  expect(manifest.peerDependenciesMeta['kysely']?.optional).toBe(true);
  expect(manifest.peerDependenciesMeta['@jini-ai/db']?.optional).toBe(true);
  expect(manifest.jini.isolation.domains.widgets).toEqual(['src/widgets']);
});

it('gives every public export a source target for a subsequent clean build', () => {
  // PARITY: each advertised entry must still resolve to an actual source module after moves.
  const missing: string[] = [];
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const source = target.import.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
    if (!existsSync(new URL(source, packageRoot))) missing.push(subpath);
    expect(target.default).toBe(target.import);
    expect(target.types).toBe(target.import.replace(/\.js$/, '.d.ts'));
  }
  expect(missing).toEqual([]);
});
