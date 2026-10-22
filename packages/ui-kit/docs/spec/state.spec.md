Spec ID: SPEC-JINI-UI-KIT-STATE
Version: 1.0.0
Last Edited: 2026-10-03
Hash: sha256:da582ff8b4eb325d546c0abf1bc4e497612350cc83a39ed6cf9f527ab9e12c73
spec_mode: implementation_spec

# UI-kit state and ownership

## Contract and kit state

The const spec is the source for implemented component names and parts. Contract 1.0.0 is independent of package 0.1.0. Component maps, overrides, and top-level kit objects are frozen. Each ResolvedKit retains mutable violations and failed-component collections for diagnostics. describeKit copies violation reasons into its report.

The global context slot stores one React context and the set of observed package versions for contract major 1. Providers supply per-tree kit/agent/overlay/toast/cancel-label/guard values. Absent providers use native component defaults without an available toast service.

## Confirmation transition model

| Current policy/state | Request | Result |
|---|---|---|
| Closed | Confirm/dismiss | Refused |
| Open, ready | Dismiss any reason | Invoke cancel and return true |
| Open, ready | Confirm human | Set executing; invoke action; release in finally |
| Open, ready, agentMayConfirm false | Confirm agent | Refused |
| Open, pending | Confirm/dismiss | Refused |
| Executing | Confirm/dismiss | Refused |
| Action rejects | React facade completion | Error visible, execution released |

The pure controller stores only the executing latch; current policy arrives through read on every request. The React layer stores execution/error presentation and keeps the latest props in a ref. Public open/pending props remain host-owned. The controller does not close a dialog after success or mutate host policy.

Opening captures the opener and focuses cancel. Closing attempts focus restoration to a still-connected opener. A development violation records kit diagnostic state; fallback chooses native frame/actions on rerender. Off mode ignores failed-kit fallback state.

## Local navigation

Tabs selected value is host-owned; the native implementation derives its active enabled item and notifies value changes. Menu and Tooltip open state is local to each mounted component. Text/checked controls are controlled by their host values and change ports.

## Toast state

Each service owns immutable message snapshots, listeners, timers, sequence ids, and disposed state. Push/remove emits changes; a same-id push replaces the existing message. The injected scheduler owns timing. dispose clears owned timers and messages; future push throws. A provider-created service follows provider lifetime. Injected services follow host lifetime, including disposal.

## Overlay ownership

A supplied overlay node is host-owned and never removed by the provider. A generated overlay node is provider-owned and removed on cleanup. Provider overlay state starts null unless supplied; portal rendering becomes available after mounting. Root operations require no DOM.

## Handoff

Inputs: root state rules, kit/context/provider/confirmation/navigation hooks. Output: state ownership and transitions. Risks: hosts must synchronize controlled values and manage injected service/container lifetimes. Next assignee: consumer migration owner.
