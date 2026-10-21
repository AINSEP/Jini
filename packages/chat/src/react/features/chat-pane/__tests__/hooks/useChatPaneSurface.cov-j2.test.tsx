import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useChatPaneSurface } from '../../hooks/useChatPaneSurface.hooks.js';

describe('useChatPaneSurface', () => {
  it('keeps workspace extensions on the workspace surface and places the directory control below by default', () => {
    const composerSlots = { footerLeadingAccessory: null };
    const uploadAttachments = vi.fn(async () => []);
    const { result } = renderHook(() => useChatPaneSurface({
      variant: undefined, composerSlots, workingDirectoryControlPlacement: undefined, uploadAttachments,
    }));
    expect(result.current).toEqual({
      embed: false, composerSlots, workingDirectoryControlPlacement: 'below', uploadAttachments,
    });
  });

  it('honors an explicit placement on the workspace surface', () => {
    const { result } = renderHook(() => useChatPaneSurface({
      variant: undefined, composerSlots: undefined, workingDirectoryControlPlacement: 'composer', uploadAttachments: undefined,
    }));
    expect(result.current.workingDirectoryControlPlacement).toBe('composer');
  });

  it('strips workspace extensions and the directory control from the embed surface', () => {
    const { result } = renderHook(() => useChatPaneSurface({
      variant: 'embed', composerSlots: { footerLeadingAccessory: null }, workingDirectoryControlPlacement: 'composer',
      uploadAttachments: vi.fn(async () => []),
    }));
    expect(result.current).toEqual({
      embed: true, composerSlots: undefined, workingDirectoryControlPlacement: 'none', uploadAttachments: undefined,
    });
  });
});
