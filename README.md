# Flagship

An organization-based feature flag platform with Clerk authentication. Define ordered targeting rules, release to stable percentages of users, and restore earlier configurations without deploying application code.

Implemented scope: stages 1–7 of the design — TypeScript workspace, PostgreSQL model/migration, evaluator, management API, durable configuration delivery, server SDK, dashboard, and a checkout demo. Capacity/load testing and deployment are not claimed complete.

## Run locally

Requires Node.js **24+**, npm, and Docker Desktop (Linux containers).

```sh
npm install
npm run setup
npm run dev
```

`setup` starts PostgreSQL and Redis, builds the workspace, migrates the database, and inserts demo records. It does not clear existing records. `dev` runs the API, dashboard, and demo. The SDK is built before startup; after SDK source changes run `npm run build -w @flagship/sdk`.

| Service       | Address                      |
| ------------- | ---------------------------- |
| Dashboard     | http://localhost:5173        |
| Checkout demo | http://localhost:4200        |
| API / health  | http://localhost:4000/health |
| PostgreSQL    | localhost:55432              |
| Redis         | localhost:56379              |

Create a **B2B Clerk application** with Organizations enabled. Put its development keys in the root `.env` (copy `.env.example` for variable names):

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

The publishable key is used by the React dashboard. The secret key stays on the API server. Never prefix the secret key with `VITE_`. Restart development servers after changing keys. Clerk handles signup, login, verification, password recovery, account profiles, organization creation, invitations, and membership management. Sign up through the dashboard, then create/select an organization. The sidebar's Clerk organization switcher opens organization management and switches the active team.

The old seeded password login and `/signup`, `/login`, `/logout` endpoints have been removed. Migration `0001` clears legacy password hashes and sessions while keeping user IDs for historical audit records. Existing applications are preserved with **no organization owner** and are invisible to all dashboard users until explicitly assigned. There is no public "claim legacy data" endpoint.

Assign an existing local application to a specific Clerk organization with this operator command (use the IDs from your local database and Clerk organization):

```sh
npm run app:assign -- --application <application-uuid> --organization <org_id>
```

This verifies the organization in Clerk, refuses to move already-owned applications between organizations, and preserves flags, history, and SDK credentials. The local seed creates the unowned Fieldwork demo only; it never creates a login account. `.local/demo-key` remains a private, ignored SDK credential.

For a fresh installation without sample data: run `npm run infra:up`, `npm run db:migrate`, then `npm run dev`. Each newly created application belongs to the authenticated user's active organization. Two organizations can use the same application key.

Stop the development processes with Ctrl+C. `npm run infra:down` stops the containers while retaining database data.

## Try a real rollout

1. After assigning the seeded Fieldwork application to your organization, open the demo as **Anika**, an employee in India. The new checkout is enabled by the first rule.
2. In the dashboard, open **One-step checkout** and set the employee rule's percentage to `0`. Save.
3. The SDK receives the updated configuration over SSE. The demo switches to the classic checkout on its next request (the demo browser refreshes its display every 1.5 seconds).
4. Open **History** and restore the previous version. This creates a new immutable version, and the new checkout returns.
5. Stop only the API while leaving the demo running. The SDK keeps evaluating its last known configuration. Restart the API: the SDK reconnects and receives a full current snapshot.

Demo personas are explicitly a local login simulator. Real applications must derive identity and attributes from their own authenticated session/database.

## Structure

```text
apps/api             Fastify, authentication, Drizzle, SSE, outbox publisher
apps/dashboard       React + Vite management UI
apps/demo            Backend + browser checkout demo
packages/contracts   Zod schemas and shared configuration types
packages/evaluator   Pure, deterministic rule evaluation
packages/sdk         Installable server-side SDK
infra                Docker Compose for PostgreSQL and Redis
tests                Real database/API/SDK integration tests
```

### Dashboard source

```text
apps/dashboard/src/
  App.tsx                     Application shell and screen navigation
  Auth.tsx                    Clerk authentication and organization gate
  main.tsx                    React entry point
  components/                 Shared brand, menu, modal, and empty state
  features/
    applications/             Application list and search
    flags/                    Creation, targeting, conditions, and history
  lib/                        Authenticated API client, types, and formatting
  styles/index.css            Shared dashboard and authentication layout styles
```

