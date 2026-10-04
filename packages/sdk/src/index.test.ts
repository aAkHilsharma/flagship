import { it, expect } from 'vitest';
import { FlagshipClient } from './index';
it('uses caller defaults on cold startup without a reachable service and can shut down during retry', async () => {
  const errors: Error[] = [];
  const sdk = new FlagshipClient({
    baseUrl: 'http://127.0.0.1:1',
    apiKey: 'fs_test',
    requestTimeoutMs: 100,
    reconnectDelayMs: 50,
    onError: (e) => errors.push(e),
  });
  try {
    await sdk.start();
    expect(sdk.status.ready).toBe(false);
    expect(sdk.isEnabled('new-checkout', { key: 'u', attributes: {} }, true)).toBe(true);
    expect(sdk.isEnabled('new-checkout', { key: 'u', attributes: {} }, false)).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  } finally {
    await sdk.close();
  }
});
