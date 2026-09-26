import { useTranslation } from 'react-i18next';
import { Dialog } from '../hud/Dialog';
import { OfficeMap } from '../hud/Minimap';

/** Large interactive plan of the office: click a desk to open it, elsewhere to go there. */
export function MapPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog title={t('map.title')} onClose={onClose} wide>
      <OfficeMap width={880} onNavigate={onClose} openDesks />
      <p className="field__hint">{t('map.hint')}</p>
    </Dialog>
  );
}
