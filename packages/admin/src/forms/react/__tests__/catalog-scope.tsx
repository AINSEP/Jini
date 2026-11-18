import { FormsControllerContext } from '../hooks/FormsPorts.hooks.js';
import { useController } from '../../../core/react/use-controller.js';
import { useMemo, type ReactNode } from "react";
import type { FormsCatalogPort } from "../../../core/ports/forms-catalog.js";
import { createMemoryFormsApi } from "../../adapters/memory.js";
import { fakeFormsCatalog } from "../../__tests__/fakes/forms-catalog.js";
import { FormsPortsContext, type FormsPorts } from "../hooks/FormsPorts.hooks.js";

/**
 * @file The forms module's React scope for tests that only need the catalog: the memory adapter for the
 * required ports and a catalog built from the recorded fixture (or the one a test hands in).
 */

/** The forms ports a host would supply, with the catalog of the test's choosing. */
export function fakeFormsPorts({ catalog = fakeFormsCatalog() }: { catalog?: FormsCatalogPort } = {}): FormsPorts {
  const formsApi = createMemoryFormsApi({});
  return { formsApi, formsCatalog: catalog, formsTrash: formsApi.trash };
}

export function FormsCatalogScope({ children, catalog }: { children: ReactNode; catalog?: FormsCatalogPort }) {
  const ports = useMemo(() => fakeFormsPorts(catalog ? { catalog } : {}), [catalog]);
  return <FormsControllerContext.Provider value={useController}><FormsPortsContext.Provider value={ports}>{children}</FormsPortsContext.Provider></FormsControllerContext.Provider>;
}
