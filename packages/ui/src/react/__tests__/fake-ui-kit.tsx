import { render, type RenderResult } from '@testing-library/react';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { UiKitProvider } from '../kit.js';
import type { SecretReveal, UiKit } from '../kit.js';

/** A minimal in-memory kit for ui tests: no component library involved. */
export const fakeUiKit: UiKit = {
  components: {
    SecretInput: ({ label, value, onChange, ref }) => (
      <input type="password" aria-label={label} value={value as string | undefined} onChange={onChange} ref={ref} />
    ),
  },
  hooks: {
    useOverlayContainer: () => document.body,
    useSecretReveal: ({ labels }): SecretReveal => {
      const [revealed, setRevealed] = useState(false);
      return { revealed, inputType: revealed ? 'text' : 'password', toggleLabel: revealed ? labels.hide : labels.show, toggle: () => setRevealed(!revealed) };
    },
  },
};

export function renderWithUiKit(ui: ReactElement, optional: { kit?: UiKit } = {}): RenderResult {
  return render(<UiKitProvider kit={optional.kit ?? fakeUiKit}>{ui}</UiKitProvider>);
}
