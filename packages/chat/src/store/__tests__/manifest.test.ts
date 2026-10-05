/** C1 manifest contracts: explicit entry runtimes and optional, injected SQL peers. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const manifest=JSON.parse(readFileSync(new URL('../../../package.json',import.meta.url),'utf8'));
it('keeps neutral and browser entries unchanged while SQL entries are explicit Node subpaths',()=>{
 for(const entry of ['.','./core'])expect(manifest.jini.entries[entry]).toBe('universal');
 for(const entry of ['./react','./react/chat-pane','./react/styles/reference.css'])expect(manifest.jini.entries[entry]).toBe('browser');
 for(const path of ['store','store/sqlite','store/pglite','store/postgres']){
  expect(manifest.exports[`./${path}`]).toEqual({types:`./dist/${path}/index.d.ts`,import:`./dist/${path}/index.js`});
  expect(manifest.typesVersions['*'][path]).toEqual([`./dist/${path}/index.d.ts`]);
  expect(manifest.jini.entries[`./${path}`]).toBe(path==='store'?'universal':'node');
 }
 expect(Object.keys(manifest.exports).some(key=>key.includes('*'))).toBe(false);
 expect(manifest.jini.neutralEntries).toEqual(['src/store/contracts']);
});
it('makes every SQL, React and surface-card UI peer optional, with one pinned dev Kysely and PGlite',()=>{
 // The radix/recharts/mcp-ui surface-card peers became optional in d5abdfbc (dev deps for tests).
 const peers={'@jini-ai/db':'^0.2.0 || ^0.3.0',kysely:'^0.29.6','better-sqlite3':'^13.0.0','@electric-sql/pglite':'0.5.8',pg:'^8.23.0',react:'^18.3.0 || ^19.0.0','react-dom':'^18.3.0 || ^19.0.0','@ag-ui/core':'0.0.58',
  '@mcp-ui/client':'7.1.1','@radix-ui/react-checkbox':'^1.3.11','@radix-ui/react-label':'^2.1.15','@radix-ui/react-radio-group':'^1.4.7','@radix-ui/react-select':'^2.3.7','@radix-ui/react-slot':'^1.3.3',recharts:'^3.10.1'};
 expect(manifest.peerDependencies).toEqual(peers);
 for(const name of Object.keys(peers)){
  expect(manifest.peerDependenciesMeta[name]).toEqual({optional:true});
  expect(manifest.dependencies[name]).toBeUndefined();
 }
 expect(manifest.devDependencies.kysely).toBe('0.29.6');expect(manifest.devDependencies['@electric-sql/pglite']).toBe('0.5.8');
});
