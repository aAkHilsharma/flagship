import { ApplicationList } from './features/applications/ApplicationList';
import { CreateFlag } from './features/flags/CreateFlag';
import { FlagEditor } from './features/flags/FlagEditor';
import { Menu } from './components/Menu';
import { Modal } from './components/Modal';
import { Empty } from './components/Empty';
import { formatTime as time } from './lib/format';
import { Brand } from './components/Brand';
import { OrganizationSwitcher } from '@clerk/react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Play,
  Circle,
  Info,
  Grid2X2,
  ArrowUpRight,
  Archive,
  Check,
  ChevronRight,
  Copy,
  Flag as FlagIcon,
  History,
  KeyRound,
  Layers,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import {
  useApi,
  type Application,
  type Audit,
  type Credential,
  type Feature,
  type Flag,
  type User,
} from './lib/api';

type Page = 'applications' | 'settings' | 'flags' | 'features' | 'credentials' | 'audit';
type ModalState = {
  kind: 'application' | 'feature' | 'flag' | 'credential';
  item?: Application | Feature;
} | null;
const status = (flag: Flag) =>
  flag.config.archived ? 'Archived' : flag.config.enabled ? 'Enabled' : 'Disabled';
const isNew = (flag: Flag) => flag.version === 1 && !flag.config.enabled && !flag.config.archived;

