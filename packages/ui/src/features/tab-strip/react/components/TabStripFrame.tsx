import { forwardRef, type ComponentPropsWithoutRef } from 'react';

/** Shared tablist shell for the reorderable strip and controlled button-based TabBar. */
export const TabStripFrame = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  function TabStripFrame(props, ref) {
    return <div {...props} ref={ref} role="tablist" />;
  },
);
