import { useT } from '../../../i18n/index.js';
import type { SourceTrustOption } from '../../types.js';

/**
 * The `<option>` list both trust `<select>`s in this feature render (the add
 * form's and each item card's): a hidden, disabled "Select…" placeholder while
 * no trust value is chosen yet, then one option per `trustOptions` entry.
 */
export function SourceConfigTrustOptions({ trust, trustOptions }: { trust?: string | undefined; trustOptions: readonly SourceTrustOption[] }) {
  const t = useT();
  return (
    <>
      {!trust ? (
        <option value="" disabled hidden>
          {t('Select…')}
        </option>
      ) : null}
      {trustOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {t(option.label)}
        </option>
      ))}
    </>
  );
}
