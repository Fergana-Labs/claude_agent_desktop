import { request as undiciFetch } from 'undici';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { usageTracker } from './usage.js';
import { anthropicCircuitBreaker } from './circuit-breaker.js';
import type { UsageMetrics } from '../types.js';

export class AnthropicProxy {
  private anthropicBaseUrl: string;
  private anthropicApiKey: string;

  constructor() {
    this.anthropicBaseUrl = config.anthropicBaseUrl;
    this.anthropicApiKey = config.anthropicApiKey;
  }

  /**
   * Proxy a request to Anthropic API
   */
  async proxyRequest(
    request: FastifyRequest,
    reply: FastifyReply,
    path: string
  ): Promise<void> {
    const startTime = Date.now();

    // Check circuit breaker
    if (!anthropicCircuitBreaker.canAttempt()) {
      request.log.warn('Circuit breaker is open - fast-failing request');

      if (request.tokenPayload && request.requestId) {
        const metrics: UsageMetrics = {
          device_id: request.tokenPayload.device_id,
          user_id: request.tokenPayload.user_id,
          org_id: request.tokenPayload.org_id,
          model: 'unknown',
          input_tokens: 0,
          output_tokens: 0,
          latency_ms: Date.now() - startTime,
          status: 503,
          timestamp: new Date(),
          request_id: request.requestId,
        };
        usageTracker.track(metrics);
      }

      reply.code(503).send({
        error: 'Service Unavailable',
        message: 'Anthropic API is temporarily unavailable. Circuit breaker is open.',
        retry_after: 30,
      });
      return;
    }

    try {
      // Build target URL
      const targetUrl = `${this.anthropicBaseUrl}${path}`;

      // Prepare headers for Anthropic
      // Note: Anthropic uses x-api-key header, not Authorization Bearer
      const anthropicHeaders: Record<string, string> = {
        'x-api-key': this.anthropicApiKey,
        'Content-Type': 'application/json',
        'anthropic-version': request.headers['anthropic-version'] as string || '2023-06-01',
      };

      // Debug: log what API key we're using
      request.log.debug({
        apiKeyPrefix: this.anthropicApiKey?.substring(0, 20) + '...',
        apiKeyLength: this.anthropicApiKey?.length,
      }, 'Using Anthropic API key');

      // Add optional headers
      if (request.headers['anthropic-beta']) {
        anthropicHeaders['anthropic-beta'] = request.headers['anthropic-beta'] as string;
      }

      // Add request ID for tracing
      if (request.requestId) {
        anthropicHeaders['x-proxy-request-id'] = request.requestId;
      }

      // Get request body
      const body = request.body as any;

      // Note: We don't modify the request body to avoid validation issues
      // Usage tracking is done via our own tracking service

      request.log.info({
        targetUrl,
        method: request.method,
        model: body?.model,
      }, 'Proxying request to Anthropic');

      // Make request to Anthropic
      const anthropicResponse = await undiciFetch(targetUrl, {
        method: request.method as any,
        headers: anthropicHeaders,
        body: body ? JSON.stringify(body) : undefined,
        // Don't follow redirects automatically
        maxRedirections: 0,
        // Increase timeouts for slower connections
        headersTimeout: 60000, // 60 seconds
        bodyTimeout: 120000, // 120 seconds
      });

      // Check if response is streaming (SSE)
      const contentType = anthropicResponse.headers['content-type'] || '';
      const isStreaming = contentType.includes('text/event-stream');

      // Copy relevant response headers
      reply.header('content-type', contentType);
      reply.header('x-request-id', anthropicResponse.headers['x-request-id'] || request.requestId);

      if (anthropicResponse.headers['anthropic-version']) {
        reply.header('anthropic-version', anthropicResponse.headers['anthropic-version']);
      }

      reply.code(anthropicResponse.statusCode);

      if (isStreaming) {
        // Handle streaming response
        await this.handleStreamingResponse(
          anthropicResponse,
          reply,
          request,
          startTime
        );
      } else {
        // Handle regular response
        const responseBody = await anthropicResponse.body.text();

        // Log error responses for debugging
        if (anthropicResponse.statusCode >= 400) {
          request.log.error({
            statusCode: anthropicResponse.statusCode,
            responseBody: responseBody.substring(0, 500),
            headers: Object.fromEntries(Object.entries(anthropicResponse.headers)),
          }, 'Anthropic API error response');
        }

        // Track usage
        try {
          const parsedBody = JSON.parse(responseBody);
          await this.trackUsage(
            request,
            anthropicResponse.statusCode,
            parsedBody,
            Object.fromEntries(Object.entries(anthropicResponse.headers)),
            startTime
          );
        } catch (e) {
          request.log.warn('Failed to parse response body for usage tracking');
        }

        reply.send(responseBody);
      }

      // Record success in circuit breaker if status is 2xx
      if (anthropicResponse.statusCode >= 200 && anthropicResponse.statusCode < 300) {
        anthropicCircuitBreaker.recordSuccess();
      } else if (anthropicResponse.statusCode >= 500) {
        // Record failure for 5xx errors
        anthropicCircuitBreaker.recordFailure();
      }
    } catch (error) {
      request.log.error(error, 'Proxy error');

      // Record failure in circuit breaker
      anthropicCircuitBreaker.recordFailure();

      // Track failed request
      if (request.tokenPayload && request.requestId) {
        const metrics: UsageMetrics = {
          device_id: request.tokenPayload.device_id,
          user_id: request.tokenPayload.user_id,
          org_id: request.tokenPayload.org_id,
          model: 'unknown',
          input_tokens: 0,
          output_tokens: 0,
          latency_ms: Date.now() - startTime,
          status: 502,
          timestamp: new Date(),
          request_id: request.requestId,
        };
        usageTracker.track(metrics);
      }

      reply.code(502).send({
        error: 'Bad Gateway',
        message: 'Failed to proxy request to Anthropic API',
      });
    }
  }

