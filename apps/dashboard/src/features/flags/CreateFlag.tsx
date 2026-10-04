import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Info } from 'lucide-react';
import { useApi, type Application, type Feature, type Flag } from '../../lib/api';
import { FlagSteps } from './FlagSteps';

export function CreateFlag({
  application,
  features,
  onCancel,
  onCreated,
}: {
  application: Application;
  features: Feature[];
  onCancel: () => void;
  onCreated: (flag: Flag) => Promise<void>;
}) {
  const api = useApi();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const validKey = /^[a-z][a-z0-9-]{1,63}$/.test(key);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      const flag = await api<Flag>('/flags', 'POST', {
        applicationId: application.id,
        featureId: data.get('featureId'),
        name,
        key,
        description: data.get('description'),
      });
      await onCreated(flag);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="create-flag-page">
      <button className="back-link" onClick={onCancel}>
        <ArrowLeft size={17} />
        Feature flags
      </button>
      <div className="detail-heading">
        <div>
          <h1>Create a feature flag</h1>
          <p>Add a flag to {application.name}, then choose who can access it.</p>
        </div>
      </div>
      <FlagSteps />
      <form onSubmit={submit}>
        <div className="detail-columns">
          <section className="detail-panel flag-details">
            <h2>Flag details</h2>
            <label>
              Name
              <input
                required
                maxLength={100}
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!keyEdited)
                    setKey(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-|-$/g, '')
                        .slice(0, 64),
                    );
                }}
              />
              <small>A readable name for your team.</small>
            </label>
            <label>
              Flag key
              <div className="key-input">
                <input
                  required
                  pattern="[a-z][a-z0-9-]{1,63}"
                  maxLength={64}
                  value={key}
                  onChange={(e) => {
                    setKeyEdited(true);
                    setKey(e.target.value);
                  }}
                />
                {validKey && <Check size={18} />}
              </div>
              <small>Use this key in your application code. It cannot be changed later.</small>
            </label>
            <label>
              Description <span className="optional">(optional)</span>
              <textarea name="description" rows={3} maxLength={2000} />
            </label>
            <label>
              Feature group
              <select name="featureId" required defaultValue={features[0]?.id}>
                {features.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="disabled-callout">
              <span className="static-switch" />
              <div>
                <strong>Created disabled</strong>
                <p>Enable the flag after you have configured its rules.</p>
              </div>
            </div>
          </section>
          <aside className="detail-panel how-it-works">
            <h2>How it works</h2>
            <ol>
              <li>
                <strong>Create your flag</strong>
                <p>
                  Give it a name, key and description so your team understands what it controls.
                </p>
              </li>
              <li>
                <strong>Choose your audience</strong>
                <p>Set targeting rules to decide who can see the change.</p>
              </li>
              <li>
                <strong>Enable when ready</strong>
                <p>
                  The flag is created in a disabled state. Enable it after you have configured its
                  rules.
                </p>
              </li>
            </ol>
            <div className="key-preview">
              <strong>Flag key</strong>
              <div>
                <code>{key || 'your-flag-key'}</code>
                <button
                  type="button"
                  className="icon-button"
                  disabled={!key}
                  aria-label="Copy flag key"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(key)
                      .then(() => setCopied(true))
                      .catch(() => setError('Could not copy the flag key.'));
                  }}
                >
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                </button>
              </div>
            </div>
          </aside>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="create-footer">
          <p>
            <Info size={17} />
            The flag starts disabled. Creating it won’t change what users see.
          </p>
          <div>
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
            <button className="primary" disabled={busy || !features.length}>
              {busy ? 'Creating…' : 'Create flag & add rules'}
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
