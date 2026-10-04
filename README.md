# Flagship

A feature flag platform with application management, targeting rules, percentage rollouts, and configuration history. Clerk handles authentication and organizations.

## Run locally

Requires Node.js 24+, npm, and Docker Desktop.

1. Copy `.env.example` to `.env`.
2. Create a Clerk application with Organizations enabled. Set `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `.env`.
3. Run:

```sh
npm install
npm run setup
npm run dev
```

Open [localhost:5173](http://localhost:5173). Sign in and create or select an organization. New installations start without applications or flags.

The API runs at `http://localhost:4000`. Keep `.env` and SDK credentials out of source control.

## Commands

| Command              | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `npm run dev`        | Start API and dashboard                         |
| `npm run build`      | Build all packages and apps                     |
| `npm run typecheck`  | Check TypeScript                                |
| `npm test`           | Run tests; PostgreSQL and Redis must be running |
| `npm run format`     | Format the code                                 |
| `npm run db:migrate` | Apply database migrations                       |
| `npm run infra:up`   | Start PostgreSQL and Redis                      |
| `npm run infra:down` | Stop infrastructure, retaining data             |

## Structure

```text
apps/
  api/         Fastify API, database schema, and migrations
  dashboard/   React dashboard
packages/
  contracts/   Shared types and validation
  evaluator/   Targeting and rollout logic
  sdk/         Backend SDK
infra/         Docker Compose configuration
tests/         Authentication and integration tests
```
