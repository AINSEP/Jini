import { AdminApiError } from '../../core/transport/errors.js';
export class ApiError extends AdminApiError {
  constructor(message: string, status: number, code?: string, body?: Record<string, unknown>) { super({ message, status }, { code, body }); }
}
export const t = ({ locale, key }: { locale: string; key: string }) => {
  if (locale !== 'de') return key;
  return ({ 'Created {date}': 'Erstellt {date}', 'Updated {date}': 'Aktualisiert {date}', 'Created {created} · Updated {updated}': 'Erstellt {created} · Aktualisiert {updated}' } as Record<string, string>)[key] ?? key;
};

import { describeTrashError as classify, formRowMenuItems as items } from '../rules.js';
import type { AdminFormDefinition } from '../models.js';
import type { FormRowMenuHandlers } from '../rules.js';
export const describeTrashError = (error: Error | null, fallback: string, versionChangedMessage: string) => classify({ error, fallback, versionChangedMessage });
export const formRowMenuItems = (form: AdminFormDefinition, handlers: FormRowMenuHandlers, t: (key: string) => string) => items({ form, handlers, t });
