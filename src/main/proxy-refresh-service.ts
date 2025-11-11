import { ProxyBootstrap, ProxyConfig } from './proxy-bootstrap.js';

/**
 * Service to periodically refresh proxy tokens in the background
 */
export class ProxyRefreshService {
  private refreshInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL = 30 * 60 * 1000; // Check every 30 minutes
  private isRefreshing = false;

  /**
   * Start the background refresh service
   */
  start(): void {
    if (this.refreshInterval) {
      console.log('Proxy refresh service already running');
      return;
    }

    console.log('Starting proxy token refresh service');

    // Check immediately on start
    this.checkAndRefresh();

    // Then check periodically
    this.refreshInterval = setInterval(() => {
      this.checkAndRefresh();
    }, this.CHECK_INTERVAL);
  }

  /**
   * Stop the background refresh service
   */
  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log('Proxy token refresh service stopped');
    }
  }

  /**
   * Check if token needs refresh and refresh it if needed
   */
  private async checkAndRefresh(): Promise<void> {
    // Prevent concurrent refreshes
    if (this.isRefreshing) {
      console.log('Token refresh already in progress, skipping');
      return;
    }

    this.isRefreshing = true;

    try {
      const config = await ProxyBootstrap.getOrCreateProxyConfig();

      if (!config) {
        console.warn('No proxy config found during refresh check');
        return;
      }

      // Check if token is expired or will expire soon (within 1 hour)
      const expiresAt = new Date(config.expiresAt).getTime();
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      if (expiresAt - now < oneHour) {
        console.log('Token expiring soon, attempting refresh...');

        const newConfig = await ProxyBootstrap.refreshToken(config);

        if (newConfig) {
          // Update environment with new token
          ProxyBootstrap.setupProxyEnvironment(newConfig);
          console.log('Token refreshed successfully');
        } else {
          console.error('Failed to refresh token');
          // Could notify UI here to show error banner
        }
      } else {
        const hoursUntilExpiry = Math.floor((expiresAt - now) / (60 * 60 * 1000));
        console.log(`Token still valid, expires in ${hoursUntilExpiry} hours`);
      }
    } catch (error) {
      console.error('Error during token refresh check:', error);
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Manually trigger a token refresh (can be called from UI)
   */
  async manualRefresh(): Promise<boolean> {
    if (this.isRefreshing) {
      console.log('Token refresh already in progress');
      return false;
    }

    this.isRefreshing = true;

    try {
      const config = await ProxyBootstrap.getOrCreateProxyConfig();

      if (!config) {
        console.error('No proxy config found for manual refresh');
        return false;
      }

      console.log('Manually refreshing token...');
      const newConfig = await ProxyBootstrap.refreshToken(config);

      if (newConfig) {
        ProxyBootstrap.setupProxyEnvironment(newConfig);
        console.log('Token manually refreshed successfully');
        return true;
      } else {
        console.error('Failed to manually refresh token');
        return false;
      }
    } catch (error) {
      console.error('Error during manual token refresh:', error);
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }
}
