import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type TranslationDict, type useT } from '../../../i18n/index.js';
import { ConnectorAlertList } from '../../components/ConnectorAlertList.js';
import { ConnectorGrid } from '../../components/ConnectorGrid.js';
import { ConnectorCard } from '../../components/ConnectorCard.js';
import { ConnectorDetailDrawer } from '../../components/ConnectorDetailDrawer.js';
import { ConnectorSearchBar } from '../../components/ConnectorSearchBar.js';
import { ProviderTabBar } from '../../components/ProviderTabBar.js';
import type { Connector } from '../../types.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

const FR: TranslationDict = {
  Connect: 'Connecter',
  Close: 'Fermer',
  'Search connectors': 'Rechercher des connecteurs',
  'Connector provider': 'Fournisseur de connecteurs',
  'Open details for {name}': 'Ouvrir les détails de {name}',
  'Clear search': 'Effacer la recherche',
};

function inFrench(ui: React.ReactNode) {
  return <I18nProvider dictionaries={{ fr: FR }} initialLocale="fr">{ui}</I18nProvider>;
}

const connector: Connector = { id: 'slack', name: 'Slack', provider: 'Connector Provider', category: 'communication', status: 'available', tools: [] };
const noop = () => {};
const cardProps = {
  connector,
  pendingAction: null,
  authorizationCancelFailed: false,
  toolsLoaded: false,
  onConnect: noop,
  onDisconnect: noop,
  onCancelAuthorization: noop,
  onOpenDetails: noop,
};
const drawerProps = {
  connector,
  disabled: false,
  pendingAction: null,
  authorizationCancelFailed: false,
  authorizationError: null,
  toolsPreviewLoading: false,
  toolsLoaded: true,
  onClose: noop,
  onConnect: noop,
  onDisconnect: noop,
  onCancelAuthorization: noop,
  onLoadMoreTools: noop,
};
const tabs = [{ id: 'a', label: 'A', match: () => true }];
const alerts = [{ connectorId: 'a', connectorName: 'A', message: 'boom' }];

describe('ConnectorCard translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<ConnectorCard {...cardProps} useTHook={useQuotingT} />);
    expect(screen.getByLabelText('«Open details for {name}»')).toBeInTheDocument();
  });

  it('renders the translated label from the real provider, not the key', () => {
    render(inFrench(<ConnectorCard {...cardProps} />));
    expect(screen.getByRole('button', { name: 'Connecter' })).toBeInTheDocument();
  });
});

describe('ConnectorDetailDrawer translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<ConnectorDetailDrawer {...drawerProps} authorizationCancelFailed useTHook={useQuotingT} />);
    expect(screen.getByText("«Couldn't cancel authorization. Try again.»")).toBeInTheDocument();
  });

  it('renders the translated label from the real provider, not the key', () => {
    render(inFrench(<ConnectorDetailDrawer {...drawerProps} />));
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
  });
});

describe('ConnectorSearchBar translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<ConnectorSearchBar value="" onChange={noop} useTHook={useQuotingT} />);
    expect(screen.getByPlaceholderText('«Search connectors»')).toBeInTheDocument();
  });

  it('renders the translated placeholder from the real provider, not the key', () => {
    render(inFrench(<ConnectorSearchBar value="" onChange={noop} />));
    expect(screen.getByPlaceholderText('Rechercher des connecteurs')).toBeInTheDocument();
  });
});

describe('ProviderTabBar translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<ProviderTabBar tabs={tabs} selectedId="a" onSelect={noop} useTHook={useQuotingT} />);
    expect(screen.getByRole('tablist', { name: '«Connector provider»' })).toBeInTheDocument();
  });

  it('renders the translated label from the real provider, not the key', () => {
    render(inFrench(<ProviderTabBar tabs={tabs} selectedId="a" onSelect={noop} />));
    expect(screen.getByRole('tablist', { name: 'Fournisseur de connecteurs' })).toBeInTheDocument();
  });
});

describe('ConnectorAlertList translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<ConnectorAlertList alerts={alerts} onOpenDetails={noop} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Open details for {name}»' })).toBeInTheDocument();
  });

  it('renders the translated, interpolated label from the real provider, not the key', () => {
    render(inFrench(<ConnectorAlertList alerts={alerts} onOpenDetails={noop} />));
    expect(screen.getByRole('button', { name: 'Ouvrir les détails de A' })).toBeInTheDocument();
  });
});

describe('ConnectorGrid empty state (rendered through the grid)', () => {
  it('renders the translated empty-state action from the real provider, not the key', () => {
    render(
      inFrench(
        <ConnectorGrid
          connectors={[]}
          locked={false}
          hasNoResults
          searchQuery="zzz"
          pendingConnectorAction={null}
          authorizationPending={{}}
          authorizationCancelFailed={{}}
          toolsLoaded={false}
          onConnect={noop}
          onDisconnect={noop}
          onCancelAuthorization={noop}
          onOpenDetails={noop}
          onClearSearch={noop}
        />,
      ),
    );
    expect(screen.getByRole('button', { name: 'Effacer la recherche' })).toBeInTheDocument();
  });
});
