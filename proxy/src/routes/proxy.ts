import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, modelAuthMiddleware } from '../middleware/auth.js';
import { anthropicProxy } from '../services/proxy.js';

export async function proxyRoutes(app: FastifyInstance): Promise<void> {
  // Anthropic API v1 endpoints
  const v1Paths = [
    '/v1/messages',
    '/v1/complete',
    '/v1/messages/count_tokens',
  ];

  for (const path of v1Paths) {
    app.all(path, {
      preHandler: [authMiddleware, modelAuthMiddleware],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      await anthropicProxy.proxyRequest(request, reply, path);
    });
  }

  // Catch-all for other Anthropic API paths
  app.all('/v1/*', {
    preHandler: [authMiddleware],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url;
    await anthropicProxy.proxyRequest(request, reply, path);
  });
}
