import type { UsageMetrics } from '../types.js';

export class UsageTracker {
  private metrics: UsageMetrics[] = [];

  /**
   * Track usage metrics from an Anthropic API response
   */
  track(metrics: UsageMetrics): void {
    this.metrics.push(metrics);

    // Log for now - in production, this would emit to Kafka/PubSub
    console.log('Usage tracked:', {
      requestId: metrics.request_id,
      deviceId: metrics.device_id,
      model: metrics.model,
      inputTokens: metrics.input_tokens,
      outputTokens: metrics.output_tokens,
      latencyMs: metrics.latency_ms,
      status: metrics.status,
    });

    // Future: emit to message queue
    // await this.emitToQueue(metrics);
  }

  /**
   * Extract usage from Anthropic response
   */
  extractUsage(
    responseBody: any,
    responseHeaders: Record<string, string | string[] | undefined>
  ): {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: undefined as number | undefined,
      cache_read_input_tokens: undefined as number | undefined,
    };

    if (responseBody?.usage) {
      usage.input_tokens = responseBody.usage.input_tokens || 0;
      usage.output_tokens = responseBody.usage.output_tokens || 0;

      if (responseBody.usage.cache_creation_input_tokens) {
        usage.cache_creation_input_tokens = responseBody.usage.cache_creation_input_tokens;
      }

      if (responseBody.usage.cache_read_input_tokens) {
        usage.cache_read_input_tokens = responseBody.usage.cache_read_input_tokens;
      }
    }

    return usage;
  }

  /**
   * Get aggregated metrics (for debugging/admin endpoints)
   */
  getMetrics(filters?: {
    deviceId?: string;
    userId?: string;
    orgId?: string;
    startDate?: Date;
    endDate?: Date;
  }): UsageMetrics[] {
    let filtered = this.metrics;

    if (filters?.deviceId) {
      filtered = filtered.filter(m => m.device_id === filters.deviceId);
    }
    if (filters?.userId) {
      filtered = filtered.filter(m => m.user_id === filters.userId);
    }
    if (filters?.orgId) {
      filtered = filtered.filter(m => m.org_id === filters.orgId);
    }
    if (filters?.startDate) {
      filtered = filtered.filter(m => m.timestamp >= filters.startDate!);
    }
    if (filters?.endDate) {
      filtered = filtered.filter(m => m.timestamp <= filters.endDate!);
    }

    return filtered;
  }

  /**
   * Get aggregated statistics
   */
  getStats(filters?: Parameters<typeof this.getMetrics>[0]): {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    averageLatency: number;
    successRate: number;
  } {
    const metrics = this.getMetrics(filters);

    const totalRequests = metrics.length;
    const totalInputTokens = metrics.reduce((sum, m) => sum + m.input_tokens, 0);
    const totalOutputTokens = metrics.reduce((sum, m) => sum + m.output_tokens, 0);
    const averageLatency = totalRequests > 0
      ? metrics.reduce((sum, m) => sum + m.latency_ms, 0) / totalRequests
      : 0;
    const successfulRequests = metrics.filter(m => m.status >= 200 && m.status < 300).length;
    const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 100;

    return {
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      averageLatency,
      successRate,
    };
  }

  /**
   * Clear metrics (useful for testing)
   */
  clear(): void {
    this.metrics = [];
  }
}

export const usageTracker = new UsageTracker();
