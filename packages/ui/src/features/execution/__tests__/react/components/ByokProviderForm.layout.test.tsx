import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ByokProviderForm } from '../../../react/components/ByokProviderForm.js';
import type { ByokConfig, ProviderPreset } from '../../../types.js';

/**
 * @file The card's field ROWS — which controls share a line (owner ruling, 2026-09-02).
 *
 * Three fields used to span the full card width one under another (Base URL, Max tokens, Model) with
 * "Test connection" stranded on a fourth row of its own. None of them needs that width, and the probe
 * button reads as unrelated to the field it actually probes when it sits a row below it.
 *
 * Now: Base URL and Max tokens share one row, and "Test connection" sits beside the Model control.
 * Both rows wrap rather than being pinned to two columns, so a narrow card stacks them — Max tokens
 * below Base URL, the button below the Model field — which is why the structural assertions below are
 * paired with a check that the wrap rule itself is still in the stylesheet. jsdom performs no layout,
 * so the DOM alone cannot tell a wrapping row from a rigid one.
 */

const PRESET: ProviderPreset = {
  id: 'provider-a',
  title: 'Provider A',
  protocol: 'anthropic',
  baseUrl: 'https://a.example.com',
  preferredModels: ['model-a'],
};

const CONFIG: ByokConfig = {
  protocol: 'anthropic',
  providerId: 'provider-a',
  apiKey: 'k',
  baseUrl: 'https://a.example.com',
  model: 'model-a',
};

function renderForm(overrides: Partial<Parameters<typeof ByokProviderForm>[0]> = {}) {
  return render(
    <ByokProviderForm
      config={CONFIG}
      onConfigChange={vi.fn()}
      preset={PRESET}
      modelDiscovery={{ status: 'idle' }}
      connectionTest={{ status: 'idle' }}
      onTestConnection={vi.fn()}
      {...overrides}
    />,
  );
}

/** The shipped stylesheet, read from source. The rows' responsiveness lives entirely here.
 *  Resolved from the package root (vitest's cwd) rather than `import.meta.url`, which this config
 *  does not hand back as a `file:` URL. */
const CSS = readFileSync(resolve('src/features/settings/dialog/styles/settings-dialog.css'), 'utf8');

/** The declarations of one CSS rule, by selector — enough to assert a property without pulling in a
 *  parser for two lookups. */
function ruleBody(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, `no rule for ${selector} in settings-dialog.css`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf('}', at));
}

describe('ByokProviderForm field rows', () => {
  it('puts Base URL and Max tokens in ONE row, in that source order', () => {
    const { container } = renderForm();
    const row = container.querySelector('.jini-byok-field-row');
    expect(row, 'Base URL and Max tokens should share a row wrapper').not.toBeNull();

    const labels = Array.from(row!.querySelectorAll(':scope > .jini-field .jini-field-label')).map(
      (el) => el.textContent?.replace('*', '').trim(),
    );
    // Source order is what a wrap turns into stacking order, so it IS the mobile layout: Base URL
    // first means Max tokens drops BELOW it, never above.
    expect(labels).toEqual(['Base URL', 'Max tokens (optional)']);
  });

  it('leaves Max tokens alone in the row when the preset hides Base URL', () => {
    // `fixedOrigin` is what hides the field (`showsBaseUrlField`) — a provider whose endpoint the
    // operator may not retarget.
    const { container } = renderForm({ preset: { ...PRESET, fixedOrigin: true } });
    const row = container.querySelector('.jini-byok-field-row');
    expect(row!.querySelectorAll(':scope > .jini-field')).toHaveLength(1);
    expect(screen.queryByText('Base URL')).not.toBeInTheDocument();
  });

  it('puts Test connection on the SAME row as the Model control, not below it', () => {
    const { container } = renderForm();
    const row = container.querySelector('.jini-byok-model-row');
    expect(row, 'the Model field and its probe button should share a row wrapper').not.toBeNull();

    const button = screen.getByRole('button', { name: 'Test connection' });
    expect(row).toContainElement(button);
    // A SIBLING of the label, never inside it: a <button> nested in a <label> makes every click on
    // the button also activate the labelled control — the same rule `apiKeyFooter` documents.
    expect(row!.querySelector('label')).not.toContainElement(button);
  });

  it('keeps the model-discovery error out of the row, so it cannot shove the button around', () => {
    const { container } = renderForm({ modelDiscovery: { status: 'error', message: 'nope' } });
    const hint = screen.getByText(/Could not load live models: nope/);
    // Still the same `.jini-field-hint.is-error[role="status"]` element the host suites locate it by.
    expect(hint).toHaveClass('jini-field-hint', 'is-error');
    expect(hint).toHaveAttribute('role', 'status');
    expect(container.querySelector('.jini-byok-model-row')).not.toContainElement(hint);
  });

  it('keeps the connection-test result on its own line below the row', () => {
    const { container } = renderForm({ connectionTest: { status: 'error', message: 'refused' } });
    const status = screen.getByText('refused');
    expect(container.querySelector('.jini-byok-model-row')).not.toContainElement(status);
  });

  it('declares both rows as WRAPPING flex rows, so a narrow card stacks instead of squeezing', () => {
    // The structural assertions above hold just as well for a rigid two-column grid, which is
    // exactly the layout that must not ship. jsdom does no layout, so this reads the rule itself.
    expect(ruleBody('.jini-byok-field-row')).toContain('flex-wrap: wrap');
    expect(ruleBody('.jini-byok-model-row')).toContain('flex-wrap: wrap');
    // A flex-basis is what decides WHERE it wraps; `flex: 1 1 <basis>` on the children is the whole
    // responsive mechanism, and a bare `flex: 1` would never wrap.
    expect(ruleBody('.jini-byok-field-row > .jini-field')).toMatch(/flex: 1 1 \d+px/);
    expect(ruleBody('.jini-byok-model-row > .jini-field')).toMatch(/flex: 1 1 \d+px/);
  });

  it('raises the field-row basis enough that Max tokens wraps below Base URL before the row gets cramped (owner-reported)', () => {
    // 210px let the two fields stay side by side well before either had room to be useful: the
    // longest realistic default Base URL preset ('https://generativelanguage.googleapis.com',
    // constants.ts) is 41 characters, which at `.jini-input`'s 13px font (~6.76px/glyph for this
    // font) plus its 20px horizontal padding and 2px border needs ~300px to show without visually
    // truncating — so each field's basis has to clear that before the row is allowed to keep both
    // fields on one line.
    const basisMatch = ruleBody('.jini-byok-field-row > .jini-field').match(/flex: 1 1 (\d+)px/);
    expect(basisMatch, '.jini-byok-field-row > .jini-field should declare flex: 1 1 <basis>px').not.toBeNull();
    expect(Number(basisMatch![1])).toBeGreaterThanOrEqual(300);
    // The Model row shares the same 210px rule today but is out of scope for this fix — only Base
    // URL / Max tokens were reported as too cramped.
    expect(ruleBody('.jini-byok-model-row > .jini-field')).toContain('flex: 1 1 210px');
  });
});
