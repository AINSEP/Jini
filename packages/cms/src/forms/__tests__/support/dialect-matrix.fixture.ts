/** Bind only the forms DDL and current tables to the existing p1 matrix. */
import { describeEachDialect as matrix, eachDialect } from "../../../core/__tests__/support/dialect-matrix.js";
import type { StorageKernel, StorageDialect } from "@jini-ai/db/kernel";
import type { FormDefinitionTable, FormSubmissionTable } from "../../sql/tables.js";
import { createTables } from "./forms-tables.fixture.js";
export type FormsDatabase = { form_definitions: FormDefinitionTable; form_submissions: FormSubmissionTable };
export type ContentKernel = StorageKernel<FormsDatabase>;

export function describeEachDialect<R>(
  title: string,
  options: { tables: readonly string[]; make: (kernel: ContentKernel) => R },
  body: (make: () => R, dialect: StorageDialect) => void,
) {
  matrix({ title, options: { ...options, createTables }, body });
}
export function eachFormsDialect() {
  return eachDialect({ tables: ["form_submissions", "form_definitions"], make: (kernel: ContentKernel) => kernel, createTables });
}
