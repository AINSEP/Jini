/** Legacy test-call shapes, bound to the real package repos (no copied repository lifecycle). */
import type { StorageKernel } from "@jini-ai/db/kernel";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo as MemorySubmissionRepo } from "../../repo.memory.js";
import { formDefinitionRepoFor as definitionRepoFor, SqlFormSubmissionRepo, createSubmissionIpRetentionRepo as retentionRepoFor } from "../../sql/index.js";
import type { FormSubmissionDatabase } from "../../sql/tables.js";
import type { FormSubmissionRepoPort as PackageSubmissionRepo } from "../../ports.js";
import { tables } from "./forms-tables.fixture.js";
export { InMemoryFormDefinitionRepo };
export type { FormDefinitionRepoPort, RemoveFormSubmissionFn } from "../../ports.js";

type PageInput = Parameters<PackageSubmissionRepo["listByDefinition"]>[0] & { cursor?: string | null | undefined };
export interface FormSubmissionRepoPort extends Omit<PackageSubmissionRepo, "listByDefinition" | "transaction"> {
  listByDefinition(required: PageInput): ReturnType<PackageSubmissionRepo["listByDefinition"]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

export class InMemoryFormSubmissionRepo extends MemorySubmissionRepo {
  override listByDefinition(required: PageInput, optional: { cursor?: string | null } = {}) {
    const cursor = optional.cursor ?? required.cursor;
    return super.listByDefinition(required, cursor === undefined ? {} : { cursor });
  }
}

class LegacySqlSubmissionRepo extends SqlFormSubmissionRepo {
  override listByDefinition(required: PageInput, optional: { cursor?: string | null } = {}) {
    const cursor = optional.cursor ?? required.cursor;
    return super.listByDefinition(required, cursor === undefined ? {} : { cursor });
  }
}

export function formDefinitionRepoFor<DB>(kernel: StorageKernel<DB>) {
  return definitionRepoFor({ kernel, tables });
}
export function formSubmissionRepoFor<DB>(kernel: StorageKernel<DB>) {
  return new LegacySqlSubmissionRepo({ kernel: kernel as unknown as StorageKernel<FormSubmissionDatabase>, tables });
}
export function createSubmissionIpRetentionRepo<DB>({ kernel }: { kernel: StorageKernel<DB> }) {
  return retentionRepoFor({ kernel, tables });
}
