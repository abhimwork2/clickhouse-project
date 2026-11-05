import Fastify from 'fastify';
import { config } from './config';
import { pool } from './db';

const app = Fastify({ logger: true });

app.get('/health', async (_request, reply) => {
  try {
    await pool.query('SELECT 1');

    return {
      status: 'ok',
      database: 'connected',
    };
  } catch (error: unknown) {
    app.log.error({ err: error }, 'Database health check failed');

    return reply.status(503).send({
      status: 'error',
      database: 'disconnected',
    });
  }
});

const start = async (): Promise<void> => {
  try {
    await app.listen({ host: '0.0.0.0', port: config.PORT });
  } catch (error: unknown) {
    app.log.error({ err: error }, 'Failed to start server');
    await pool.end();
    process.exitCode = 1;
  }
};

void start();