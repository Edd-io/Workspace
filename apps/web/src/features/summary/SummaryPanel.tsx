import { useTranslation } from 'react-i18next';
import { api } from '../../api/http';
import { currentLanguage } from '../../i18n';
import { Markdown } from '../../lib/markdown';
import { useRelativeTime } from '../../lib/time';
import { useOffice } from '../../state/officeStore';
import type { OfficeSummary } from '@workspace/shared';
import { Dialog } from '../hud/Dialog';

export async function requestSummary(reason: 'visit' | 'refresh'): Promise<void> {
  const summary = await api<OfficeSummary>('POST', '/api/summary', { reason, language: currentLanguage() });
  useOffice.getState().setSummary(summary);
}

/** The Haiku briefing: what happened since the owner's last visit. */
export function SummaryPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const summary = useOffice((state) => state.summary);
  const generatedAgo = useRelativeTime(summary?.generatedAt ?? null);
  const sinceAgo = useRelativeTime(summary?.since ?? null);
  const generating = summary?.status === 'generating';

  return (
    <Dialog title={t('summary.title')} onClose={onClose} wide>
      <div className="summary">
        <div className="summary__meta muted">
          {summary?.generatedAt
            ? t('summary.generated', { ago: generatedAgo, since: sinceAgo })
            : t('summary.none')}
        </div>
        {summary?.status === 'error' && <p className="form-error">{t('summary.error')}</p>}
        <div className="summary__text">
          {generating && !summary?.text && <p className="muted">{t('summary.generating')}</p>}
          {summary?.text && <Markdown text={summary.text} />}
        </div>
        <div className="dialog__actions">
          <button
            className="button button--primary"
            disabled={generating}
            onClick={() => void requestSummary('refresh')}
          >
            {generating ? t('summary.generating') : t('summary.refresh')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