Local credentials and `.local/` runtime files are ignored by Git. Build output stays in each workspace's ignored `dist/` directory.

## Evaluation contract

Flags are boolean; features may group several independently controlled flags. A flag's key is unique within an application and immutable.

- Missing or archived flag → application-provided default.
- Disabled flag → `false`.
- Enabled flag → evaluate ordered rules. Conditions in a rule are ANDed.
- First matching rule is terminal. Included users get its `value`; users outside its percentage get the flag's `fallback`. They do not proceed to subsequent rules.
- No matching rule → flag fallback.
- `equals` uses strict scalar equality; `in` checks a scalar against a list; `contains` checks an attribute array for one scalar. Missing attributes do not match. Use `key` to target user IDs, and `groups` with `contains` for group membership.
- Percentage bucketing uses FNV-1a over UTF-8 JSON `[flagKey, userKey]`, mapped to 10,000 buckets. It is stable across restarts and monotonic when percentage increases; it is not a security boundary.

The rule editor provides attribute and operator selectors, boolean employee status, country and plan choices, and editable value chips for lists. Custom country and plan values remain available. API clients can use the shared schemas to submit additional attributes and typed values.

## SDK

```ts
import { FlagshipClient } from '@flagship/sdk';

const client = new FlagshipClient({
  baseUrl: 'http://localhost:4000',
  apiKey: process.env.FLAGSHIP_API_KEY!,
  onError: (error) => console.warn(error.message),
});

await client.start();
const enabled = client.isEnabled(
  'new-checkout',
  {
    key: authenticatedUser.id,
    attributes: { country: 'IN', plan: 'premium', employee: false },
  },
  false,
);

// On process shutdown:
await client.close();
```

The SDK fetches a snapshot and opens an authenticated SSE stream. Evaluation is synchronous and local. Snapshots are replaced atomically; older/duplicate revisions are ignored. Reconnection uses exponential backoff/jitter and a new full snapshot. A 20-second stream watchdog detects silent connections.

During network/service outages it keeps its **in-memory** last known configuration. A cold process without a successful fetch uses caller defaults. Explicit authentication rejection or credential revocation clears cached configuration and stops reconnecting. Configure a new client with the replacement credential.

Build/package for another project: `npm run build -w @flagship/sdk`, then `npm pack -w @flagship/sdk`. The generated tarball includes the evaluator and configuration validation, and does not require private workspace packages. Nothing is published automatically.

## Consistency and storage

PostgreSQL is authoritative. A flag mutation locks the application then the flag, checks `expectedVersion`, writes the new configuration and immutable history, records the actor, increments the application's revision, and appends an outbox event in one transaction. Conflicting edits return HTTP 409.

Rules are core domain objects stored as an ordered JSONB array inside a flag configuration. This makes a ruleset and its order one atomic, versioned unit; rule endpoints still address individual rule IDs. Organizations, local audit identities, applications, features, flags, versions, credentials, audit records and outbox events have relational tables. Clerk owns authentication and membership; the legacy sessions table is unused.

An in-process background publisher polls the outbox every second with `FOR UPDATE SKIP LOCKED` and publishes revision notices through Redis. Notifications may repeat. Events remain pending if Redis is unavailable. A crash between publish and commit can repeat delivery, which SDK revision checks tolerate.

Cache entries include the application revision in their key and expire after 60 seconds. Snapshot assembly uses a repeatable-read database transaction, so a revision and its flags are consistent. Old cache fills cannot overwrite a newer revision. The database is still needed to establish the current revision.

Each SSE connection authenticates a backend key, subscribes to its application and receives a full snapshot. Five-second heartbeat checks detect revoked credentials and repair missing notifications. Slow connections are disconnected rather than accumulating unbounded writes, then resynchronize on reconnect. Redis is an optimization, not the durable event log. Propagation is eventual; a database commit does not mean every SDK has already received it.

## Access model

| Role    | Access                                                                              |
| ------- | ----------------------------------------------------------------------------------- |
| Admin   | Create/edit/delete resources, manage users and SDK keys, targeting, archive, revert |
| Member  | Read resources; enable/disable flags only                                           |
| Auditor | Read resources and audit history                                                    |

