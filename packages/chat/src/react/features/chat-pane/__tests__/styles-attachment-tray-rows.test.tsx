import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AttachmentTray } from '../../../components/AttachmentTray.js';
import { CHAT_PANE_STYLES } from '../styles.js';

afterEach(cleanup);

const attachments = [
  { path: '/a.png', name: 'storefront-hero.png', kind: 'image' as const, size: 282 },
  { path: '/b.png', name: 'product-shot-02.png', kind: 'image' as const, size: 282 },
  { path: '/c.png', name: 'logo-draft.png', kind: 'image' as const, size: 282 },
];

// Regression: a chip could take the full tray width, so in the sidebar pane each chip filled a row
// and the 88px-tall tray hid the third staged attachment until scrolled.
describe('composer attachment tray rows', () => {
  it('caps each staged chip at half the tray so two share a row', () => {
    render(
      <div className="jini-chat-pane">
        <style>{CHAT_PANE_STYLES}</style>
        <AttachmentTray attachments={attachments} onRemove={() => {}} />
      </div>,
    );
    const tray = screen.getByTestId('composer-attachment-tray');
    const chip = screen.getAllByTestId('attachment-chip')[0]!;

    // jsdom resolves the declarations but cannot lay out flex wrapping, so the caps are the observable.
    expect(getComputedStyle(tray).maxHeight).toBe('88px');
    expect(getComputedStyle(chip).maxWidth).toBe('min(calc(50% - 3px), 290px)');
  });

  it('keeps full-width chips when a host nests the tray in the pinned-context zone', () => {
    render(
      <div className="jini-chat-pane">
        <style>{CHAT_PANE_STYLES}</style>
        <div className="jini-composer-leading">
          <AttachmentTray attachments={attachments} onRemove={() => {}} />
        </div>
      </div>,
    );
    const chip = screen.getAllByTestId('attachment-chip')[0]!;

    expect(getComputedStyle(chip).maxWidth).toBe('min(100%, 290px)');
  });
});

// Regression: on a phone the staged chip's remove "x" was a 25px target (admin rule: >=44px).
describe('composer attachment remove tap area', () => {
  /** Declarations of `selector` inside the pane styles' phone/touch media block. */
  function phoneRule(selector: string): CSSStyleDeclaration | undefined {
    const { container } = render(<style>{CHAT_PANE_STYLES}</style>);
    const sheet = container.querySelector('style')!.sheet!;
    const phone = Array.from(sheet.cssRules).filter(
      (rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText === '(max-width: 640px), (pointer: coarse)',
    );
    const rules = phone.flatMap((media) => Array.from(media.cssRules) as CSSStyleRule[]);
    return rules.find((rule) => rule.selectorText === selector)?.style;
  }

  it('gives the 25px button an invisible 44px hit area on phones and touch screens', () => {
    expect(phoneRule('.jini-chat-pane .jini-attachment-remove')?.position).toBe('relative');
    const hitArea = phoneRule('.jini-chat-pane .jini-attachment-remove::before');
    expect(hitArea).toBeDefined();
    expect(hitArea!.position).toBe('absolute');
    expect(hitArea!.width).toBe('44px');
    expect(hitArea!.height).toBe('44px');
    // Ends at the 36px chip's bottom edge ((36 - 25) / 2 below the button) so the tray never scrolls.
    expect(hitArea!.bottom).toBe('-5.5px');
  });

  it('leaves the chip and the button their visual size', () => {
    render(
      <div className="jini-chat-pane">
        <style>{CHAT_PANE_STYLES}</style>
        <AttachmentTray attachments={attachments} onRemove={() => {}} />
      </div>,
    );
    const remove = screen.getByRole('button', { name: /Remove storefront-hero\.png/ });

    expect(getComputedStyle(remove).width).toBe('25px');
    expect(getComputedStyle(remove).height).toBe('25px');
    expect(getComputedStyle(screen.getAllByTestId('attachment-chip')[0]!).height).toBe('36px');
  });
});

// Regression: on a phone the attachment preview modal's Close was 26x26 and previous/next 40x40
// (admin rule: >=44px).
describe('attachment preview modal tap areas', () => {
  /** Declarations of `selector` inside the pane styles' phone/touch media block. */
  function phoneRule(selector: string): CSSStyleDeclaration | undefined {
    const { container } = render(<style>{CHAT_PANE_STYLES}</style>);
    const sheet = container.querySelector('style')!.sheet!;
    const phone = Array.from(sheet.cssRules).filter(
      (rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText === '(max-width: 640px), (pointer: coarse)',
    );
    const rules = phone.flatMap((media) => Array.from(media.cssRules) as CSSStyleRule[]);
    return rules.find((rule) => rule.selectorText === selector)?.style;
  }

  it('gives the 26px Close an invisible, centred 44px hit area on phones and touch screens', () => {
    expect(phoneRule('.jini-attachment-preview-close')?.position).toBe('relative');
    const hitArea = phoneRule('.jini-attachment-preview-close::before');
    expect(hitArea).toBeDefined();
    expect(hitArea!.position).toBe('absolute');
    expect(hitArea!.width).toBe('44px');
    expect(hitArea!.height).toBe('44px');
    expect(hitArea!.transform).toBe('translate(-50%, -50%)');
  });

  it('grows previous/next to 44px on phones and touch screens', () => {
    const step = phoneRule('.jini-attachment-preview-step');
    expect(step?.width).toBe('44px');
    expect(step?.height).toBe('44px');
  });
});
