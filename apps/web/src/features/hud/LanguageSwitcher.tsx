import { useTranslation } from 'react-i18next';
import { currentLanguage, languageName, SUPPORTED_LANGUAGES } from '../../i18n';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <select
      className="input language-select"
      aria-label={t('hud.language')}
      value={currentLanguage()}
      onChange={(event) => void i18n.changeLanguage(event.target.value)}
    >
      {SUPPORTED_LANGUAGES.map((language) => (
        <option key={language} value={language} lang={language}>
          {languageName(language)}
        </option>
      ))}
    </select>
  );
}
