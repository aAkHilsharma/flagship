import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { FlagshipClient } from '@flagship/sdk';
try {
  loadEnvFile(new URL('../../../.env', import.meta.url));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const app = Fastify({ logger: true });
await app.register(cookie);
// Only this server reads SDK credentials. The browser never receives them.
let apiKey = process.env.FLAGSHIP_API_KEY;
if (!apiKey)
  try {
    apiKey = (await readFile(new URL('../../../.local/demo-key', import.meta.url), 'utf8')).trim();
  } catch {}
if (!apiKey)
  throw new Error('Run npm run db:seed or set FLAGSHIP_API_KEY before starting the demo.');
const sdk = new FlagshipClient({
  baseUrl: process.env.FLAGSHIP_URL ?? 'http://localhost:4000',
  apiKey,
  onError: (e) => app.log.warn(e.message),
});
await sdk.start();
// Demo-only login personas. Attributes are resolved on the backend, not accepted from browser input.
const personas = {
  employee: {
    key: 'employee-001',
    name: 'Anika Rao',
    attributes: { employee: true, country: 'IN', plan: 'premium', groups: ['staff'] },
  },
  premium: {
    key: 'customer-002',
    name: 'Jamie Wilson',
    attributes: { employee: false, country: 'GB', plan: 'premium', groups: ['customers'] },
  },
  standard: {
    key: 'customer-003',
    name: 'Sam Patel',
    attributes: { employee: false, country: 'IN', plan: 'free', groups: ['customers'] },
  },
};
app.post('/demo-login/:persona', async (req, reply) => {
  const id = (req.params as { persona: string }).persona;
  if (!Object.hasOwn(personas, id)) return reply.code(400).send({ error: 'Unknown demo persona' });
  reply.setCookie('demo_persona', id, { path: '/', httpOnly: true, sameSite: 'strict' });
  return { ok: true };
});
app.get('/api/checkout', async (req) => {
  const id = req.cookies.demo_persona ?? 'employee';
  const user = personas[id as keyof typeof personas] ?? personas.employee;
  const result = sdk.evaluate('new-checkout', user, false);
  return { user, enabled: result.value, reason: result.reason, sdk: sdk.status };
});
app.get('/', async (_req, reply) =>
  reply
    .type('text/html')
    .send(await readFile(new URL('../public/index.html', import.meta.url), 'utf8')),
);
app.addHook('onClose', () => sdk.close());
await app.listen({ port: Number(process.env.DEMO_PORT ?? 4200), host: '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
