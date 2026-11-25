// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminKitProvider } from '../../../react/kit.js';
import { fakeAdminKit } from '../../../react/testing-kit.js';
import { CopyKeysDialog } from '../CopyKeysDialog.js';
import { useCopyKeys, type CopyKeysPort } from '../hooks/use-copy-keys.hooks.js';

// The host loads `copy-keys-dialog.css` beside this dialog; a class the dialog renders but the
// stylesheet never defines silently drops the list layout and the bullet-free results list.
// jsdom rewrites `import.meta.url`'s scheme, so resolve from the test file's own path.
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url.replace(/^[a-z]+:\/\/[^/]*/, 'file://'))), '../copy-keys-dialog.css'), 'utf8');
const definedClasses = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(match => match[1]));
const t = (key: string) => key;

function Harness({ port }: { port: CopyKeysPort }) {
  const dialog = useCopyKeys({ t, port, onGranted: vi.fn(), sharedKeys: { sourceSiteId: 'pool-a', loadFailed: 'load failed', grantFailed: 'grant failed' } });
  return <><button onClick={dialog.show}>Open</button><CopyKeysDialog dialog={dialog} t={t} /></>;
}

/** Class tokens naming this dialog's own pieces (not the shared dialog chrome). */
function copyKeyClasses(element: Element | null): string[] {
  return [...(element?.classList ?? [])].filter(token => token.includes('copy-keys'));
}

describe('saved-key picker stylesheet contract', () => {
  it('renders the list and results with class names the shipped stylesheet defines', async () => {
    const port: CopyKeysPort = {
      listCredentialCopySources: vi.fn().mockResolvedValue({ sources: [{ siteId: 'pool-a', name: 'Pool A', keys: [{ kind: 'vendor', id: 'one', label: 'Main', provider: 'OpenAI', worksFor: [] }] }] }),
      copyCredentials: vi.fn().mockResolvedValue({ results: [{ kind: 'vendor', id: 'one', status: 'granted' }] }),
    };
    render(<AdminKitProvider kit={fakeAdminKit()}><Harness port={port} /></AdminKitProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const radio = await screen.findByRole('radio', { name: 'Main · OpenAI' });
    fireEvent.click(radio);
    fireEvent.click(screen.getByRole('button', { name: 'Use this key on this site' }));
    const results = (await screen.findByText('Granted to this site')).closest('ul');
    const list = radio.closest('label')?.parentElement ?? null;
    for (const element of [list, results]) {
      const tokens = copyKeyClasses(element);
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.filter(token => !definedClasses.has(token))).toEqual([]);
    }
  });
});
