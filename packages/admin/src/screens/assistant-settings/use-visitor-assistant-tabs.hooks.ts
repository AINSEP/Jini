import { useState } from "react";

type InnerTab = "provider" | "tools";
/** Keep the inner visitor tab local to this mounted panel. */
export function useVisitorAssistantTabs(_required: Record<string, never>, _options = {}) {
  const [active, setActive] = useState<InnerTab>("provider");
  const select = (id: string) => setActive(id === "tools" ? "tools" : "provider");
  return { active, select };
}
