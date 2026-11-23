# chat-pane

The chat pane: composer, runtime picker, transcript layout and their selection/send rules.

## Wiring

Why the host injects these: see `ADS-memory/reports/jini-port/extraction-plan.md` (K5, XC-1).

**Ports the host injects**
- `ChatPaneNativeToolPolicy` (`nativeToolPolicy` prop on `ChatPane` / `AgentRuntimePicker`): the host's current
  `NativeToolPolicyInput` limits bundled with the runtime's assessor (`ChatAgentPolicyPort['assessNativeToolPolicy']`).
  Omit it and the pane shows no permissions warning; pass it and the assessor is required.
- `transport: ChatTransport`, plus the optional effects in `ChatPaneProps` (`runtimeAccess`, `redactUserText`, ...).

**Provides** `ChatPane`, `AgentRuntimePicker`, and the pure rules in `rules.ts` / `model-options.ts`.

```tsx
import { assessNativeToolPolicy } from '@jini-ai/agent-runtime/native-tool-policy';
import { ChatPane } from '@jini-ai/chat/react';

<ChatPane transport={transport} agents={agents}
  nativeToolPolicy={limits ? { limits, assess: assessNativeToolPolicy } : undefined} />
```

**Must never import** another package's implementation. Known holdout: `rules.ts` and `model-options.ts`
still import `@jini-ai/agent-runtime/model-selection` (`modelIdentityKind`, `concreteModelOptions`,
`modelReasoningOptions`); they move to `ChatAgentPolicyPort` once their public callers can take it.
