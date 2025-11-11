import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { tokenService } from '../services/token.js';
import type { BootstrapRequest } from '../types.js';

export async function bootstrapRoutes(app: FastifyInstance): Promise<void> {
  // Bootstrap endpoint - initial token provisioning
  app.post('/bootstrap', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as BootstrapRequest;

      if (!body.device_id) {
        reply.code(400).send({
          error: 'Bad Request',
          message: 'device_id is required',
        });
        return;
      }

      request.log.info({ deviceId: body.device_id }, 'Bootstrap request');

      const response = tokenService.bootstrap(body);

      reply.send(response);
    } catch (error) {
      request.log.error(error, 'Bootstrap error');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to bootstrap token',
      });
    }
  });

  // Refresh endpoint - renew existing token
  app.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Missing or invalid Authorization header',
        });
        return;
      }

      const token = authHeader.substring(7);

      request.log.info('Token refresh request');

      const response = tokenService.refresh(token);

      reply.send(response);
    } catch (error) {
      request.log.error(error, 'Refresh error');
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Failed to refresh token: ' + (error as Error).message,
      });
    }
  });
}
