import { useEffect, useState } from 'react';
import { ArrowLeft, Archive, RotateCcw } from 'lucide-react';
import type { FlagConfig } from '@flagship/contracts';
import { useApi, type Flag, type Version } from '../../lib/api';
import { formatTime as time } from '../../lib/format';
import { TargetingRules } from './TargetingRules';

export function FlagEditor({
  initialTab,
  flag,
  admin,
  onClose,
  onSaved,
}: {
  initialTab: string;
  flag: Flag;
  admin: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const api = useApi();
  const [config, setConfig] = useState<FlagConfig>(() => structuredClone(flag.config)),
    [versions, setVersions] = useState<Version[]>([]),
    [tab, setTab] = useState(initialTab),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [metadata, setMetadata] = useState({ name: flag.name, description: flag.description });
  useEffect(() => {
    api<Version[]>('/flags/' + flag.id + '/versions')
      .then(setVersions)
      .catch((e) => setError(e.message));
  }, [api, flag.id]);
  async function save(body: unknown, path = '/flags/' + flag.id, method = 'PATCH') {
    setBusy(true);
    setError('');
    try {
      await api(path, method, body);
      await onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="flag-detail-page">
      <button className="back-link" onClick={onClose}>
        <ArrowLeft size={16} />
        Feature flags
      </button>
      <div className="detail-heading">
        <div>
          <h1>{flag.name}</h1>
          <p>Choose who gets access when this flag is enabled.</p>
        </div>
        <button
          className="status-label flag-state-button"
          disabled={!admin || busy || config.archived}
          onClick={() =>
            void save({ expectedVersion: flag.version, enabled: !flag.config.enabled })
          }
          aria-label={config.enabled ? 'Disable flag' : 'Enable flag'}
        >
          <span className={config.enabled ? 'static-switch on' : 'static-switch'} />
          {config.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>
      <div className="editor-subtitle">
        <code>{flag.key}</code>
        <span className="badge">Version {flag.version}</span>
      </div>
      <div className="editor-tabs">
        {['Targeting', 'History', 'Settings'].map((t) => (
          <button className={tab === t ? 'tab selected' : 'tab'} key={t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="modal-body editor-body">
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {tab === 'Targeting' && (
          <TargetingRules
            flag={flag}
            config={config}
            setConfig={setConfig}
            admin={admin}
            busy={busy}
            onCancel={onClose}
            onSave={() => void save({ expectedVersion: flag.version, ...config })}
          />
        )}
        {tab === 'History' && (
          <>
            <p className="muted">
              Reverting creates a new version. Previous records are preserved.
            </p>
            {versions.map((v) => (
              <div className="version-row" key={v.version}>
                <span className="version-number">v{v.version}</span>
                <div>
                  <strong>
                    {v.version === flag.version
                      ? 'Current configuration'
                      : 'Previous configuration'}
                  </strong>
                  <small>
                    {time(v.createdAt)} · {v.config.rules.length} rules ·{' '}
                    {v.config.enabled ? 'enabled' : 'disabled'}
                  </small>
                </div>
                {admin && v.version !== flag.version && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void save(
                        { expectedVersion: flag.version, version: v.version },
                        '/flags/' + flag.id + '/revert',
                        'POST',
                      )
                    }
                  >
                    <RotateCcw size={14} />
                    Restore
                  </button>
                )}
              </div>
            ))}
          </>
        )}
        {tab === 'Settings' && (
          <>
            <label>
              Display name
              <input
                value={metadata.name}
                disabled={!admin || busy}
                onChange={(e) => setMetadata((m) => ({ ...m, name: e.target.value }))}
                maxLength={100}
              />
            </label>
            <label>
              Description
              <textarea
                value={metadata.description}
                disabled={!admin || busy}
                onChange={(e) => setMetadata((m) => ({ ...m, description: e.target.value }))}
                maxLength={2000}
              />
            </label>
            {admin && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void save({ expectedVersion: flag.version, ...metadata })}
              >
                Save details
              </button>
            )}
            <h3>Flag lifecycle</h3>
            <p>
              Archived flags return the application's default value. Keep the code's fallback in
              mind before archiving.
            </p>
            {admin && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void save({ expectedVersion: flag.version, archived: !flag.config.archived })
                }
              >
                <Archive size={15} />
                {flag.config.archived ? 'Restore from archive' : 'Archive flag'}
              </button>
            )}
            {admin && flag.config.archived && (
              <div className="danger-zone">
                <h3>Delete permanently</h3>
                <p>Removes this flag and its configuration versions. Audit records remain.</p>
                <button
                  className="secondary danger"
                  disabled={busy}
                  onClick={() => {
                    if (confirm('Permanently delete ' + flag.key + ' and all its versions?'))
                      void save({ expectedVersion: flag.version }, '/flags/' + flag.id, 'DELETE');
                  }}
                >
                  Delete flag
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
