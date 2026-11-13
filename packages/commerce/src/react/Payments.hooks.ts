import { t as translateCommerce } from './commerce-i18n.js';

/** Bind the payments overview to the host's selected locale. */
export function usePayments({ locale }: { locale: string }, _options = {}) {
  return (key: string): string => translateCommerce({ locale, key });
}
