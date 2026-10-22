import * as rules from '../../../rules.js';
import type { SeoIssue } from '../../../models.js';
/** Imports-only bridge preserves the certified rule assertions while public boundaries use objects. */
export const sortIssuesBySeverity = (issues: readonly SeoIssue[]) => rules.sortIssuesBySeverity({ issues });
export const orEmpty = (value: string | undefined) => rules.orEmpty({ value });
export const overrideOrClear = <V>(value: V) => rules.overrideOrClear({ value });
export const actionLabel = (pending: boolean, pendingLabel: string, idleLabel: string) => rules.actionLabel({ pending, pendingLabel, idleLabel });
export const buildMediaRef = (item: { id: string; slug?: string }) => rules.buildMediaRef({ item });
export const resolveMediaRefPreviewUrl = (value: string, mediaOriginalUrl: (id: string) => string) => rules.resolveMediaRefPreviewUrl({ value, mediaOriginalUrl });
