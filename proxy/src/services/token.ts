import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { WrapperTokenPayload, BootstrapRequest, BootstrapResponse } from '../types.js';

export class TokenService {
  private jwtSecret: string;
  private expirationHours: number;

  constructor() {
    this.jwtSecret = config.jwtSecret;
    this.expirationHours = config.jwtExpirationHours;
  }

  /**
   * Generate a wrapper token for a device
   */
  generateToken(deviceId: string, options?: {
    userId?: string;
    orgId?: string;
    models?: string[];
    rateLimit?: number;
    spendCap?: number;
  }): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (this.expirationHours * 3600);

    const payload: WrapperTokenPayload = {
      device_id: deviceId,
      user_id: options?.userId,
      org_id: options?.orgId,
      models: options?.models || [
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229',
        'claude-sonnet-4-5-20250929',
      ],
      rate_limit: options?.rateLimit,
      spend_cap: options?.spendCap,
      iat: now,
      exp,
    };

    return jwt.sign(payload, this.jwtSecret, { algorithm: 'HS256' });
  }

  /**
   * Verify and decode a wrapper token
   */
  verifyToken(token: string): WrapperTokenPayload {
    try {
      const payload = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      }) as WrapperTokenPayload;

      return payload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid token');
      }
      throw error;
    }
  }

  /**
   * Handle bootstrap request from new installation
   */
  bootstrap(request: BootstrapRequest): BootstrapResponse {
    const { device_id } = request;

    if (!device_id || device_id.length < 8) {
      throw new Error('Invalid device_id');
    }

    const token = this.generateToken(device_id);
    const payload = this.verifyToken(token);

    // Use 127.0.0.1 instead of localhost to avoid IPv6 (::1) connection issues
    const proxyBaseUrl = process.env.PROXY_BASE_URL || 'http://127.0.0.1:3001';

    return {
      wrapper_token: token,
      proxy_base_url: proxyBaseUrl,
      expires_at: new Date(payload.exp * 1000).toISOString(),
      // Future: add refresh_token support
    };
  }

  /**
   * Refresh an existing token
   */
  refresh(token: string): BootstrapResponse {
    try {
      const payload = this.verifyToken(token);

      // Generate new token with same device_id
      const newToken = this.generateToken(payload.device_id, {
        userId: payload.user_id,
        orgId: payload.org_id,
        models: payload.models,
        rateLimit: payload.rate_limit,
        spendCap: payload.spend_cap,
      });

      const newPayload = this.verifyToken(newToken);
      // Use 127.0.0.1 instead of localhost to avoid IPv6 (::1) connection issues
      const proxyBaseUrl = process.env.PROXY_BASE_URL || 'http://127.0.0.1:3001';

      return {
        wrapper_token: newToken,
        proxy_base_url: proxyBaseUrl,
        expires_at: new Date(newPayload.exp * 1000).toISOString(),
      };
    } catch (error) {
      throw new Error('Failed to refresh token: ' + (error as Error).message);
    }
  }
}

export const tokenService = new TokenService();
