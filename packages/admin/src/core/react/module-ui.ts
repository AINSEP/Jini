import type { ComponentType, LazyExoticComponent, ReactNode } from 'react';
import type { AdminInstance, AdminModuleUi, ModulePageProps } from '@jini-ai/core/contracts/admin-module';
import { bindReact, type LazyTabView } from './bind-react.js';
import { useController } from './use-controller.js';
/** Admin's React implementation of the module UI contract. Module packages never import it: the
 * host injects it into each module factory (owner answer 2026-11-17, J4). */
export const reactModuleUi: AdminModuleUi<
  LazyExoticComponent<ComponentType<ModulePageProps<LazyTabView>>>,
  LazyTabView,
  ComponentType<{ admin: AdminInstance; children: ReactNode }>
> = { bindReact, useController };
