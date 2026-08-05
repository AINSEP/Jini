/**
 * @module types
 *
 * `features/model-picker/` is an independent feature slice: it depends only
 * on `@jini-ai/protocol`'s agent-catalog vocabulary for what a model/agent/
 * provider actually is — never on this package's own conversation/message
 * state (`useConversation`/`useRunStream`/`transport.ts`) — so any consumer
 * of `@jini-ai/chat-react` can use it without pulling in a full chat UI. See
 * `source-map.md` for the extraction this ports (OD's `InlineModelSwitcher.tsx`
 * + siblings and `NewProjectPanel.tsx`'s `MediaModelCards`).
 *
 * Files with no React import (this one included) stay at the feature's top
 * level; `hooks/`/`components/` move under `react/` — the layout policy in
 * `ADS-memory/reports/jini-port/god-components-extraction-plan.md`.
 */
import type {
  AgentDefinition,
  AgentDiagnostic,
  CredentialStatus,
  // The vocabulary spells this model-catalogue-entry type `ModelCatalogOption`, because
  // `@jini-ai/agent-runtime` (which re-exports it) already owns the plain `ModelOption` name for a
  // narrower, unrelated ACP model-probe shape. Aliased back to `ModelOption` here so nothing else
  // in this feature (components/hooks/tests, all of which import from this file) needs to know.
  ModelCatalogOption as ModelOption,
  ModelProvider,
} from '@jini-ai/protocol';

export type { AgentDefinition, AgentDiagnostic, CredentialStatus, ModelOption, ModelProvider };

/** One provider's models, grouped together with that provider's resolved credential status. */
export interface ModelPickerGroup {
  provider: ModelProvider;
  status: CredentialStatus;
  models: ModelOption[];
}

/** The currently-selected model plus the group (and therefore provider) it belongs to. */
export interface ModelPickerSelection {
  model: ModelOption;
  group: ModelPickerGroup;
}

export interface FetchProviderModelsInput {
  providerId: string;
  baseUrl?: string;
  credential?: string;
}

export interface FetchProviderModelsResult {
  ok: boolean;
  models: ModelOption[];
}
