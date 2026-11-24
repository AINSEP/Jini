import { useEffect, useRef, type MouseEvent } from "react";
import { useFocusTrap } from "../../react/kit.js";
import type { SkillInstallView } from "./skills-screen.types.js";

/** Sibling dialog behavior: Escape, contained Tab navigation and focus return. */
export function useSkillConfirmation({ active, onCancel }: { active: boolean; onCancel: () => void }, _optional = {}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap({ containerRef: dialogRef }, { active });
  useEffect(() => {
    if (!active) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { previous?.focus(); };
  }, [active]);
  useEffect(() => {
    if (!active) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, onCancel]);
  function onDialogClick(event: MouseEvent<HTMLDivElement>) { event.stopPropagation(); }
  return { dialogRef, onDialogClick };
}

export function useSkillInstallConfirmation(install: SkillInstallView) {
  const confirmation = useSkillConfirmation({ active: install.pending !== null, onCancel: install.cancel });
  return {
    ...confirmation,
    source: install.pending && "githubUrl" in install.pending ? install.pending.githubUrl : "Uploaded skill files",
    onConfirm: () => { void install.confirm(); },
  };
}