Organizations represent client teams. Each organization owns its applications; all child resources are authorized through that ownership. Management requests carry a **Clerk bearer session token**, verified against the configured instance keys and allowed frontend origins. The active organization comes from the verified token, never a browser-supplied organization ID. Current membership and role are checked against Clerk on every management request; removed members and demoted admins lose access without waiting for a token to expire. Management requests fail closed if Clerk cannot verify membership.

`org:admin` and `org:member` map to Flagship admin/member. An optional Clerk custom role `org:auditor` maps to read-only access; configure it in Clerk if needed. Unknown roles are rejected. Local user rows are audit identities only: their legacy `role` column does not grant access. An identity can have different roles across organizations. The dashboard resets application/configuration state on organization changes and requests tokens for the selected organization explicitly.

SDK credentials remain restricted to one application and stored as hashes. SDK evaluation/distribution is independent of Clerk dashboard sessions, so a Clerk outage does not interrupt local flag evaluation. Team membership changes do not automatically revoke separately issued service credentials; an organization admin can revoke them. Audit records retain organization ownership after application deletion.

Browsers never connect directly to the flag platform. Your application's backend supplies trusted attributes and returns evaluated values. Backend authorization remains necessary independently of flags.

## API

Dashboard routes use `Authorization: Bearer <Clerk session token>`. SDK routes use `Authorization: Bearer fs_...`. Vite proxies `/api/*` to the API during development.

| Routes                                             | Methods                                                     |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `/me`, `/health`                                   | GET                                                         |
| `/applications`, `/features`, `/flags`             | GET list, POST create                                       |
| `/applications/:id`, `/features/:id`, `/flags/:id` | GET, PATCH, DELETE                                          |
| `/flags/:id/versions`                              | GET                                                         |
| `/flags/:id/revert`                                | POST `{expectedVersion, version}`                           |
| `/flags/:id/rules`                                 | GET, POST `{expectedVersion, rule}`                         |
| `/flags/:id/rules/:ruleId`                         | PATCH `{expectedVersion, rule}`, DELETE `{expectedVersion}` |
| `/applications/:id/credentials`                    | GET, POST `{name}`                                          |
| `/credentials/:id/rotate`                          | POST                                                        |
| `/credentials/:id`                                 | DELETE (revoke)                                             |
| `/audit`                                           | GET `?applicationId=&limit=100&offset=0`                    |
| `/config`, `/stream`                               | GET, backend credential                                     |
| `/evaluate`                                        | POST `{flagKey, context, defaultValue}`, backend credential |

Feature/flag lists require `?applicationId=...`. A flag PATCH accepts `expectedVersion` plus configuration fields (`enabled`, `archived`, `fallback`, `rules`) and/or name/description. Members can only submit `expectedVersion` and `enabled`. Rules are reordered by sending the ordered array in a flag PATCH. Archive is a PATCH; permanent flag deletion requires it to already be archived plus the current `expectedVersion`. Delete flags before features, and features before applications. Audit records survive deletion; deleting a flag removes its version history.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

Integration tests require the Compose PostgreSQL/Redis instances. They create a uniquely named test database and remove **only that test database** afterward. The database role must have CREATE DATABASE permission. Override `TEST_DATABASE_URL` to choose a separate PostgreSQL server.

Tests cover deterministic rollout, strict conditions, fallback semantics, first-match behavior, signed-token verification, role enforcement, every organization-scoped resource route, legacy-data isolation, optimistic concurrency, application isolation, immutable reverts, cross-replica updates, reconnect recovery, cache fallback and credential revocation. Integration tests inject a deterministic identity provider; separate authentication tests use real RSA signatures with Clerk token verification. Live Clerk sign-in is checked separately in the browser.

## Deliberate boundaries

- No environment hierarchy, multivariate flags, or individual user evaluation logs.
- SDK cache is in-memory, not persisted across process restarts.
- No production deployment, measured throughput claim, or completed stage-8 load testing. Initial targets remain 10 applications, 1,000 flags, 1,000 remote evaluations/sec and 1,000 connected SDKs.
- Full snapshots and periodic database reconciliation favor correctness and simplicity at this stage. Optimize after measuring the targets.
- History/outbox retention jobs, managed secret storage and organization lifecycle cleanup remain production hardening work. Clerk owns password recovery and login protection. Audit history is application-enforced append-only, not a tamper-proof compliance store.
- `vite preview` previews static assets only; production hosting needs a same-origin `/api` reverse proxy. Local `npm run dev` includes that proxy.
