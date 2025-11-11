import machineId from 'node-machine-id';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const { machineIdSync } = machineId;

export interface ProxyConfig {
  wrapperToken: string;
  proxyBaseUrl: string;
  expiresAt: string;
}

export class ProxyBootstrap {
  private static readonly STORAGE_KEY = 'proxy-config';
  // Use 127.0.0.1 instead of localhost to avoid IPv6 (::1) connection issues
  private static readonly BOOTSTRAP_URL = process.env.PROXY_BOOTSTRAP_URL || 'http://127.0.0.1:3001/bootstrap';
  private static readonly HEALTH_CHECK_URL = process.env.PROXY_HEALTH_URL || 'http://127.0.0.1:3001/healthz';

  /**
   * Get or create proxy configuration
   * This is called on first run or when token needs refresh
   */
  static async getOrCreateProxyConfig(): Promise<ProxyConfig | null> {
    // Check if we have a valid cached config
    const cached = this.getCachedConfig();
    if (cached && !this.isExpired(cached)) {
      return cached;
    }

    // Bootstrap new token
    return await this.bootstrap();
  }

  /**
   * Bootstrap a new token from the proxy service
   */
  static async bootstrap(): Promise<ProxyConfig | null> {
    try {
      // Generate device ID from machine ID
      const deviceId = machineIdSync(true);
      const appVersion = app.getVersion();

      console.log('Bootstrapping proxy token for device:', deviceId);

      const response = await fetch(this.BOOTSTRAP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_id: deviceId,
          app_version: appVersion,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Bootstrap failed:', response.status, errorText);
        return null;
      }

      const data = await response.json() as any;
      const config: ProxyConfig = {
        wrapperToken: data.wrapper_token as string,
        proxyBaseUrl: data.proxy_base_url as string,
        expiresAt: data.expires_at as string,
      };

      // Cache the config
      this.cacheConfig(config);

      console.log('Proxy token bootstrapped successfully');
      return config;
    } catch (error) {
      console.error('Bootstrap error:', error);
      return null;
    }
  }

  /**
   * Refresh an existing token
   */
  static async refreshToken(currentConfig: ProxyConfig): Promise<ProxyConfig | null> {
    try {
      const refreshUrl = currentConfig.proxyBaseUrl + '/refresh';

      const response = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentConfig.wrapperToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('Token refresh failed:', response.status);
        // Fall back to bootstrap
        return await this.bootstrap();
      }

      const data = await response.json() as any;
      const config: ProxyConfig = {
        wrapperToken: data.wrapper_token as string,
        proxyBaseUrl: data.proxy_base_url as string,
        expiresAt: data.expires_at as string,
      };

      this.cacheConfig(config);
      console.log('Proxy token refreshed successfully');
      return config;
    } catch (error) {
      console.error('Token refresh error:', error);
      // Fall back to bootstrap
      return await this.bootstrap();
    }
  }

  /**
   * Health check the proxy service
   */
  static async healthCheck(proxyBaseUrl?: string): Promise<boolean> {
    try {
      const url = proxyBaseUrl ? `${proxyBaseUrl}/healthz` : this.HEALTH_CHECK_URL;

      const response = await fetch(url, {
        method: 'GET',
        // 5 second timeout
        signal: AbortSignal.timeout(5000),
      });

      return response.ok;
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }

  /**
   * Check if config is expired or about to expire (within 1 hour)
   */
  private static isExpired(config: ProxyConfig): boolean {
    const expiresAt = new Date(config.expiresAt).getTime();
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    // Consider expired if within 1 hour of expiration
    return expiresAt - now < oneHour;
  }

  /**
   * Cache config in electron-store or similar
   * For now, we'll use app.getPath('userData') + file storage
   */
  private static cacheConfig(config: ProxyConfig): void {
    try {
      const configPath = path.join(app.getPath('userData'), 'proxy-config.json');
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to cache proxy config:', error);
    }
  }

  /**
   * Get cached config
   */
  private static getCachedConfig(): ProxyConfig | null {
    try {
      const configPath = path.join(app.getPath('userData'), 'proxy-config.json');

      if (!fs.existsSync(configPath)) {
        return null;
      }

      const data = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to read cached proxy config:', error);
      return null;
    }
  }

  /**
   * Clear cached config
   */
  static clearCache(): void {
    try {
      const configPath = path.join(app.getPath('userData'), 'proxy-config.json');

      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    } catch (error) {
      console.error('Failed to clear proxy config cache:', error);
    }
  }

  /**
   * Setup environment variables for Claude SDK to use proxy
   */
  static setupProxyEnvironment(config: ProxyConfig): void {
    // Override Anthropic API base URL to point to our proxy
    process.env.ANTHROPIC_BASE_URL = config.proxyBaseUrl;

    // IMPORTANT: Use a dummy Anthropic-formatted key for the SDK
    // The SDK validates the key format, but the proxy will replace it
    // Using the wrapper token directly causes SDK validation errors
    process.env.ANTHROPIC_API_KEY = 'sk-ant-proxy-' + config.wrapperToken;

    console.log('Proxy environment configured:', {
      baseUrl: config.proxyBaseUrl,
      tokenPrefix: config.wrapperToken.substring(0, 20) + '...',
    });
  }
}
