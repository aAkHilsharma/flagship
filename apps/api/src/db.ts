import './env';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
export const defaultDatabaseUrl = 'postgres://flagship:flagship_local@localhost:55432/flagship';
export function connectDatabase(url = process.env.DATABASE_URL || defaultDatabaseUrl) {
  const client = postgres(url, { max: 10, connect_timeout: 5 });
  return { client, db: drizzle(client, { schema }) };
}
export type Database = ReturnType<typeof connectDatabase>['db'];
