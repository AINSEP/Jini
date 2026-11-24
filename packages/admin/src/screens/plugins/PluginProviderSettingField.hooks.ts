import { useState } from "react";
import type { AdminPluginProviderSettingField } from "./api/plugins-api.types.js";

/** The `Custom…` option's value; never a real setting value (those are URLs or plain text). */
export const CUSTOM = "\u0000custom";

/** Keep the custom provider option and its edit state together. */
export function usePluginProviderChoice({ field, value, onChange }: { field: AdminPluginProviderSettingField; value: string; onChange: (value: string) => void }, _options = {}) {
  const options = field.options ?? [];
  const listed = options.some((option) => option.value === value);
  const [custom, setCustom] = useState(Boolean(field.allowCustom) && value !== "" && !listed);
  const choose = ({ next }: { next: string }, _options = {}) => {
    setCustom(next === CUSTOM);
    onChange(next === CUSTOM ? "" : next);
  };
  return { options, listed, custom, choose };
}
