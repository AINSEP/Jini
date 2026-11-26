import { useRef, useState } from "react";
import { type AccessTokenCategoryId } from "../../access-token-categories.js";
import type { DraftFields, BusyState, AddFormEntry, CustomDraftFields } from "./use-access-tokens.hooks.js";
import { blankCustomDraft, IDLE } from "./access-token-state.hooks.js";

export function useAccessTokenDrafts(_required: Record<string, never>, _optional = {}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AccessTokenCategoryId>("all");
  const [existingDrafts, setExistingDrafts] = useState<Record<string, DraftFields>>({});
  const [existingBusy, setExistingBusy] = useState<Record<string, BusyState>>({});
  const [addForms, setAddForms] = useState<Record<string, AddFormEntry>>({});
  const [customAddDraft, setCustomAddDraft] = useState<CustomDraftFields>(blankCustomDraft());
  const [customAddBusy, setCustomAddBusy] = useState<BusyState>(IDLE);
  const [customKeyBusy, setCustomKeyBusy] = useState<Record<string, BusyState>>({});
  const customKeyPending = useRef(new Set<string>());

  return { query, setQuery, category, setCategory, existingDrafts, setExistingDrafts, existingBusy, setExistingBusy, addForms, setAddForms, customAddDraft, setCustomAddDraft, customAddBusy, setCustomAddBusy, customKeyBusy, setCustomKeyBusy, customKeyPending };
}
