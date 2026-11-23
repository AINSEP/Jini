import { readFileSync } from 'node:fs';
const OLD = /import\s*\{[^}]*SHARED_EXTENSION_CAPABILITIES[^}]*\}\s*from\s*["']\.\.\/\.\.\/contracts\/core\/extension-capability-vocabulary\.js["'];?/;
const NEW = /import\s*\{[^}]*SHARED_EXTENSION_CAPABILITIES[^}]*\}\s*from\s*["']@jini-ai\/core\/extension-capability-vocabulary["'];?/;
const moved = readFileSync(process.argv[2], 'utf8');
const orig = readFileSync(process.argv[3], 'utf8');
const strip = s => s.replace(/^import[^;]*extension-capability-vocabulary[^;]*;\n/m, '');
const cases = {
  'moved host-binding (Jini specifier)': moved,
  'original host-binding (relative specifier, source deleted after move)': orig,
  'BAD: import removed, array re-declared as a private literal': strip(moved).replace(/^/, 'const SHARED_EXTENSION_CAPABILITIES = Object.freeze(["content.read", "content.extend", "hooks.attach"]);\n'),
  'BAD: imported from some other module': moved.replace('@jini-ai/core/extension-capability-vocabulary', './local-vocabulary.js'),
  'BAD: imported from a look-alike Jini subpath': moved.replace('@jini-ai/core/extension-capability-vocabulary', '@jini-ai/core/extension-capability-vocabulary-copy'),
};
for (const [name, src] of Object.entries(cases)) console.log(`${OLD.test(src) ? 'match' : 'NO   '} old | ${NEW.test(src) ? 'match' : 'NO   '} new | ${name}`);