export function App({ user }: { user: User }) {
  const api = useApi();
  const [page, setPage] = useState<Page>('applications');
  const [applications, setApplications] = useState<Application[]>([]),
    [appId, setAppId] = useState(''),
    [flags, setFlags] = useState<Flag[]>([]),
    [features, setFeatures] = useState<Feature[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]),
    [keys, setKeys] = useState<Credential[]>([]);
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('All flags'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<ModalState>(null),
    [selected, setSelected] = useState<Flag | null>(null),
    [editorTab, setEditorTab] = useState('Targeting'),
    [secret, setSecret] = useState('');
  const creatingFlag = modal?.kind === 'flag';
  const detailOpen = creatingFlag || !!selected;
  const admin = user?.role === 'admin',
    canToggle = user?.role !== 'auditor';
  const current = applications.find((a) => a.id === appId);
  const loadSequence = useRef(0);
  const refreshApps = useCallback(async () => {
    const apps = await api<Application[]>('/applications');
    setApplications(apps);
    setAppId((id) => (apps.some((a) => a.id === id) ? id : (apps[0]?.id ?? '')));
  }, [api]);
  useEffect(() => {
    if (user) void refreshApps().catch((e) => setError(e.message));
  }, [user, refreshApps]);
  const load = useCallback(async () => {
    if (!user) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      if (appId && (page === 'flags' || page === 'features')) {
        const [f, ft] = await Promise.all([
          api<Flag[]>('/flags?applicationId=' + appId),
          api<Feature[]>('/features?applicationId=' + appId),
        ]);
        if (sequence !== loadSequence.current) return;
        setFlags(f);
        setFeatures(ft);
      }
      if (page === 'audit') {
        const rows = await api<Audit[]>('/audit' + (appId ? '?applicationId=' + appId : ''));
        if (sequence === loadSequence.current) setAudit(rows);
      }
      if (page === 'credentials' && appId && user.role === 'admin') {
        const rows = await api<Credential[]>('/applications/' + appId + '/credentials');
        if (sequence === loadSequence.current) setKeys(rows);
      }
    } catch (e) {
      if (sequence === loadSequence.current) setError((e as Error).message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [api, appId, page, user]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setFlags([]);
    setFeatures([]);
    setKeys([]);
    setAudit([]);
  }, [appId]);
  useEffect(() => {
    setSelected(null);
    setSearch('');
    setFilter('All flags');
    setEditorTab('Targeting');
  }, [appId, page]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  async function action(fn: () => Promise<unknown>, message: string) {
    setError('');
    try {
      await fn();
      await Promise.all([load(), refreshApps()]);
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function toggle(flag: Flag) {
    await action(
      () =>
        api('/flags/' + flag.id, 'PATCH', {
          expectedVersion: flag.version,
          enabled: !flag.config.enabled,
        }),
      flag.config.enabled ? 'Flag disabled' : 'Flag enabled',
    );
  }
  async function saveForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal || modal.kind === 'flag') return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const kind = modal.kind,
      item = modal.item;
    const endpoint =
      kind === 'application'
        ? '/applications'
        : kind === 'feature'
          ? '/features'
          : '/applications/' + appId + '/credentials';
    const body =
      kind === 'application'
        ? { name: data.name, description: data.description, ...(!item ? { key: data.key } : {}) }
        : kind === 'feature'
          ? {
              name: data.name,
              description: data.description,
              ...(!item ? { applicationId: appId } : {}),
            }
          : { name: data.name };
    setError('');
    try {
      const result = await api<{ token?: string; id?: string }>(
        endpoint + (item ? '/' + item.id : ''),
        item ? 'PATCH' : 'POST',
        body,
      );
      if (result.token) setSecret(result.token);
      setModal(null);
      await Promise.all([refreshApps(), load()]);
      if (kind === 'application' && !item && result.id) {
        setAppId(result.id);
        setPage('flags');
      }
      setNotice(item ? 'Changes saved' : 'Created successfully');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const nav: [Page, string, typeof FlagIcon][] = [
    ['flags', 'Feature flags', FlagIcon],
    ['audit', 'Activity', History],
    ['settings', 'Settings', Settings2],
  ];
  const titles: Record<Page, string> = {
    applications: 'Applications',
    settings: 'Settings',
    flags: 'Feature flags',
    features: 'Feature groups',
    credentials: 'SDK credentials',
    audit: 'Activity',
  };
  function openFlag(flag: Flag, tab = 'Targeting') {
    setEditorTab(tab);
    setSelected(flag);
    setError('');
  }
  const visible = flags.filter(
    (f) =>
      f.applicationId === appId &&
      (filter === 'All flags' || status(f) === filter || (filter === 'New' && isNew(f))) &&
      `${f.name} ${f.key}`.toLowerCase().includes(search.toLowerCase()),
  );
  const createKind =
    page === 'applications'
      ? 'application'
      : page === 'flags'
        ? 'flag'
        : page === 'features'
          ? 'feature'
          : page === 'credentials'
            ? 'credential'
            : null;
  const creationAllowed =
    admin &&
    createKind &&
    (page === 'applications' || !!appId) &&
    (page !== 'flags' || features.length > 0);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <button
          className={
            page === 'applications' ? 'nav active applications-nav' : 'nav applications-nav'
          }
          onClick={() => {
            setSelected(null);
            setModal(null);
            setPage('applications');
          }}
        >
          <Grid2X2 size={19} />
          Applications<span className="nav-count">{applications.length}</span>
        </button>
        {!detailOpen && page !== 'applications' && (
          <nav className="application-nav">
            {nav
              .filter(([id]) => id !== 'credentials' || admin)
              .map(([id, label, Icon]) => (
                <button
                  key={id}
                  className={page === id ? 'nav active' : 'nav'}
                  onClick={() => {
                    setSelected(null);
                    setModal(null);
                    setPage(id);
                    setError('');
                  }}
                >
                  <Icon size={18} />
                  {label}
                  {id === 'flags' && <span className="nav-count">{flags.length}</span>}
                </button>
              ))}
          </nav>
        )}
        <div className="account-actions">
          <OrganizationSwitcher
            hidePersonal
            organizationProfileMode="modal"
            afterSelectOrganizationUrl="/"
            afterCreateOrganizationUrl="/"
          />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              onClick={() => {
                setSelected(null);
                setModal(null);
                setPage('applications');
              }}
            >
              Applications
            </button>
            {page !== 'applications' && (
              <>
                <ChevronRight size={14} />
                <button
                  onClick={() => {
                    setSelected(null);
                    setModal(null);
                    setPage('flags');
                  }}
                >
                  {current?.name ?? 'Organization'}
                </button>
                <ChevronRight size={14} />
                <strong>{creatingFlag ? 'Create flag' : (selected?.name ?? titles[page])}</strong>
              </>
            )}
          </div>
        </header>
        <main className="content">
          {creatingFlag && current ? (
            <CreateFlag
              application={current}
              features={features}
              onCancel={() => setModal(null)}
              onCreated={async (flag) => {
                setModal(null);
                openFlag(flag);
                await Promise.all([load(), refreshApps()]);
              }}
            />
          ) : selected ? (
            <FlagEditor
              key={selected.id}
              initialTab={editorTab}
              flag={selected}
              admin={admin}
              onClose={() => setSelected(null)}
              onSaved={async () => {
                await Promise.all([load(), refreshApps()]);
                setNotice('Configuration saved');
              }}
            />
          ) : (
            <>
              {page === 'flags' && current && (
                <div className="application-identity">
                  <span className="app-monogram">{current.name[0].toUpperCase()}</span>
                  <div>
                    <strong>{current.name}</strong>
                    <span>Application</span>
                  </div>
                </div>
              )}
              <div className="page-heading">
                <div>
                  <h1>{titles[page]}</h1>
                  {page === 'flags' && <p>Control what ships. Choose who sees it.</p>}
                  {page === 'applications' && (
                    <p>Choose an application to manage its feature flags.</p>
                  )}
                </div>
                <div className="heading-actions">
                  {current && page !== 'applications' && (
                    <Menu label="Application actions">
                      {admin && (
                        <button onClick={() => setModal({ kind: 'application', item: current })}>
                          <Pencil size={16} />
                          Edit application
                        </button>
                      )}
                      <button onClick={() => setPage('flags')}>
                        <FlagIcon size={16} />
                        Flags
                      </button>
                      <button onClick={() => setPage('features')}>
                        <Layers size={16} />
                        Feature groups
                      </button>
                      {admin && (
                        <button onClick={() => setPage('credentials')}>
                          <KeyRound size={16} />
                          SDK credentials
                        </button>
                      )}
                      {admin && (
                        <button
                          className="danger menu-separated"
                          onClick={() => {
                            if (confirm('Delete this application? It must have no features.'))
                              void action(
                                () => api('/applications/' + current.id, 'DELETE'),
                                'Application deleted',
                              );
                          }}
                        >
                          <Trash2 size={16} />
                          Delete application
                        </button>
                      )}
                    </Menu>
                  )}
                  {creationAllowed && (
                    <button
                      className="primary"
                      onClick={() => {
                        setError('');
                        setModal({ kind: createKind! });
                      }}
                    >
                      <Plus size={17} />
                      Create {createKind === 'feature' ? 'group' : createKind}
                    </button>
                  )}
                </div>
              </div>
              {error && (
                <div role="alert" className="error">
                  {error}
                  <button
                    className="icon-button"
                    aria-label="Dismiss error"
                    onClick={() => setError('')}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              {page === 'flags' && (
                <>
                  <section className="flag-stats" aria-label="Flag totals">
                    <div>
                      <span className="stat-icon purple">
                        <FlagIcon size={24} />
                      </span>
                      <div>
                        <span>Total flags</span>
                        <strong>{flags.length}</strong>
                      </div>
                    </div>
                    <div>
                      <span className="stat-icon green">
                        <Play size={24} />
                      </span>
                      <div>
                        <span>Enabled</span>
                        <strong>
                          {flags.filter((f) => f.config.enabled && !f.config.archived).length}
                        </strong>
                      </div>
                    </div>
                    <div>
                      <span className="stat-icon gray">
                        <Circle size={24} />
                      </span>
                      <div>
                        <span>Disabled</span>
                        <strong>
                          {flags.filter((f) => !f.config.enabled && !f.config.archived).length}
                        </strong>
                      </div>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="table-toolbar">
                      <div className="tabs">
                        {['All flags', 'Enabled', 'Disabled', 'Archived'].map((t) => (
                          <button
                            key={t}
                            className={filter === t ? 'tab selected' : 'tab'}
                            onClick={() => setFilter(t)}
                          >
                            {t}{' '}
                            <span className="filter-count">
                              {flags.filter((f) => t === 'All flags' || status(f) === t).length}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="search">
                        <Search size={16} />
                        <input
                          aria-label="Search flags"
                          placeholder="Search flags by name or key…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Flag / key</th>
                            <th>Status</th>
                            <th>Targeting rules</th>
                            <th>Updated</th>
                            <th>
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {visible.map((f) => (
                            <tr key={f.id}>
                              <td>
                                <button
                                  className="flag-name"
                                  onClick={() => {
                                    setError('');
                                    openFlag(f);
                                  }}
                                >
                                  <span className="flag-icon">
                                    <FlagIcon size={17} />
                                  </span>
                                  <span>
                                    <strong>
                                      {f.name}
                                      {isNew(f) && <span className="new-label">New</span>}
                                    </strong>
                                    <code>{f.key}</code>
                                  </span>
                                </button>
                              </td>
                              <td>
                                <div className="status-control">
                                  <button
                                    role="switch"
                                    aria-checked={f.config.enabled}
                                    aria-label={'Toggle ' + f.name}
                                    className={'switch ' + (f.config.enabled ? 'on' : '')}
                                    disabled={!canToggle || f.config.archived}
                                    onClick={() => void toggle(f)}
                                  >
                                    <span />
                                  </button>
                                  <span>{status(f)}</span>
                                </div>
                              </td>
                              <td>
                                <div className="rule-tags">
                                  {f.config.rules.length ? (
                                    f.config.rules.map((r) => (
                                      <span key={r.id}>
                                        {r.conditions.length ? r.name : 'Everyone'} · {r.percentage}
                                        %{r.value ? '' : ' · Disabled'}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="no-targeting">
                                      {f.config.fallback ? 'Everyone' : 'No audience configured'}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="date">{time(f.updatedAt)}</td>
                              <td>
                                <Menu label={'Actions for ' + f.name}>
                                  <button onClick={() => openFlag(f)}>
                                    <Settings2 size={16} />
                                    Configure targeting
                                  </button>
                                  <button onClick={() => openFlag(f, 'History')}>
                                    <History size={16} />
                                    View history
                                  </button>
                                  {admin && (
                                    <button onClick={() => openFlag(f, 'Settings')}>
                                      <Pencil size={16} />
                                      Edit details
                                    </button>
                                  )}
                                  {admin && (
                                    <button
                                      className="menu-separated"
                                      onClick={() => {
                                        if (
                                          confirm(
                                            `${f.config.archived ? 'Restore' : 'Archive'} ${f.name}?`,
                                          )
                                        )
                                          void action(
                                            () =>
                                              api('/flags/' + f.id, 'PATCH', {
                                                expectedVersion: f.version,
                                                archived: !f.config.archived,
                                              }),
                                            f.config.archived ? 'Flag restored' : 'Flag archived',
                                          );
                                      }}
                                    >
                                      <Archive size={16} />
                                      {f.config.archived ? 'Restore flag' : 'Archive flag'}
                                    </button>
                                  )}
                                </Menu>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!visible.length && (
                      <div className="empty">
                        <FlagIcon />
                        <h3>{!flags.length ? 'No flags yet' : 'No flags match.'}</h3>
                        <p>
                          {!appId
                            ? 'Create an application using the switcher.'
                            : !features.length
                              ? 'Create a feature group to organize your first flags.'
                              : 'Create a flag or adjust your filters.'}
                        </p>
                        {admin && !features.length && appId && (
                          <button
                            className="secondary"
                            onClick={() => setModal({ kind: 'feature' })}
                          >
                            Create a feature group
                          </button>
                        )}
                      </div>
                    )}
                    <div className="table-footer">
                      <span>{visible.length} flags in this view</span>
                      <button
                        className="text-button"
                        disabled={loading}
                        onClick={() => void load()}
                      >
                        <RotateCcw size={14} />
                        {loading ? 'Refreshing…' : 'Refresh'}
                      </button>
                    </div>
                  </section>
                </>
              )}
              {page === 'flags' && (
                <p className="table-hint">
                  <Info size={15} />
                  Targeting rules apply when a flag is enabled.
                </p>
              )}
              {page === 'applications' && (
                <ApplicationList
                  applications={applications}
                  admin={admin}
                  onOpen={(id) => {
                    setAppId(id);
                    setPage('flags');
                  }}
                  onEdit={(item) => setModal({ kind: 'application', item })}
                />
              )}
              {page === 'settings' && (
                <div className="card-grid">
                  <button
                    className="resource-card application-card"
                    onClick={() => setPage('features')}
                  >
                    <Layers />
                    <h3>Feature groups</h3>
                    <p>Organize flags around product capabilities.</p>
                  </button>
                  {admin && (
                    <>
                      <button
                        className="resource-card application-card"
                        onClick={() => setPage('credentials')}
                      >
                        <KeyRound />
                        <h3>SDK credentials</h3>
                        <p>Connect your application's backend.</p>
                      </button>
                      <button
                        className="resource-card application-card"
                        onClick={() => current && setModal({ kind: 'application', item: current })}
                      >
                        <Settings2 />
                        <h3>Application details</h3>
                        <p>Edit this application's name and description.</p>
                      </button>
                    </>
                  )}
                </div>
              )}
              {page === 'features' && (
                <div className="card-grid">
                  {features.map((f) => (
                    <article className="resource-card" key={f.id}>
                      <span className="resource-icon">
                        <Layers />
                      </span>
                      <h3>{f.name}</h3>
                      <p>{f.description || 'No description yet.'}</p>
                      <small>{flags.filter((flag) => flag.featureId === f.id).length} flags</small>
                      {admin && (
                        <div className="card-actions">
                          <button
                            className="text-button"
                            onClick={() => setModal({ kind: 'feature', item: f })}
                          >
                            <Pencil size={14} />
                            Edit
                          </button>
                          <button
                            className="text-button danger"
                            onClick={() => {
                              if (confirm('Delete this feature? It must have no flags.'))
                                void action(
                                  () => api('/features/' + f.id, 'DELETE'),
                                  'Feature deleted',
                                );
                            }}
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                  {!features.length && <Empty text="Create a feature to group related flags." />}
                </div>
              )}
              {page === 'credentials' && (
                <section className="panel">
                  <div className="section-intro">
                    <h3>Backend access only</h3>
                    <p>
                      Keys are displayed once. Keep them in server environment variables, never
                      browser code.
                    </p>
                  </div>
                  {keys.map((k) => (
                    <div className="key-row" key={k.id}>
                      <KeyRound size={20} />
                      <div>
                        <strong>{k.name}</strong>
                        <code>{k.prefix}••••••••••••</code>
                      </div>
                      <span className={'badge ' + (k.revokedAt ? 'disabled' : 'enabled')}>
                        {k.revokedAt ? 'Revoked' : 'Active'}
                      </span>
                      {!k.revokedAt && (
                        <div className="inline">
                          <button
                            className="text-button"
                            onClick={() => {
                              if (confirm('Rotate this key? The current key will stop working.'))
                                void action(async () => {
                                  const r = await api<{ token: string }>(
                                    '/credentials/' + k.id + '/rotate',
                                    'POST',
                                  );
                                  setSecret(r.token);
                                }, 'Credential rotated');
                            }}
                          >
                            Rotate
                          </button>
                          <button
                            className="text-button danger"
                            onClick={() => {
                              if (confirm('Revoke this key?'))
                                void action(
                                  () => api('/credentials/' + k.id, 'DELETE'),
                                  'Credential revoked',
                                );
                            }}
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {!keys.length && <Empty text="Create a credential to connect your first SDK." />}
                </section>
              )}
              {page === 'audit' && (
                <section className="panel">
                  <div className="section-intro">
                    <h3>A record of every change</h3>
                    <p>
                      Latest 100 configuration and access events. Individual user evaluations are
                      not recorded.
                    </p>
                  </div>
                  {audit.map((a) => (
                    <div className="audit-row" key={a.id}>
                      <span className="audit-icon">
                        <History size={17} />
                      </span>
                      <div>
                        <strong>{a.action.replaceAll('.', ' / ')}</strong>
                        <p>
                          {a.actorName} <span>· {a.resourceId.slice(0, 8)}</span>
                          {a.details.toVersion != null && (
                            <span>
                              {' '}
                              · v{String(a.details.fromVersion)} → v{String(a.details.toVersion)}
                            </span>
                          )}
                        </p>
                      </div>
                      <time>{time(a.createdAt)}</time>
                    </div>
                  ))}
                  {!audit.length && <Empty text="Your team's changes will appear here." />}
                </section>
              )}
            </>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {modal && modal.kind !== 'flag' && (
        <Modal title={(modal.item ? 'Edit ' : 'New ') + modal.kind} onClose={() => setModal(null)}>
          <form className="modal-body" onSubmit={saveForm}>
            <label>
              Name
              <input name="name" defaultValue={modal.item?.name ?? ''} required maxLength={100} />
            </label>
            {modal.kind === 'application' && !modal.item && (
              <label>
                Stable key
                <input
                  name="key"
                  required
                  pattern="[a-z][a-z0-9-]{1,63}"
                  placeholder="my-application"
                />
                <small>Lowercase letters, digits and hyphens. Cannot be changed later.</small>
              </label>
            )}
            {['application', 'feature'].includes(modal.kind) && (
              <label>
                Description
                <textarea
                  name="description"
                  maxLength={2000}
                  defaultValue={
                    modal.item && 'description' in modal.item ? modal.item.description : ''
                  }
                />
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="primary" type="submit">
                {modal.item ? 'Save changes' : 'Create ' + modal.kind}
                <ArrowUpRight size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {secret && (
        <Modal title="Save your backend credential" onClose={() => setSecret('')}>
          <div className="modal-body">
            <p>This is the only time the full key is shown.</p>
            <pre className="secret">{secret}</pre>
            <button
              className="secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(secret)
                  .then(() => setNotice('Credential copied'))
                  .catch(() => setError('Clipboard unavailable. Select and copy the key manually.'))
              }
            >
              <Copy size={16} />
              Copy key
            </button>
            <p className="muted">
              Store it on your server. Rotating a credential immediately invalidates the previous
              one.
            </p>
            <button className="primary" onClick={() => setSecret('')}>
              I have saved it
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
