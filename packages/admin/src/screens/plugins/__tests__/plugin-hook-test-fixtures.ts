import { FetchQueryProvider, useCachedLoader, useFetchMutation, useFetchQuery, useInvalidate } from "@jini-ai/ui/fetch-query";
import { createElement, type PropsWithChildren } from "react";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import type { FolderZipPort } from "../../../shell/components/InstallTabCard/use-folder-upload.hooks.js";

const kit = fakeAdminKit({ query: { useCachedLoader, useFetchMutation, useFetchQuery, useInvalidate } });

export function PluginQueryHarness({ children }: PropsWithChildren) {
  return createElement(FetchQueryProvider, { children: createElement(AdminKitProvider, { kit, children }) });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export const english = (key: string) => key;

export class InstallRefusal extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super("untranslated server error");
  }
}

export const isInstallRefusal = (error: unknown): error is InstallRefusal => error instanceof InstallRefusal;

export function folderZipper(zipFolderFiles: FolderZipPort["zipFolderFiles"] = async () => { throw new Error("unexpected folder pick"); }): FolderZipPort {
  return {
    FOLDER_EMPTY: "Choose a nonempty folder.",
    FOLDER_UNREADABLE: "Could not read that folder.",
    FolderZipError: class { readonly reason = "empty" as const; },
    zipFolderFiles,
  };
}
