import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from './api/http';
import { LoginPage } from './features/auth/LoginPage';

const Office = lazy(() => import('./Office').then((module) => ({ default: module.Office })));

interface AuthStatus {
  authenticated: boolean;
  passwordSet: boolean;
}

export function App() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    api<AuthStatus>('GET', '/api/auth/me')
      .then((next) => {
        setStatus(next);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(refresh, [refresh]);

  if (error) {
    return (
      <div className="splash">
        <p>{t('app.serverUnreachable')}</p>
        <button className="button" onClick={refresh}>
          {t('common.retry')}
        </button>
      </div>
    );
  }
  if (!status) return <div className="splash">{t('app.loading')}</div>;
  if (!status.authenticated) {
    return <LoginPage passwordSet={status.passwordSet} onLoggedIn={refresh} />;
  }
  return (
    <Suspense fallback={<div className="splash">{t('app.loading')}</div>}>
      <Office onLoggedOut={refresh} />
    </Suspense>
  );
}
