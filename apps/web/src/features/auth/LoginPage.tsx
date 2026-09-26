import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/http';
import { LanguageSwitcher } from '../hud/LanguageSwitcher';

interface Props {
  passwordSet: boolean;
  onLoggedIn: () => void;
}

export function LoginPage({ passwordSet, onLoggedIn }: Props) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('POST', '/api/auth/login', { password });
      onLoggedIn();
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : 'unknown_error';
      setError(t(`login.errors.${code}`, { defaultValue: t('login.errors.unknown_error') }));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="login">
      <div className="login__lang">
        <LanguageSwitcher />
      </div>
      <form className="login__card panel" onSubmit={submit}>
        <h1 className="login__title">{t('app.name')}</h1>
        <p className="login__subtitle">{t('login.subtitle')}</p>
        {passwordSet ? (
          <>
            <label className="field">
              <span className="field__label">{t('login.password')}</span>
              <input
                className="input"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="button button--primary" type="submit" disabled={pending || password === ''}>
              {pending ? t('login.signingIn') : t('login.signIn')}
            </button>
          </>
        ) : (
          <div className="notice">
            <p>{t('login.noPassword')}</p>
            <code>pnpm --filter @workspace/server set-password</code>
          </div>
        )}
      </form>
    </div>
  );
}
