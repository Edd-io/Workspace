import type { IntegrationDiff, IntegrationStatus, MergeOutcome, PullRequestInfo } from '@workspace/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/http';
import { parseDiff, type DiffFile } from '../../lib/diff';
import { useOffice } from '../../state/officeStore';
import { Dialog } from '../hud/Dialog';

/** Desk states during which the desk may still be writing to its worktree. */
const BUSY_STATES = new Set(['working', 'compacting', 'starting']);
const MAX_COMMITS_SHOWN = 12;
const MAX_DIFF_LINES = 1500;

type Result = { tone: 'success' | 'error'; text: string; url?: string };

/** Review a worktree desk's work and bring it into a branch of the project: merge or pull request. */
export function IntegrationDialog({ deskId, onClose }: { deskId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const desk = useOffice((state) => state.desks[deskId]);
  const [target, setTarget] = useState<string | null>(null);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pullRequest, setPullRequest] = useState<PullRequestInfo | null>(null);
  const [diff, setDiff] = useState<IntegrationDiff | null>(null);
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [prForm, setPrForm] = useState<{ title: string; body: string } | null>(null);

  const errorText = useCallback(
    (error: unknown) => {
      const code = error instanceof ApiError ? error.code : 'unknown_error';
      const details = error instanceof ApiError ? error.details : {};
      const message = error instanceof ApiError ? error.message : String(error);
      return t(`integration.errors.${code}`, {
        defaultValue: t('integration.errors.generic', { message }),
        path: details.path,
        target: details.target,
        message,
      });
    },
    [t],
  );

  const load = useCallback(
    async (nextTarget: string | null) => {
      setLoadError(null);
      try {
        const query = nextTarget ? `?target=${encodeURIComponent(nextTarget)}` : '';
        const next = await api<IntegrationStatus>('GET', `/api/desks/${deskId}/integration${query}`);
        setStatus(next);
        setTarget(next.target);
        setDiff(null);
      } catch (error) {
        setLoadError(errorText(error));
      }
    },
    [deskId, errorText],
  );

  useEffect(() => {
    void load(null);
    api<PullRequestInfo>('GET', `/api/desks/${deskId}/integration/pull-request`)
      .then(setPullRequest)
      .catch(() => setPullRequest(null));
  }, [deskId, load]);

  // The diff is only fetched when a file is opened for the first time.
  const ensureDiff = useCallback(async () => {
    if (diff || !target) return;
    try {
      setDiff(
        await api<IntegrationDiff>(
          'GET',
          `/api/desks/${deskId}/integration/diff?target=${encodeURIComponent(target)}`,
        ),
      );
    } catch (error) {
      setResult({ tone: 'error', text: errorText(error) });
    }
  }, [deskId, diff, errorText, target]);

  const committedFiles = useMemo(() => (diff ? parseDiff(diff.committed) : []), [diff]);
  const uncommittedFiles = useMemo(() => (diff ? parseDiff(diff.uncommitted) : []), [diff]);

  if (!desk) return null;
  const busy = BUSY_STATES.has(desk.state);

  const act = async (name: string, action: () => Promise<Result | null>) => {
    setPending(name);
    setResult(null);
    try {
      const outcome = await action();
      if (outcome) setResult(outcome);
      await load(target);
    } catch (error) {
      setResult({ tone: 'error', text: errorText(error) });
    } finally {
      setPending(null);
    }
  };

  const mergeResult = (outcome: MergeOutcome, into: string): Result => {
    if (outcome.status === 'merged') {
      return { tone: 'success', text: t('integration.merged', { count: outcome.commits, target: into }) };
    }
    if (outcome.status === 'up_to_date') return { tone: 'success', text: t('integration.upToDate') };
    return {
      tone: 'error',
      text: t('integration.conflictsFound', { files: outcome.files.join(', ') }),
    };
  };

  const toggleFile = (key: string) => {
    void ensureDiff();
    setOpenFiles((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const additions = status?.files.reduce((sum, file) => sum + (file.additions ?? 0), 0) ?? 0;
  const deletions = status?.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0) ?? 0;
  const canMerge =
    !!status && status.ahead > 0 && status.conflicts.length === 0 && !status.targetWorktreeDirty;

  const openPrForm = () => {
    if (!status) return;
    const title = desk.sessionTitle ?? status.commits[0]?.subject ?? desk.name;
    const commits = status.commits.map((commit) => `- ${commit.subject}`).join('\n');
    setPrForm({ title, body: t('integration.pr.defaultBody', { desk: desk.name, commits }) });
  };

  return (
    <Dialog title={t('integration.title', { desk: desk.name })} onClose={onClose} wide>
      <div className="integration">
        {loadError && <p className="form-error">{loadError}</p>}
        {!status && !loadError && <p className="muted">{t('integration.loading')}</p>}
        {status && (
          <>
            <div className="integration__branches">
              <code>{status.branch}</code>
              <span aria-hidden="true">→</span>
              <label className="integration__target">
                <span className="muted">{t('integration.target')}</span>
                <select
                  className="input"
                  value={status.target}
                  onChange={(event) => void load(event.target.value)}
                >
                  {status.branches.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                      {branch === status.baseBranch ? ` (${t('integration.base')})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="integration__summary">
              {status.ahead === 0
                ? t('integration.nothingToMerge', { target: status.target })
                : t('integration.ahead', {
                    count: status.ahead,
                    files: status.files.length,
                    additions,
                    deletions,
                  })}
              {status.behind > 0 && (
                <span className="muted">
                  {' '}
                  · {t('integration.behind', { count: status.behind, target: status.target })}
                </span>
              )}
            </p>

            {status.uncommitted.length > 0 && (
              <section className="integration__box integration__box--warning">
                <strong>{t('integration.uncommitted.title', { count: status.uncommitted.length })}</strong>
                <p className="muted">{t('integration.uncommitted.hint')}</p>
                <div className="integration__commit">
                  <input
                    className="input"
                    value={commitMessage}
                    placeholder={
                      desk.sessionTitle ?? t('integration.uncommitted.placeholder', { desk: desk.name })
                    }
                    onChange={(event) => setCommitMessage(event.target.value)}
                  />
                  <button
                    className="button"
                    disabled={busy || pending !== null}
                    onClick={() =>
                      void act('commit', async () => {
                        const message =
                          commitMessage.trim() ||
                          desk.sessionTitle ||
                          t('integration.uncommitted.placeholder', { desk: desk.name });
                        await api('POST', `/api/desks/${deskId}/integration/commit`, { message });
                        setCommitMessage('');
                        return { tone: 'success', text: t('integration.uncommitted.done') };
                      })
                    }
                  >
                    {t('integration.uncommitted.commit')}
                  </button>
                </div>
                {busy && <p className="field__hint">{t('integration.busy')}</p>}
              </section>
            )}

            {status.conflicts.length > 0 && (
              <section className="integration__box integration__box--danger">
                <strong>{t('integration.conflicts.title', { target: status.target })}</strong>
                <p>
                  {status.conflicts.map((file) => (
                    <code key={file} className="integration__file-chip">
                      {file}
                    </code>
                  ))}
                </p>
                <p className="muted">{t('integration.conflicts.hint', { desk: desk.name })}</p>
                <button
                  className="button"
                  disabled={desk.state !== 'idle' || pending !== null}
                  onClick={() =>
                    void act('ask', async () => {
                      await api('POST', `/api/desks/${deskId}/prompt`, {
                        text: t('integration.conflicts.prompt', {
                          target: status.target,
                          branch: status.branch,
                        }),
                      });
                      return { tone: 'success', text: t('integration.conflicts.asked', { desk: desk.name }) };
                    })
                  }
                >
                  {t('integration.conflicts.ask', { desk: desk.name, target: status.target })}
                </button>
                {desk.state !== 'idle' && <p className="field__hint">{t('integration.notIdle')}</p>}
              </section>
            )}

            {status.commits.length > 0 && (
              <section className="integration__section">
                <h3>{t('integration.commits')}</h3>
                <ul className="integration__commits">
                  {status.commits.slice(0, MAX_COMMITS_SHOWN).map((commit) => (
                    <li key={commit.sha}>
                      <code>{commit.sha.slice(0, 7)}</code> {commit.subject}
                    </li>
                  ))}
                  {status.commits.length > MAX_COMMITS_SHOWN && (
                    <li className="muted">
                      {t('integration.moreCommits', { count: status.commits.length - MAX_COMMITS_SHOWN })}
                    </li>
                  )}
                </ul>
              </section>
            )}

            {(status.files.length > 0 || status.uncommitted.length > 0) && (
              <section className="integration__section">
                <h3>{t('integration.files')}</h3>
                <div className="integration__files">
                  {status.files.map((file) => (
                    <FileEntry
                      key={`c:${file.path}`}
                      label={file.path}
                      status={file.status}
                      additions={file.additions}
                      deletions={file.deletions}
                      open={openFiles.has(`c:${file.path}`)}
                      diff={committedFiles.find((entry) => entry.path === file.path)}
                      loading={!diff}
                      onToggle={() => toggleFile(`c:${file.path}`)}
                    />
                  ))}
                  {status.uncommitted.map((file) => (
                    <FileEntry
                      key={`u:${file.path}`}
                      label={file.path}
                      status={file.status}
                      tag={t('integration.uncommitted.tag')}
                      open={openFiles.has(`u:${file.path}`)}
                      diff={uncommittedFiles.find((entry) => entry.path === file.path)}
                      untracked={diff?.untracked.includes(file.path)}
                      loading={!diff}
                      onToggle={() => toggleFile(`u:${file.path}`)}
                    />
                  ))}
                </div>
                {diff?.truncated && <p className="field__hint">{t('integration.truncated')}</p>}
              </section>
            )}

            {prForm && (
              <section className="integration__box">
                <strong>{t('integration.pr.title')}</strong>
                <label className="field">
                  <span className="field__label">{t('integration.pr.titleField')}</span>
                  <input
                    className="input"
                    value={prForm.title}
                    onChange={(event) => setPrForm({ ...prForm, title: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field__label">{t('integration.pr.body')}</span>
                  <textarea
                    className="input"
                    rows={6}
                    value={prForm.body}
                    onChange={(event) => setPrForm({ ...prForm, body: event.target.value })}
                  />
                </label>
                <div className="dialog__actions">
                  <button className="button" onClick={() => setPrForm(null)}>
                    {t('common.cancel')}
                  </button>
                  <button
                    className="button button--primary"
                    disabled={pending !== null || !prForm.title.trim()}
                    onClick={() =>
                      void act('pr', async () => {
                        const { url } = await api<{ url: string }>(
                          'POST',
                          `/api/desks/${deskId}/integration/pull-request`,
                          { target: status.target, ...prForm },
                        );
                        setPrForm(null);
                        setPullRequest((current) => (current ? { ...current, existingUrl: url } : current));
                        return { tone: 'success', text: t('integration.pr.created'), url };
                      })
                    }
                  >
                    {pending === 'pr' ? t('integration.pr.creating') : t('integration.pr.create')}
                  </button>
                </div>
              </section>
            )}

            {result && (
              <p className={result.tone === 'error' ? 'form-error' : 'integration__success'}>
                {result.text}{' '}
                {result.url && (
                  <a href={result.url} target="_blank" rel="noreferrer">
                    {result.url}
                  </a>
                )}
              </p>
            )}

            {status.ahead > 0 && (
              <p className="field__hint">
                {status.targetWorktreeDirty
                  ? t('integration.targetDirty', { path: status.targetWorktree, target: status.target })
                  : status.targetWorktree
                    ? t('integration.mergeInCheckout', { path: status.targetWorktree, target: status.target })
                    : t('integration.mergeWithoutCheckout', { target: status.target })}
              </p>
            )}
            <div className="dialog__actions integration__actions">
              {status.behind > 0 && (
                <button
                  className="button"
                  disabled={busy || pending !== null}
                  title={t('integration.updateHint', { target: status.target })}
                  onClick={() =>
                    void act('update', async () =>
                      mergeResult(
                        await api<MergeOutcome>('POST', `/api/desks/${deskId}/integration/update`, {
                          target: status.target,
                        }),
                        status.branch,
                      ),
                    )
                  }
                >
                  {t('integration.update', { target: status.target })}
                </button>
              )}
              {pullRequest?.existingUrl ? (
                <a className="button" href={pullRequest.existingUrl} target="_blank" rel="noreferrer">
                  {t('integration.pr.open')}
                </a>
              ) : (
                <button
                  className="button"
                  disabled={!pullRequest?.available || status.ahead === 0 || pending !== null || !!prForm}
                  title={
                    pullRequest && !pullRequest.available && pullRequest.reason
                      ? t(`integration.pr.unavailable.${pullRequest.reason}`)
                      : undefined
                  }
                  onClick={openPrForm}
                >
                  {t('integration.pr.start')}
                </button>
              )}
              <button
                className="button button--primary"
                disabled={!canMerge || pending !== null}
                onClick={() =>
                  void act('merge', async () =>
                    mergeResult(
                      await api<MergeOutcome>('POST', `/api/desks/${deskId}/integration/merge`, {
                        target: status.target,
                      }),
                      status.target,
                    ),
                  )
                }
              >
                {pending === 'merge'
                  ? t('integration.merging')
                  : t('integration.merge', { target: status.target })}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function FileEntry({
  label,
  status,
  additions,
  deletions,
  tag,
  open,
  diff,
  untracked,
  loading,
  onToggle,
}: {
  label: string;
  status: string;
  additions?: number | null;
  deletions?: number | null;
  tag?: string;
  open: boolean;
  diff: DiffFile | undefined;
  untracked?: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="integration-file">
      <button className="integration-file__header" onClick={onToggle} aria-expanded={open}>
        <span className={`integration-file__status integration-file__status--${status.charAt(0)}`}>
          {status}
        </span>
        <span className="integration-file__path">{label}</span>
        {tag && <span className="tag">{tag}</span>}
        {additions !== undefined && (
          <span className="integration-file__stats">
            {additions === null ? (
              t('integration.binary')
            ) : (
              <>
                <span className="integration-file__add">+{additions}</span>{' '}
                <span className="integration-file__del">−{deletions}</span>
              </>
            )}
          </span>
        )}
      </button>
      {open && (
        <div className="integration-file__diff">
          {loading && <p className="muted">{t('integration.loading')}</p>}
          {!loading && untracked && <p className="muted">{t('integration.untracked')}</p>}
          {!loading && !untracked && !diff && <p className="muted">{t('integration.noDiff')}</p>}
          {diff?.binary && <p className="muted">{t('integration.binary')}</p>}
          {diff && !diff.binary && (
            <pre>
              {diff.lines.slice(0, MAX_DIFF_LINES).map((line, index) => (
                <div key={index} className={`diff-line diff-line--${line.kind}`}>
                  {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : line.kind === 'context' ? ' ' : ''}
                  {line.text}
                </div>
              ))}
              {diff.lines.length > MAX_DIFF_LINES && (
                <div className="diff-line diff-line--meta">
                  {t('integration.moreLines', { count: diff.lines.length - MAX_DIFF_LINES })}
                </div>
              )}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
