import { useState } from "react";

import {
  useDevicePreviewDevice,
  usePreviewPaneWidth,
  type DevicePreviewDevice,
} from "../../../shell/components/DevicePreview/DevicePreview.hooks.js";

/**
 * @file View-only state for the email template editor's Pages-style layout (owner, 2026-10-22):
 * which tab shows (HTML or Preview), the preview's device width, and the preview frame's measured
 * width. The same shared DevicePreview hooks the Pages and Post editors use; nothing here talks to
 * the server, so it stays out of `use-email-template-editor.hooks.ts` (the data controller).
 */

export type EmailTemplateTab = "html" | "preview";

export interface EmailTemplateViewState {
  tab: EmailTemplateTab;
  setTab: (tab: EmailTemplateTab) => void;
  device: DevicePreviewDevice;
  setDevice: (device: DevicePreviewDevice) => void;
  frameRef: (node: HTMLDivElement | null) => void;
  paneWidth: number;
}

/**
 * Opens on Preview, like the Pages editor.
 *
 * @param optional.initialTab - The tab to open on. @default "preview"
 * @complexity O(1).
 */
export function useEmailTemplateView(optional: { initialTab?: EmailTemplateTab } = {}): EmailTemplateViewState {
  const [tab, setTab] = useState<EmailTemplateTab>(optional.initialTab ?? "preview");
  const { device, setDevice } = useDevicePreviewDevice();
  const { frameRef, paneWidth } = usePreviewPaneWidth();
  return { tab, setTab, device, setDevice, frameRef, paneWidth };
}