  /**
   * Handle streaming responses (SSE)
   */
  private async handleStreamingResponse(
    anthropicResponse: Awaited<ReturnType<typeof undiciFetch>>,
    reply: FastifyReply,
    request: FastifyRequest,
    startTime: number
  ): Promise<void> {
    let accumulatedUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };

    try {
      // Stream the response body
      for await (const chunk of anthropicResponse.body) {
        // Parse SSE events to extract usage data
        const chunkStr = chunk.toString();

        // Try to extract usage from message_stop events
        const messageStopMatch = chunkStr.match(/event: message_stop\s+data: ({[^}]+})/);
        if (messageStopMatch) {
          try {
            const data = JSON.parse(messageStopMatch[1]);
            if (data.usage) {
              accumulatedUsage.input_tokens = data.usage.input_tokens || 0;
              accumulatedUsage.output_tokens = data.usage.output_tokens || 0;
              accumulatedUsage.cache_creation_input_tokens = data.usage.cache_creation_input_tokens || 0;
              accumulatedUsage.cache_read_input_tokens = data.usage.cache_read_input_tokens || 0;
            }
          } catch (e) {
            // Ignore parsing errors
          }
        }

        // Forward chunk to client
        reply.raw.write(chunk);
      }

      reply.raw.end();

      // Track usage after stream completes
      await this.trackUsage(
        request,
        anthropicResponse.statusCode,
        { usage: accumulatedUsage },
        Object.fromEntries(Object.entries(anthropicResponse.headers)),
        startTime
      );
    } catch (error) {
      request.log.error(error, 'Streaming error');
      reply.raw.end();
    }
  }

  /**
   * Track usage metrics
   */
  private async trackUsage(
    request: FastifyRequest,
    statusCode: number,
    responseBody: any,
    responseHeaders: Record<string, any>,
    startTime: number
  ): Promise<void> {
    if (!request.tokenPayload || !request.requestId) {
      return;
    }

    const usage = usageTracker.extractUsage(responseBody, responseHeaders);
    const body = request.body as any;

    const metrics: UsageMetrics = {
      device_id: request.tokenPayload.device_id,
      user_id: request.tokenPayload.user_id,
      org_id: request.tokenPayload.org_id,
      model: body?.model || 'unknown',
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      latency_ms: Date.now() - startTime,
      status: statusCode,
      timestamp: new Date(),
      request_id: request.requestId,
    };

    usageTracker.track(metrics);
  }
}

export const anthropicProxy = new AnthropicProxy();
