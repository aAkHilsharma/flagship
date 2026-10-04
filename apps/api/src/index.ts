import { buildApp } from './app';
const { app } = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
