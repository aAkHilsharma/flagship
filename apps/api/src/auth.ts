import { randomBytes, createHash } from 'node:crypto';
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = (prefix = 'fs_') => prefix + randomBytes(32).toString('base64url');
