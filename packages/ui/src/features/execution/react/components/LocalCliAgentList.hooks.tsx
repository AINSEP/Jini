import { buildAgentListHandles } from '@jini-ai/core/agent-handles';
import type { LocalCliAgentListProps } from './LocalCliAgentList.js';
import { LocalCliAgentCard } from './LocalCliAgentCard.js';
import type { DetectedAgent } from '../../types.js';

type CardInput = { [K in 'agents' | 'config' | 'onSelect' | 'onModelChange' | 'onReasoningChange' | 'onEnvChange' | 'cliEnvFields' | 'onRescan' | 'onTest' | 'agentTest' | 'renderAgentIcon' | 'agentHandle']: LocalCliAgentListProps[K] };

/** Render each agent with its own stable handle and the host's shared actions. */
export function useLocalCliAgentCards({ agents, config, onSelect, onModelChange, onReasoningChange, onEnvChange, cliEnvFields, onRescan, onTest, agentTest, renderAgentIcon, agentHandle }: CardInput, _options = {}) {
  const installed = agents.filter((agent) => agent.installed);
  const handleList = agentHandle ? buildAgentListHandles({ prefix: agentHandle, ids: agents.map((agent) => agent.id) }) : undefined;
  const cardHandles = new Map(agents.map((agent, index) => [agent.id, handleList?.[index]]));
  const renderCard = (agent: DetectedAgent) => {
    const handle = cardHandles.get(agent.id);
  return (
      <LocalCliAgentCard
        key={agent.id}
        agent={agent}
        config={config}
        selected={config.agentId === agent.id}
        onSelect={onSelect}
        onModelChange={onModelChange}
        onReasoningChange={onReasoningChange}
        onEnvChange={onEnvChange}
        cliEnvFields={cliEnvFields}
        renderIcon={renderAgentIcon}
        onTest={onTest}
        agentTest={agentTest}
        onRescan={onRescan}
        {...(handle ? { agentHandle: handle } : {})}
      />
    );
  };

  return { installed, renderCard };
}
