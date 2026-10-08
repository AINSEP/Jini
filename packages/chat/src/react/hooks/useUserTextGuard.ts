import { useCallback, useState } from 'react';
import { redactUserText, type SecretRedactionSignal, type UserTextRedactionOptions } from '../../core/user-text-redaction.js';

/** Shared notice state for composer and question answers. Effects see only a count, never text. */
export function useUserTextGuard(options: UserTextRedactionOptions, _optional: Record<string, never> = {}) {
  const [secretRedacted, setSecretRedacted] = useState(false);
  const notifyRedaction = useCallback((signal: SecretRedactionSignal) => {
    setSecretRedacted(true);
    options.onSecretRedacted?.(signal);
  }, [options.onSecretRedacted]);
  const redact = useCallback(({ text }: { text: string }, _options = {}) => {
    const result = (options.redactUserText ?? redactUserText)({ text }, {});
    if (result.secretRedacted) notifyRedaction({ secretRedacted: true, count: result.count });
    return result;
  }, [options.redactUserText, notifyRedaction]);
  const redactText = useCallback((text: string) => redact({ text }, {}).text, [redact]);
  return { secretRedacted, redact, redactText, notifyRedaction };
}
