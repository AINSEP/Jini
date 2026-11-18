import { render as renderBare, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { AdminKitProvider } from '../../../react/kit.js';
import { fakeAdminKit } from '../../../react/testing-kit.js';

/** The look section reads its fallback colours from the host kit, so every consent render sits under a provider. */
const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={fakeAdminKit()}>{children}</AdminKitProvider>;
export const render = (ui: ReactElement, options: Omit<RenderOptions, 'wrapper'> = {}): ReturnType<typeof renderBare> => renderBare(ui, { wrapper, ...options });
