import type { FastifyRequest, FastifyReply } from 'fastify';
import { tokenService } from '../services/token.js';
import type { WrapperTokenPayload } from '../types.js';

declare module 'fastify' {
  interface FastifyRequest {
    tokenPayload?: WrapperTokenPayload;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Extract Bearer token from Authorization header
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing Authorization header',
      });
      return;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid Authorization header format. Expected: Bearer <token>',
      });
      return;
    }

    let token = parts[1];

    // Handle proxy-wrapped tokens (sk-ant-proxy-<actual-token>)
    // This allows the SDK to pass validation with a fake Anthropic key format
    if (token.startsWith('sk-ant-proxy-')) {
      token = token.substring('sk-ant-proxy-'.length);
      request.log.debug({ originalToken: parts[1].substring(0, 30) + '...', strippedToken: token.substring(0, 30) + '...' }, 'Stripped sk-ant-proxy prefix');
    }

    request.log.debug({ tokenPrefix: token.substring(0, 30) + '...' }, 'Verifying token');

    try {
      const payload = tokenService.verifyToken(token);

      // Attach payload to request for downstream use
      request.tokenPayload = payload;
      request.log.debug({ deviceId: payload.device_id }, 'Token verified successfully');
    } catch (error) {
      const message = (error as Error).message;
      request.log.warn({ error: message, tokenPrefix: token.substring(0, 30) + '...' }, 'Token verification failed');
      reply.code(401).send({
        error: 'Unauthorized',
        message: message === 'Token expired'
          ? 'Token expired. Please refresh your token.'
          : 'Invalid token',
      });
      return;
    }
  } catch (error) {
    request.log.error(error, 'Auth middleware error');
    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Authentication failed',
    });
  }
}

/**
 * Middleware to check if the requested model is allowed for this token
 */
export async function modelAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const payload = request.tokenPayload;

  if (!payload) {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Missing token payload',
    });
    return;
  }

  // Extract model from request body
  const body = request.body as any;
  const requestedModel = body?.model;

  if (!requestedModel) {
    // Let it pass - Anthropic API will handle validation
    return;
  }

  // Check if model is in the allowlist
  if (payload.models && payload.models.length > 0) {
    if (!payload.models.includes(requestedModel)) {
      reply.code(403).send({
        error: 'Forbidden',
        message: `Model '${requestedModel}' is not allowed for this token. Allowed models: ${payload.models.join(', ')}`,
      });
      return;
    }
  }
}
