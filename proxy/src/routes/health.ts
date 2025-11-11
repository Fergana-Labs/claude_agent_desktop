import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness probe - is the server running?
  app.get('/healthz', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Readiness probe - is the server ready to accept traffic?
  app.get('/readyz', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Check if Anthropic API key is configured
      if (!config.anthropicApiKey) {
        reply.code(503).send({
          status: 'not_ready',
          reason: 'Anthropic API key not configured',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Future: Add checks for Redis, database, etc.

      reply.send({
        status: 'ready',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      request.log.error(error, 'Readiness check failed');
      reply.code(503).send({
        status: 'not_ready',
        reason: 'Health check failed',
        timestamp: new Date().toISOString(),
      });
    }
  });
}
