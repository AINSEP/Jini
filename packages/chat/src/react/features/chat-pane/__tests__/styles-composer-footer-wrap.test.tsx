import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Composer } from '../../../components/Composer.js';
import { useComposer } from '../../../hooks/useComposer.js';
import { CHAT_PANE_STYLES } from '../styles.js';

afterEach(cleanup);

// Owner report, 2026-10-29: a picked-folder chip in the footer's leading slot squeezed the model
// picker under the send button at dock width. jsdom cannot lay out flex, so the declarations that
// order the give-way (chip first, then the trailing group wraps whole) are the observable.
describe('composer footer with a leading chip', () => {
  function renderFooter() {
    const { result } = renderHook(() => useComposer());
    render(
      <div className="jini-chat-pane">
        <style>{CHAT_PANE_STYLES}</style>
        <Composer
          composer={result.current}
          onSend={() => {}}
          slots={{
            footerLeadingAccessory: <span>Additional Assets</span>,
            footerAccessories: <div className="jini-runtime-picker"><button type="button" className="jini-runtime-dropup-trigger">6.1 Sol</button></div>,
          }}
        />
      </div>,
    );
    return {
      footer: screen.getByText('Additional Assets').closest('.jini-composer-footer')!,
      leading: screen.getByText('Additional Assets').closest('.jini-composer-footer-leading')!,
      accessories: screen.getByText('6.1 Sol').closest('.jini-composer-footer-accessories')!,
      sendGroup: screen.getByRole('button', { name: 'Send' }).closest('.jini-composer-send-group')!,
    };
  }

  it('keeps the picker and send in one trailing group that wraps as a unit', () => {
    const { footer, accessories, sendGroup } = renderFooter();
    const trailing = accessories.parentElement!;

    expect(trailing.className).toBe('jini-composer-footer-trailing');
    expect(sendGroup.parentElement).toBe(trailing);
    expect(trailing.parentElement).toBe(footer);
    expect(getComputedStyle(footer).flexWrap).toBe('wrap');
    expect(getComputedStyle(trailing).marginLeft).toBe('auto');
    expect(getComputedStyle(trailing).minWidth).toBe('0');
  });

  it('lets the leading slot give way first, never wider than its content', () => {
    const { leading } = renderFooter();
    const style = getComputedStyle(leading);

    expect(style.flexBasis).toBe('0%');
    expect(style.flexGrow).toBe('1');
    expect(style.maxWidth).toBe('max-content');
  });

  it('keeps the model chevron inside its trigger when the label truncates', () => {
    renderFooter();

    expect(getComputedStyle(screen.getByText('6.1 Sol')).minWidth).toBe('4.5em');
  });
});
