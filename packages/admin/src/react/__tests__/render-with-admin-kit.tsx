import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { AdminKitProvider, type AdminKit } from '../kit.js';
import { fakeAdminKit } from '../testing-kit.js';

export function renderWithAdminKit(ui: ReactElement, options: { kit?: AdminKit } = {}): RenderResult {
  return render(<AdminKitProvider kit={options.kit ?? fakeAdminKit()}>{ui}</AdminKitProvider>);
}
