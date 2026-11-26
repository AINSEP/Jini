import { describe, expect, it } from 'vitest';
import { duplicateManifestExportKeys } from '../lib/package-sources.js';

describe('manifest export keys', () => {
  it('rejects repeated export and isolation keys in the raw manifest', () => {
    const file = 'packages/example/package.json';
    const source = `{
      "exports": {
        "./resource-monitor": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
        "./resource-monitor": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
      },
      "jini": {
        "entries": {
          "./resource-monitor": "browser",
          "./resource-monitor": "browser"
        }
      }
    }`;
    expect(duplicateManifestExportKeys({ file, source })).toEqual([
      `${file}: duplicate exports key "./resource-monitor"`,
      `${file}: duplicate jini.entries key "./resource-monitor"`,
    ]);
  });

  it('allows a subpath once per map and conditions in distinct export objects', () => {
    const source = `{
      "exports": {
        "./resource-monitor": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
        "./other": { "types": "./dist/other.d.ts", "import": "./dist/other.js" }
      },
      "jini": { "entries": { "./resource-monitor": "browser", "./other": "browser" } }
    }`;
    expect(duplicateManifestExportKeys({ file: 'packages/example/package.json', source })).toEqual([]);
  });
});
