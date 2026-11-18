import { useState } from 'react';
import type { SecretReveal, UiKit } from './kit.js';

/** A minimal in-memory kit for ui tests: no component library involved. It is also used by the tests of
 *  the packages whose screens render under it (`@jini-ai/ui/react/testing`). The render helper that mounts it
 *  stays in `__tests__/render-with-ui-kit.tsx`, so this published entry never imports a test library. */
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
