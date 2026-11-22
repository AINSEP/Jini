import { useState } from 'react';

/** Track per-provider key visibility without changing saved credentials. */
export function useMediaProviderKeyVisibility(_input: Record<string, never>, _options = {}) {
  const [visibleApiKeys, setVisibleApiKeys] = useState<ReadonlySet<string>>(() => new Set());
  const toggleKeyVisible = (providerId: string) => {
    setVisibleApiKeys((current) => toggledMember({ set: current, member: providerId }));
  };

  return { visibleApiKeys, toggleKeyVisible };
}

/** A copy of `set` with `member` added if absent, removed if present. */
function toggledMember({ set, member }: { set: ReadonlySet<string>; member: string }): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(member)) {
    next.delete(member);
  } else {
    next.add(member);
  }
  return next;
}
