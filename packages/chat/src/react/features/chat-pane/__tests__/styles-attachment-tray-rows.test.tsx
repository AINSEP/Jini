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
