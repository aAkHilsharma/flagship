import { createContext, useContext } from 'react';
import type { FlagConfig, Role } from '@flagship/contracts';
export type User = { id: string; name: string; email: string; role: Role };
export type Application = {
  id: string;
  name: string;
  key: string;
  description: string;
  revision: number;
};
export type Feature = { id: string; applicationId: string; name: string; description: string };
export type Flag = {
  id: string;
  applicationId: string;
  featureId: string;
  key: string;
  name: string;
  description: string;
  config: FlagConfig;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type Audit = {
  id: string;
  action: string;
  actorName: string;
  resourceId: string;
  createdAt: string;
  details: Record<string, unknown>;
};
export type Version = { version: number; config: FlagConfig; createdAt: string };
export type Credential = {
  id: string;
  name: string;
  prefix: string;
  revokedAt: string | null;
  createdAt: string;
};
export function createApi(getToken: () => Promise<string | null>) {
  return async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const token = await getToken();
    if (!token) throw new Error('Sign in required');
    const response = await fetch('/api' + path, {
      method,
      credentials: 'omit',
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => {
      throw new Error('The API is unavailable. Check that the backend is running, then retry.');
    });
    if (!response.ok) {
      const details = data.issues ? JSON.stringify(data.issues.fieldErrors) : '';
      throw new Error((data.error ?? 'Request failed') + (details ? ' — ' + details : ''));
    }
    return data;
  };
}
export type Api = ReturnType<typeof createApi>;
export const ApiContext = createContext<Api | null>(null);
export function useApi() {
  const api = useContext(ApiContext);
  if (!api) throw new Error('Missing authenticated API provider');
  return api;
}
