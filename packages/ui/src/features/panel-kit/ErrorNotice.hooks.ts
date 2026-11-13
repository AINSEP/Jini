import { useState } from 'react';
import type { UserFacingError } from '@jini-ai/core';
import { copyToClipboard, type CopyToClipboardOptions } from '../../utils/copy-to-clipboard.js';

/** Copy the incident details and associate feedback with the copied incident. */
export function useErrorNotice({ failure, ports }: { failure: UserFacingError; ports: CopyToClipboardOptions }, _options = {}) {
  const [feedback, setFeedback] = useState<{ text: string; copied: boolean } | null>(null);
  async function copy() {
    const copied = await copyToClipboard({ text: failure.copyText }, ports);
    setFeedback({ text: failure.copyText, copied });
  }
  return { feedback, copy };
}
