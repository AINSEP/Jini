import type { ButtonHTMLAttributes, ComponentType, ReactNode } from "react";
import { StorageScreen, type StorageScreenProps } from "./StorageScreen.js";
import type { StorageLink } from "./hooks/use-storage.hooks.js";

/** The domain screens that own each category's data; labels are translated per locale. */
export function localizeStorageLinks({ locale, deps }: { locale: string; deps: {
  links: readonly { key: string; href: string; categories: readonly string[] }[];
  t: StorageScreenProps["t"];
} }, _optional = {}): StorageLink[] {
  return deps.links.map(({ key, href, categories }) => ({ label: deps.t({ locale, key }), href, categories }));
}

export function createStorageReporter({ deps }: { deps: {
  log: (message: string, error: unknown) => void;
  describeErrorForLog: (required: { err: unknown }) => unknown;
  describeApiError: (required: { e: unknown; fallback: string }) => string;
  failureLog: string; failureCopy: string;
} }, _optional = {}) {
  return ({ error }: { error: unknown }, _optional = {}): string => {
    deps.log(deps.failureLog, deps.describeErrorForLog({ err: error }));
    return deps.describeApiError({ e: error, fallback: deps.failureCopy });
  };
}

export function bindStorageScreen({ hooks, kit, deps }: {
  hooks: Pick<StorageScreenProps, "useWiredStorageHook" | "useScreenshotCleanupHook">;
  kit: { Button: ComponentType<{ type: "button" | "submit"; disabled: boolean; onPress: () => void; children: ReactNode }> };
  deps: Omit<StorageScreenProps, "kit" | "links" | "copy" | "locale" | "useWiredStorageHook" | "useScreenshotCleanupHook"> & {
    links: Parameters<typeof localizeStorageLinks>[0]["deps"]["links"];
    copy: StorageScreenProps["copy"];
  };
}, _optional = {}) {
  const { Button } = kit;
  /** `StoragePanel`'s kit takes a DOM-shaped button (`onClick`); this admin's kit Button presses via `onPress`. */
  function KitButton({ onClick, children, type = "button", disabled }: ButtonHTMLAttributes<HTMLButtonElement>) {
    return <Button type={type === "submit" ? "submit" : "button"} disabled={disabled === true} onPress={() => { onClick?.(undefined as never); }}>{children}</Button>;
  }
  function storageCopy({ locale }: { locale: string }) {
    const say = (key: string) => deps.t({ locale, key });
    return {
      automatic: say(deps.copy.automatic), yours: say(deps.copy.yours), shown: say(deps.copy.shown), dryRun: say(deps.copy.dryRun),
      confirm: say(deps.copy.confirm), clean: say(deps.copy.clean), lastAutomaticPass: say(deps.copy.lastAutomaticPass),
      freed: say(deps.copy.freed), failures: say(deps.copy.failures),
    };
  }
  return function BoundStorageScreen({ useAdminLocaleHook }: { useAdminLocaleHook: (required: Record<string, never>, optional: Record<string, never>) => string }, _optional = {}) {
    const locale = useAdminLocaleHook({}, {});
    return <StorageScreen {...deps} {...hooks} locale={locale} kit={{ Button: KitButton }} links={localizeStorageLinks({ locale, deps })} copy={storageCopy({ locale })} />;
  };
}
