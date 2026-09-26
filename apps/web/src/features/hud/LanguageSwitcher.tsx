import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../../i18n';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage;
  return (
    <div className="segmented" role="group" aria-label={t('hud.language')}>
      {SUPPORTED_LANGUAGES.map((language) => (
        <button
          key={language}
          className={`segmented__item${current === language ? ' segmented__item--active' : ''}`}
          onClick={() => void i18n.changeLanguage(language)}
          aria-pressed={current === language}
        >
          {t(`languages.${language}`)}
        </button>
      ))}
    </div>
  );
}
