import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { UiKitProvider } from '../kit.js';
import type { UiKit } from '../kit.js';
import { fakeUiKit } from '../testing.js';

export function renderWithUiKit(ui: ReactElement, optional: { kit?: UiKit } = {}): RenderResult {
  return render(<UiKitProvider kit={optional.kit ?? fakeUiKit}>{ui}</UiKitProvider>);
}
