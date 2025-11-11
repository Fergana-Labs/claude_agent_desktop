import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { loggingMiddleware } from './middleware/logging.js';
import { healthRoutes } from './routes/health.js';
import { bootstrapRoutes } from './routes/bootstrap.js';
import { proxyRoutes } from './routes/proxy.js';
import { adminRoutes } from './routes/admin.js';

async function main() {
  // Create Fastify instance with logging
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: process.env.NODE_ENV === 'development' ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      } : undefined,
    },
    bodyLimit: config.maxPayloadSize,
    trustProxy: true,
  });

  // Register CORS
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  // Register rate limiting (globally, but will be applied per-route)
  // Note: Rate limiting is configured here but can be selectively applied to routes
  if (config.redisUrl) {
    // Use Redis for distributed rate limiting
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(config.redisUrl);

    await app.register(rateLimit, {
      global: false,  // Don't apply globally - let routes opt-in
      max: config.rateLimitMax,
      timeWindow: config.rateLimitWindow,
      redis,
      nameSpace: 'claude-proxy-rl:',
      keyGenerator: (request) => {
        // Rate limit by device_id if available, otherwise by IP
        return request.tokenPayload?.device_id || request.ip;
      },
    });
  } else {
    // Use in-memory rate limiting
    await app.register(rateLimit, {
      global: false,  // Don't apply globally - let routes opt-in
      max: config.rateLimitMax,
      timeWindow: config.rateLimitWindow,
      keyGenerator: (request) => {
        return request.tokenPayload?.device_id || request.ip;
      },
    });
  }

  // Add logging middleware to all routes
  app.addHook('onRequest', loggingMiddleware);

  // Log responses
  app.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - (request.startTime || Date.now());
    request.log.info({
      requestId: request.requestId,
      statusCode: reply.statusCode,
      duration,
    }, 'Request completed');
  });

  // Register routes
  await healthRoutes(app);
  await bootstrapRoutes(app);
  await proxyRoutes(app);
  await adminRoutes(app);

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error.validation) {
      reply.code(400).send({
        error: 'Bad Request',
        message: 'Validation failed',
        details: error.validation,
      });
      return;
    }

    if (error.statusCode && error.statusCode < 500) {
      reply.code(error.statusCode).send({
        error: error.name,
        message: error.message,
      });
      return;
    }

    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  });

  // 404 handler
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
    });
  });

  // Start server
  try {
    await app.listen({
      port: config.port,
      host: config.host,
    });

    console.log(`
🚀 Claude Proxy Server is running!

  Port:     ${config.port}
  Host:     ${config.host}
  Log level: ${config.logLevel}

  Health:    http://localhost:${config.port}/healthz
  Bootstrap: http://localhost:${config.port}/bootstrap
  API:       http://localhost:${config.port}/v1/*

  Press Ctrl+C to stop
    `);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, closing server gracefully...`);
      await app.close();
      process.exit(0);
    });
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
