import { useEffect, useState } from 'react';
import { ArrowRight, Flag as FlagIcon, MoreHorizontal, Search } from 'lucide-react';
import { useApi, type Application, type Flag } from '../../lib/api';

export function ApplicationList({
  applications,
  admin,
  onOpen,
  onEdit,
}: {
  applications: Application[];
  admin: boolean;
  onOpen: (id: string) => void;
  onEdit: (app: Application) => void;
}) {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState<Record<string, Flag[]>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all(
      applications.map(
        async (a) => [a.id, await api<Flag[]>('/flags?applicationId=' + a.id)] as const,
      ),
    )
      .then((rows) => {
        if (active) setStats(Object.fromEntries(rows));
      })
      .catch(() => {
        if (active) setError('Flag counts could not be loaded. Open an application to retry.');
      });
    return () => {
      active = false;
    };
  }, [api, applications]);
  const visible = applications.filter((a) =>
    `${a.name} ${a.key}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="applications-toolbar">
        <label className="application-search">
          <Search size={20} />
          <input
            aria-label="Search applications"
            placeholder="Search applications..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span>
          {visible.length} application{visible.length === 1 ? '' : 's'}
        </span>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="application-cards">
        {visible.map((a) => {
          const flags = stats[a.id];
          const latest = flags?.reduce((date, f) => (f.updatedAt > date ? f.updatedAt : date), '');
          return (
            <article className="application-tile" key={a.id}>
              <div className="application-tile-heading">
                <span className="app-monogram">{a.name[0].toUpperCase()}</span>
                <div>
                  <button className="application-name" onClick={() => onOpen(a.id)}>
                    {a.name}
                  </button>
                  <code>{a.key}</code>
                </div>
                {admin && (
                  <details className="tile-menu">
                    <summary aria-label={'Configure ' + a.name}>
                      <MoreHorizontal size={22} />
                    </summary>
                    <button onClick={() => onEdit(a)}>Edit application</button>
                  </details>
                )}
              </div>
              <p>{a.description || 'Manage feature flags and rollouts for this application.'}</p>
              <div className="application-counts">
                <FlagIcon size={20} />
                <span>
                  {flags
                    ? `${flags.length} flag${flags.length === 1 ? '' : 's'}`
                    : 'Loading flags…'}
                </span>
                {flags && (
                  <>
                    <span className="status-dot" />
                    <span>{flags.filter((f) => !f.config.enabled).length} disabled</span>
                  </>
                )}
              </div>
              <footer>
                <span>
                  {latest
                    ? 'Updated ' +
                      new Date(latest).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                      })
                    : 'No flag changes yet'}
                </span>
                <button onClick={() => onOpen(a.id)}>
                  Open application <ArrowRight size={19} />
                </button>
              </footer>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <div className="empty">
          {applications.length
            ? 'No applications match your search.'
            : 'Create an application to get started.'}
        </div>
      )}
    </>
  );
}
