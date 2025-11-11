# Proxy Setup Guide

This guide explains how to set up and use the Claude Code proxy infrastructure to route all Anthropic API traffic through your own server.

## Overview

The proxy system consists of three main components:

1. **Proxy Server** (`proxy/`): A Fastify-based HTTP proxy that sits between your desktop app and the Anthropic API
2. **Bootstrap Client** (`src/main/proxy-bootstrap.ts`): Desktop app code that automatically provisions tokens
3. **Refresh Service** (`src/main/proxy-refresh-service.ts`): Background service that keeps tokens fresh

## Why Use the Proxy?

- **Centralized API Key Management**: Keep your Anthropic API key on the server, not distributed to clients
- **Usage Tracking**: Monitor and analyze API usage across all installations
- **Rate Limiting**: Control API usage per device or organization
- **Model Control**: Restrict which models each installation can access
- **Cost Management**: Set spending caps per device or user
- **Observability**: Centralized logging, metrics, and monitoring

## Architecture

```
Desktop App → Bootstrap → Proxy Server → Anthropic API
     ↓           ↓              ↓
  Wrapper    Wrapper       Master API
   Token      Token           Key

Background Refresh Service → /refresh endpoint
```

### Flow

1. **First Launch**: Desktop app calls `/bootstrap` to get a wrapper token
2. **API Calls**: All SDK requests go through proxy with wrapper token
3. **Proxy**: Validates token, forwards to Anthropic with master key, tracks usage
4. **Background**: Refresh service automatically renews tokens before expiry

## Setup Instructions

### Step 1: Configure the Proxy Server

1. Navigate to the proxy directory:
   ```bash
   cd proxy
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create environment file:
   ```bash
   cp .env.example .env
   ```

4. Configure `.env`:
   ```bash
   # Required
   ANTHROPIC_API_KEY=sk-ant-...    # Your Anthropic API key
   JWT_SECRET=$(openssl rand -base64 32)  # Generate strong secret

   # Optional (with defaults)
   PORT=3001
   PROXY_BASE_URL=http://localhost:3001
   JWT_EXPIRATION_HOURS=24
   RATE_LIMIT_MAX=100
   RATE_LIMIT_WINDOW=60000
   ```

5. Build the proxy:
   ```bash
   npm run build
   ```

6. Start the proxy:
   ```bash
   # Development
   npm run dev

   # Production
   npm start
   ```

7. Verify it's running:
   ```bash
   curl http://localhost:3001/healthz
   # Should return: {"status":"ok","timestamp":"..."}
   ```

### Step 2: Configure the Desktop App

1. Set environment variable to enable proxy mode:
   ```bash
   # In your shell profile (.bashrc, .zshrc, etc.)
   export ENABLE_PROXY=true
   export PROXY_BOOTSTRAP_URL=http://localhost:3001/bootstrap
   export PROXY_HEALTH_URL=http://localhost:3001/healthz
   ```

2. Or create a `.env` file in the project root:
   ```bash
   ENABLE_PROXY=true
   PROXY_BOOTSTRAP_URL=http://localhost:3001/bootstrap
   PROXY_HEALTH_URL=http://localhost:3001/healthz
   ```

3. Build and run the desktop app:
   ```bash
   npm run build
   npm start
   ```

### Step 3: Verify End-to-End

1. Launch the desktop app
2. Check the console logs for:
   ```
   Bootstrapping proxy configuration...
   Proxy token bootstrapped successfully
   Proxy is healthy and ready
   Starting proxy token refresh service
   ```

3. Try sending a message to Claude
4. Check proxy server logs for:
   ```
   Incoming request
   Proxying request to Anthropic
   Usage tracked: { requestId: ..., inputTokens: ..., outputTokens: ... }
   Request completed
   ```

## Testing the Proxy

### Manual Bootstrap Test

```bash
curl -X POST http://localhost:3001/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"device_id":"test-device-123","app_version":"1.0.0"}'
```

Response:
```json
{
  "wrapper_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "proxy_base_url": "http://localhost:3001",
  "expires_at": "2025-11-11T20:00:00.000Z"
}
```

### Manual API Call Test

```bash
TOKEN="<wrapper_token_from_above>"

curl -X POST http://localhost:3001/v1/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Say hello!"}]
  }'
```

### Check Usage Metrics

```bash
curl http://localhost:3001/admin/usage \
  -H "Authorization: Bearer $TOKEN"
```

### Check Circuit Breaker Status

```bash
curl http://localhost:3001/admin/circuit-breaker \
  -H "Authorization: Bearer $TOKEN"
```

## Features Explained

### Automatic Token Refresh

The desktop app includes a background service that:
- Checks token expiry every 30 minutes
- Refreshes tokens when < 1 hour remains
- Falls back to bootstrap if refresh fails
- Runs silently without user intervention

### Circuit Breaker

Protects against cascading failures:
- Opens after 5 consecutive failures
- Fast-fails requests for 30 seconds
- Attempts recovery with half-open state
- Closes after 2 successful requests

### Rate Limiting

Per-device rate limits:
- Default: 100 requests per minute
- Configurable per token via JWT claims
- Can use Redis for distributed limiting
- Returns 429 when limit exceeded

### Usage Tracking

Every request tracks:
- Device/user/org IDs
- Model used
- Input/output tokens
- Cache usage
- Latency
- Status code
- Timestamp

View metrics at `/admin/usage` endpoint.

## Deployment

### Development

```bash
cd proxy
npm run dev
```

The proxy runs on `http://localhost:3001` with hot reload.

