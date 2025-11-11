import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  port: number;
  host: string;
  anthropicApiKey: string;
  anthropicBaseUrl: string;
  jwtSecret: string;
  jwtExpirationHours: number;
  redisUrl?: string;
  logLevel: string;
  rateLimitMax: number;
  rateLimitWindow: number;
  maxPayloadSize: number;
  corsOrigins: string[];
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpirationHours: parseInt(process.env.JWT_EXPIRATION_HOURS || '24', 10),
  redisUrl: process.env.REDIS_URL,
  logLevel: process.env.LOG_LEVEL || 'info',
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10), // 1 minute
  maxPayloadSize: parseInt(process.env.MAX_PAYLOAD_SIZE || '2097152', 10), // 2MB
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(','),
};

// Validate required config
if (!config.anthropicApiKey && process.env.NODE_ENV === 'production') {
  throw new Error('ANTHROPIC_API_KEY is required in production');
}

if (!config.jwtSecret || config.jwtSecret === 'dev-secret-change-in-production') {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  console.warn('⚠️  Using default JWT_SECRET - not suitable for production');
}
