import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { usageTracker } from '../services/usage.js';
import { anthropicCircuitBreaker } from '../services/circuit-breaker.js';
import { authMiddleware } from '../middleware/auth.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Get usage metrics for the authenticated device
  app.get('/admin/usage', {
    preHandler: [authMiddleware],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const deviceId = request.tokenPayload?.device_id;

      if (!deviceId) {
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Missing device ID in token',
        });
        return;
      }

      const metrics = usageTracker.getMetrics({ deviceId });
      const stats = usageTracker.getStats({ deviceId });

      reply.send({
        stats,
        metrics: metrics.slice(-100), // Last 100 requests
      });
    } catch (error) {
      request.log.error(error, 'Usage endpoint error');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve usage metrics',
      });
    }
  });

  // Get aggregated stats for the authenticated device
  app.get('/admin/stats', {
    preHandler: [authMiddleware],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const deviceId = request.tokenPayload?.device_id;

      if (!deviceId) {
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Missing device ID in token',
        });
        return;
      }

      const stats = usageTracker.getStats({ deviceId });

      reply.send(stats);
    } catch (error) {
      request.log.error(error, 'Stats endpoint error');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve stats',
      });
    }
  });

  // Get circuit breaker status
  app.get('/admin/circuit-breaker', {
    preHandler: [authMiddleware],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = anthropicCircuitBreaker.getStats();
      reply.send(stats);
    } catch (error) {
      request.log.error(error, 'Circuit breaker endpoint error');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve circuit breaker status',
      });
    }
  });

  // Reset circuit breaker (admin only - could add additional auth later)
  app.post('/admin/circuit-breaker/reset', {
    preHandler: [authMiddleware],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      anthropicCircuitBreaker.reset();
      reply.send({
        message: 'Circuit breaker reset successfully',
        stats: anthropicCircuitBreaker.getStats(),
      });
    } catch (error) {
      request.log.error(error, 'Circuit breaker reset error');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to reset circuit breaker',
      });
    }
  });
}
