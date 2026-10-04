import { createContext, useContext } from 'react';
import type { PlaygroundPorts } from '../../ports.js';
import { AdminConfigError } from '../../../core/module/index.js';
export const PlaygroundPortsContext = createContext<PlaygroundPorts | null>(null);
export function usePlaygroundPorts(_required: Record<string, never> = {}, _optional = {}) { const ports = useContext(PlaygroundPortsContext); if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: playground'] }); return ports; }