### Production

1. **Set strong secrets:**
   ```bash
   JWT_SECRET=$(openssl rand -base64 32)
   ```

2. **Configure environment:**
   ```bash
   NODE_ENV=production
   PROXY_BASE_URL=https://proxy.yourdomain.com
   ANTHROPIC_API_KEY=sk-ant-...
   ```

3. **Use Redis for rate limiting:**
   ```bash
   REDIS_URL=redis://your-redis-host:6379
   ```

4. **Build and start:**
   ```bash
   npm run build
   npm start
   ```

### Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY proxy/package*.json ./
RUN npm ci --only=production
COPY proxy/ ./
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t claude-proxy -f Dockerfile.proxy .
docker run -p 3001:3001 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e JWT_SECRET=your-secret \
  claude-proxy
```

### AWS/Cloud Deployment

Key considerations:

1. **Secrets Management**: Use AWS Secrets Manager, GCP Secret Manager, or similar
2. **Load Balancer**: Place behind ALB/ELB with health checks
3. **Autoscaling**: Scale based on CPU and request rate
4. **TLS**: Enable HTTPS with valid certificates
5. **Monitoring**: CloudWatch, Datadog, or similar
6. **Redis**: Use managed Redis (ElastiCache, Cloud Memorystore)

## Troubleshooting

### Desktop App Won't Bootstrap

**Symptoms:** App shows "Failed to bootstrap proxy"

**Solutions:**
1. Verify proxy is running: `curl http://localhost:3001/healthz`
2. Check proxy logs for errors
3. Verify `ENABLE_PROXY=true` is set
4. Check firewall/network settings

### Token Expired Errors

**Symptoms:** "Token expired. Please refresh your token."

**Solutions:**
1. Wait 30 minutes for auto-refresh
2. Restart desktop app to trigger bootstrap
3. Check refresh service is running
4. Verify proxy `/refresh` endpoint works

### Circuit Breaker Open

**Symptoms:** "Circuit breaker is open"

**Solutions:**
1. Check proxy can reach Anthropic API
2. Verify `ANTHROPIC_API_KEY` is valid
3. Wait 30 seconds for auto-recovery
4. Manually reset: `POST /admin/circuit-breaker/reset`

### Rate Limit Exceeded

**Symptoms:** 429 errors from proxy

**Solutions:**
1. Increase `RATE_LIMIT_MAX` in proxy
2. Configure per-token limits in bootstrap
3. Use Redis for distributed limiting
4. Add more proxy instances

## Security Best Practices

1. **Strong JWT Secret**: Use 32+ random bytes
2. **HTTPS Only**: Never run production over HTTP
3. **Rotate Keys**: Rotate API keys and JWT secrets monthly
4. **Monitor Logs**: Watch for unusual patterns
5. **Rate Limiting**: Prevent abuse with aggressive limits
6. **Token Expiry**: Keep expiration short (24h or less)
7. **Network Security**: Use VPC, security groups, firewalls
8. **Audit Trail**: Log all token issuance and refreshes

## Performance Tuning

### Proxy Server

- **Keep-Alive**: Maintain warm connections to Anthropic
- **Connection Pooling**: Use undici's built-in pooling
- **Streaming**: Use efficient streaming for large responses
- **Logging**: Use structured logs, avoid verbose in production
- **Memory**: Monitor memory usage, restart if leaking

### Desktop App

- **Token Caching**: Cache tokens in encrypted storage
- **Retry Logic**: Implement exponential backoff
- **Connection Reuse**: Reuse HTTP connections
- **Background Refresh**: Start early (1 hour before expiry)

## Monitoring

Key metrics to track:

1. **Request Rate**: Requests per second
2. **Error Rate**: % of failed requests
3. **Latency**: p50, p95, p99 response times
4. **Token Usage**: Active tokens, refreshes per hour
5. **Circuit Breaker**: State changes, failures
6. **Anthropic API**: Response times, error rates

## Cost Analysis

Proxy overhead per request:
- **Latency**: ~50ms added
- **Memory**: ~10MB per concurrent request
- **Compute**: Minimal CPU usage
- **Storage**: ~1KB per tracked request

For 1M requests/month:
- Server: ~$50-100 (small instance)
- Redis: ~$15-30 (optional)
- Bandwidth: ~$5-10
- **Total**: ~$70-140/month

## Next Steps

1. Read the [proxy README](../proxy/README.md) for API details
2. Review the [plan document](./claude-proxy-plan.md) for architecture
3. Check the [proxy source code](../proxy/src/) for implementation
4. Set up monitoring and alerting
5. Deploy to production
6. Configure user authentication (future)
7. Add organization management (future)

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review proxy server logs
3. Enable debug logging: `LOG_LEVEL=debug`
4. Open an issue on GitHub
