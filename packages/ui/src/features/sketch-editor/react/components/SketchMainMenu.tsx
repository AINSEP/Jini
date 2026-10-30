import { Icon } from '../../../../react/components/Icon.js';
import type { SketchMainMenuComponent } from '../../ports.js';
import type { SketchTranslate } from '../../types.js';

export interface SketchMainMenuProps {
  MainMenu: SketchMainMenuComponent;
  t: SketchTranslate;
  saving: boolean;
  showSaved: boolean;
  canSave: boolean;
  onSave: () => void;
  exportAvailable: boolean;
  exporting: boolean;
  canExport: boolean;
  onExportImage: () => void;
  canClear: boolean;
  onClear: () => void;
}

/** The composed `<MainMenu>` Excalidraw renders inside its own menu popover. */
export function SketchMainMenu({
  MainMenu,
  t,
  saving,
  showSaved,
  canSave,
  onSave,
  exportAvailable,
  exporting,
  canExport,
  onExportImage,
  canClear,
  onClear,
}: SketchMainMenuProps) {
  const idleSaveLabel = showSaved ? t('Saved') : t('Save');
  const saveLabel = saving ? t('Saving…') : idleSaveLabel;
  const exportLabel = exporting ? t('Exporting image…') : t('Export image');

  return (
    <MainMenu>
      <MainMenu.Item
        data-testid="sketch-menu-save"
        icon={showSaved ? <Icon name="check" size={16} /> : undefined}
        onClick={onSave}
        disabled={saving || !canSave}
        aria-label={saveLabel}
      >
        {saveLabel}
      </MainMenu.Item>
      {exportAvailable ? (
        <MainMenu.Item
          data-testid="sketch-menu-export-image"
          icon={<Icon name="download" size={16} />}
          onClick={onExportImage}
          disabled={exporting || !canExport}
          aria-label={exportLabel}
        >
          {exportLabel}
        </MainMenu.Item>
      ) : null}
      <MainMenu.Separator />
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.Help />
      <MainMenu.Item
        data-testid="sketch-menu-clear"
        icon={<Icon name="trash" size={16} />}
        onClick={onClear}
        disabled={!canClear}
      >
        {t('Clear canvas')}
      </MainMenu.Item>
      <MainMenu.Separator />
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
}
