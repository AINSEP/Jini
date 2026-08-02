import { useT } from '../../../i18n/index.js';
import { agentCliEnvValue, cliEnvFieldsForAgent } from '../../rules.js';
import type { AgentCliEnvFieldSpec, LocalCliConfig } from '../../types.js';

export interface AgentCliEnvFieldsProps {
  agentId: string;
  /** The full shared catalog — this component filters it down to `agentId`
   *  itself via `cliEnvFieldsForAgent`, so a host passes one catalog to every
   *  card rather than pre-slicing it per agent. */
  fields: readonly AgentCliEnvFieldSpec[];
  config: LocalCliConfig;
  onChange: (agentId: string, envKey: string, value: string) => void;
}

/**
 * Per-agent CLI environment overrides — proxy URLs, custom config
 * directories, a binary-path override — folded into a collapsed disclosure
 * so the card stays compact for the vast majority of operators who never
 * touch it. Renders nothing when the catalog has no fields for this agent,
 * rather than an empty disclosure.
 *
 * Origin: `SettingsDialog.tsx`'s `agent-cli-env` block — ported filtered to
 * ONE agent at a time (the selected card's own), matching the origin's own
 * later revision (its comment explains the switch away from "every
 * supported agent's fields, always expanded" for the same compactness
 * reason). The origin's AMR-wallet `agentCliEnvIntent` bookkeeping is not
 * ported — see `nextConfigForAgentCliEnvChange`'s doc.
 */
export function AgentCliEnvFields({ agentId, fields, config, onChange }: AgentCliEnvFieldsProps) {
  const t = useT();
  const relevant = cliEnvFieldsForAgent(fields, agentId);
  if (relevant.length === 0) return null;

  return (
    <details className="jini-agent-cli-env" data-testid={`jini-agent-cli-env-${agentId}`}>
      <summary className="jini-agent-cli-env-summary">{t('Advanced: proxy & custom paths')}</summary>
      <div className="jini-agent-cli-env-body">
        <p className="jini-field-hint">{t("Environment variables passed to this CLI when it runs.")}</p>
        <div className="jini-agent-cli-env-grid">
          {relevant.map((field) => (
            <label className="jini-field" key={`${field.agentId}:${field.envKey}`}>
              <span className="jini-field-label">{field.label}</span>
              <input
                className="jini-input"
                type={field.secret ? 'password' : 'text'}
                value={agentCliEnvValue(config, agentId, field.envKey)}
                placeholder={field.placeholder}
                spellCheck={false}
                autoComplete="off"
                data-testid={`jini-agent-cli-env-${agentId}-${field.envKey}`}
                onChange={(event) => onChange(agentId, field.envKey, event.target.value)}
              />
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}
