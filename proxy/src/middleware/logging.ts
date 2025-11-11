import type { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';

declare module 'fastify' {
  interface FastifyRequest {
    requestId?: string;
    startTime?: number;
  }
}

export async function loggingMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Generate and attach request ID
  request.requestId = request.headers['x-request-id'] as string || randomUUID();
  request.startTime = Date.now();

  // Add request ID to response headers
  reply.header('x-request-id', request.requestId);

  // Log request details
  request.log.info({
    requestId: request.requestId,
    method: request.method,
    url: request.url,
    deviceId: request.tokenPayload?.device_id,
    userId: request.tokenPayload?.user_id,
    orgId: request.tokenPayload?.org_id,
  }, 'Incoming request');
}
