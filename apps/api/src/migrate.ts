import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connectDatabase } from './db';
export async function migrate(url?: string) {
  const { client } = connectDatabase(url);
  try {
    const directory = new URL('../drizzle/', import.meta.url);
    const files = (await readdir(directory)).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
    await client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(941010)`;
      await tx`CREATE TABLE IF NOT EXISTS flagship_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
      for (const file of files) {
        const name = file.replace(/\.sql$/, '');
        const rows = await tx`SELECT name FROM flagship_migrations WHERE name=${name}`;
        if (!rows.length) {
          await tx.unsafe(await readFile(new URL(file, directory), 'utf8'));
          await tx`INSERT INTO flagship_migrations(name) VALUES(${name})`;
        }
      }
    });
  } finally {
    await client.end();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  migrate()
    .then(() => console.log('Database migrated.'))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
