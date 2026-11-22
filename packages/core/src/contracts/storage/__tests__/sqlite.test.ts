/** C2 the SQLite client declarations are structural: no driver import in the public source. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('sqlite public declarations contain no driver import',()=>{
  const source=readFileSync(new URL('../sqlite.ts',import.meta.url),'utf8');
  expect(source).not.toMatch(/import\s+(?:type\s+)?[^;]*from\s+['"]better-sqlite3['"]/);
});
