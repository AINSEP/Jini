// @vitest-environment jsdom
import { render, screen } from '../../../../../__tests__/ui-kit-render-support.js';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type TranslationDict, type useT } from '../../../../i18n/index.js';
import { AgentCliEnvFields } from '../../../react/components/AgentCliEnvFields.js';
import { AgentDiagnosticRow } from '../../../react/components/AgentDiagnosticRow.js';
import { ByokProviderForm, defaultByokProviderFormHooks } from '../../../react/components/ByokProviderForm.js';
import { LocalCliAgentCard, defaultLocalCliAgentCardHooks } from '../../../react/components/LocalCliAgentCard.js';
import { LocalCliAgentList } from '../../../react/components/LocalCliAgentList.js';
import type { AgentCliEnvFieldSpec, AgentDiagnostic, DetectedAgent } from '../../../types.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

const FR: TranslationDict = {
  'Advanced: proxy & custom paths': 'Avancé : proxy et chemins',
  Install: 'Installer',
  Test: 'Tester',
  'Your CLIs': 'Vos CLI',
  Model: 'Modèle',
};

function inFrench(ui: React.ReactNode) {
  return <I18nProvider dictionaries={{ fr: FR }} initialLocale="fr">{ui}</I18nProvider>;
}

const fields: AgentCliEnvFieldSpec[] = [{ agentId: 'claude', envKey: 'ANTHROPIC_BASE_URL', label: 'Base URL' }];
const envProps = { agentId: 'claude', fields, config: { agentId: 'claude' }, onChange: vi.fn() };

describe('AgentCliEnvFields translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<AgentCliEnvFields {...envProps} useTHook={useQuotingT} />);
    expect(screen.getByText('«Advanced: proxy & custom paths»')).toBeInTheDocument();
  });

  it('renders the translated string from the real provider, not the key', () => {
    render(inFrench(<AgentCliEnvFields {...envProps} />));
    expect(screen.getByText('Avancé : proxy et chemins')).toBeInTheDocument();
  });
});

const diagnostic: AgentDiagnostic = {
  reason: 'not-on-path',
  severity: 'error',
  message: 'claude was not found on PATH',
  fixActions: [{ kind: 'openInstall' }],
};
const handlers = { onOpenInstall: vi.fn() };

describe('AgentDiagnosticRow translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<AgentDiagnosticRow diagnostic={diagnostic} handlers={handlers} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Install»' })).toBeInTheDocument();
  });

  it('renders the translated string from the real provider, not the key', () => {
    render(inFrench(<AgentDiagnosticRow diagnostic={diagnostic} handlers={handlers} />));
    expect(screen.getByRole('button', { name: 'Installer' })).toBeInTheDocument();
  });
});

const agent: DetectedAgent = { id: 'claude', label: 'Claude Code', installed: true };
const cardProps = {
  agent,
  config: { agentId: 'claude' },
  selected: false,
  onSelect: vi.fn(),
  onModelChange: vi.fn(),
  onReasoningChange: vi.fn(),
  onEnvChange: vi.fn(),
  cliEnvFields: fields,
  agentTest: { status: 'idle' as const },
  onTest: vi.fn(),
};

describe('LocalCliAgentCard hooks', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<LocalCliAgentCard {...cardProps} selected hooks={{ ...defaultLocalCliAgentCardHooks, useT: useQuotingT }} />);
    expect(screen.getByRole('button', { name: '«Test»' })).toBeInTheDocument();
  });

  it('renders the translated string from the real provider, not the key', () => {
    render(inFrench(<LocalCliAgentCard {...cardProps} selected />));
    expect(screen.getByRole('button', { name: 'Tester' })).toBeInTheDocument();
  });
});

describe('LocalCliAgentSettings (rendered inside the selected card)', () => {
  it('renders translated field labels from the real provider, not the keys', () => {
    render(inFrench(<LocalCliAgentCard {...cardProps} selected agent={{ ...agent, models: [{ id: 'm1', label: 'Model One' }] }} />));
    expect(screen.getAllByText('Modèle').length).toBeGreaterThan(0);
    expect(screen.queryByText('Model')).toBeNull();
  });
});

describe('LocalCliAgentList hooks', () => {
  const listProps = { ...cardProps, agents: [agent], scan: { status: 'idle' as const }, onRescan: vi.fn() };

  it('renders the translator supplied through useTHook', () => {
    render(<LocalCliAgentList {...listProps} useTHook={useQuotingT} />);
    expect(screen.getByText(/«Your CLIs»/)).toBeInTheDocument();
  });

  it('renders the translated string from the real provider, not the key', () => {
    render(inFrench(<LocalCliAgentList {...listProps} />));
    expect(screen.getByText(/Vos CLI/)).toBeInTheDocument();
  });
});

describe('ByokProviderForm hooks', () => {
  const formProps = {
    config: { protocol: 'anthropic' as const, providerId: 'custom', apiKey: '', baseUrl: '', model: '' },
    onConfigChange: vi.fn(),
    preset: null,
    modelDiscovery: { status: 'idle' as const },
    connectionTest: { status: 'idle' as const },
    onTestConnection: vi.fn(),
  };

  it('renders the injected translator and hands its props to the injected form hook', () => {
    const useFormSpy = vi.fn(defaultByokProviderFormHooks.useByokProviderForm);
    render(<ByokProviderForm {...formProps} hooks={{ useT: useQuotingT, useByokProviderForm: useFormSpy }} />);
    expect(screen.getByRole('heading', { name: '«Custom endpoint»' })).toBeInTheDocument();
    expect(useFormSpy).toHaveBeenCalledWith(
      expect.objectContaining({ config: formProps.config, preset: null, apiKeyStoredExternally: false }),
    );
  });
});
