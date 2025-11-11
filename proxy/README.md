# Claude Code Proxy

A lightweight proxy service that transparently routes Claude Code SDK traffic through our infrastructure while keeping the user's Anthropic API key secure on the server.

## Features

- **Zero-config bootstrap**: Automatic token provisioning for desktop app installations
- **Streaming support**: Full SSE streaming with Server-Sent Events
- **Usage tracking**: Centralized logging and metrics collection
- **Rate limiting**: Per-device rate limits with Redis support
- **Model allowlisting**: Control which models each token can access
- **Circuit breaker**: Automatic fast-fail during Anthropic API outages
- **Health checks**: Liveness and readiness probes for deployment

## Quick Start

### 1. Install Dependencies

```bash
cd proxy
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

Required environment variables:
- `ANTHROPIC_API_KEY`: Your Anthropic API key
- `JWT_SECRET`: A secure random string for signing tokens (generate with `openssl rand -base64 32`)

### 3. Run Development Server

```bash
npm run dev
```

The proxy will start on `http://localhost:3001`

### 4. Test the Proxy

Bootstrap a new token:

```bash
curl -X POST http://localhost:3001/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"device_id": "test-device-123"}'
```

Response:
```json
{
  "wrapper_token": "eyJhbGc...",
  "proxy_base_url": "http://localhost:3001",
  "expires_at": "2024-01-02T12:00:00.000Z"
}
```

Use the token to make API calls:

```bash
curl -X POST http://localhost:3001/v1/messages \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

## API Endpoints

### Public Endpoints (No Auth Required)

#### `POST /bootstrap`
Bootstrap a new installation and receive a wrapper token.

Request:
```json
{
  "device_id": "unique-device-identifier",
  "app_version": "1.0.0"
}
```

Response:
```json
{
  "wrapper_token": "jwt-token",
  "proxy_base_url": "https://api.wrapper.example.com",
  "expires_at": "2024-01-02T12:00:00.000Z"
}
```

#### `POST /refresh`
Refresh an existing token before it expires.

Headers:
```
Authorization: Bearer <current-token>
```

Response: Same as bootstrap

#### `GET /healthz`
Liveness probe - returns 200 if server is running.

#### `GET /readyz`
Readiness probe - returns 200 if server is ready to handle traffic.

### Protected Endpoints (Auth Required)

All endpoints require `Authorization: Bearer <wrapper-token>` header.

#### `POST /v1/messages`
Create a message with Claude (proxied to Anthropic).

#### `POST /v1/complete`
Text completion (proxied to Anthropic).

#### `POST /v1/messages/count_tokens`
Count tokens in a message (proxied to Anthropic).

#### `GET /admin/usage`
Get usage metrics for your device.

#### `GET /admin/stats`
Get aggregated statistics for your device.

#### `GET /admin/circuit-breaker`
Get circuit breaker status.

#### `POST /admin/circuit-breaker/reset`
Manually reset the circuit breaker.

## Architecture

### Request Flow

```
Desktop App → Proxy (validate token) → Anthropic API
                ↓
         Track usage metrics
```

1. Desktop app sends request with wrapper token
2. Proxy validates token and extracts entitlements
3. Proxy forwards request to Anthropic with master API key
4. Proxy streams response back to client
5. Proxy tracks usage metrics for analytics

### Token Structure

Wrapper tokens are JWTs with the following claims:

```json
{
  "device_id": "unique-device-id",
  "user_id": "optional-user-id",
  "org_id": "optional-org-id",
  "models": ["claude-3-5-sonnet-20241022", "..."],
  "rate_limit": 100,
  "spend_cap": 1000,
  "iat": 1234567890,
  "exp": 1234654290
}
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | Server port |
| `HOST` | No | `0.0.0.0` | Server host |
| `ANTHROPIC_API_KEY` | Yes | - | Your Anthropic API key |
| `ANTHROPIC_BASE_URL` | No | `https://api.anthropic.com` | Anthropic API base URL |
| `JWT_SECRET` | Yes | - | Secret for signing tokens |
| `JWT_EXPIRATION_HOURS` | No | `24` | Token expiration time |
| `PROXY_BASE_URL` | No | `http://localhost:3001` | Public proxy URL |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW` | No | `60000` | Rate limit window (ms) |
| `MAX_PAYLOAD_SIZE` | No | `2097152` | Max request size (2MB) |
| `CORS_ORIGINS` | No | `*` | Allowed CORS origins |
| `REDIS_URL` | No | - | Redis URL for distributed rate limiting |
| `LOG_LEVEL` | No | `info` | Logging level |

### Rate Limiting

- In-memory rate limiting by default (per-device)
- Optional Redis support for distributed rate limiting across multiple instances
- Configurable limits per token via JWT claims

### Security

- Anthropic API key stored only on server
- JWT tokens with expiration
- Model allowlisting per token
- Payload size limits (default 2MB)
- Rate limiting per device
- Structured logging with correlation IDs

## Deployment

### Production Checklist

- [ ] Set strong `JWT_SECRET` (32+ random bytes)
- [ ] Configure `ANTHROPIC_API_KEY` in secret manager
- [ ] Set `PROXY_BASE_URL` to public domain
- [ ] Enable Redis for distributed rate limiting
- [ ] Configure `CORS_ORIGINS` to allowed domains
- [ ] Set `NODE_ENV=production`
- [ ] Enable TLS/HTTPS
- [ ] Set up monitoring and alerting
- [ ] Configure autoscaling

### Docker Example

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

### Health Checks

Configure your load balancer:
- Liveness: `GET /healthz` (expect 200)
- Readiness: `GET /readyz` (expect 200)

## Development

### Scripts

- `npm run dev` - Start development server with auto-reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm test` - Run tests (coming soon)

### Project Structure

```
proxy/
├── src/
│   ├── config.ts              # Configuration management
│   ├── types.ts               # TypeScript types
│   ├── index.ts               # Main server
│   ├── middleware/
│   │   ├── auth.ts           # Authentication middleware
│   │   └── logging.ts        # Request logging
│   ├── routes/
│   │   ├── health.ts         # Health check endpoints
│   │   ├── bootstrap.ts      # Token provisioning
│   │   ├── proxy.ts          # Anthropic API proxy
│   │   └── admin.ts          # Admin endpoints
│   └── services/
│       ├── token.ts          # JWT token service
│       ├── proxy.ts          # Anthropic proxy handler
│       ├── usage.ts          # Usage tracking
│       └── circuit-breaker.ts # Circuit breaker implementation
├── package.json
├── tsconfig.json
└── .env.example
```

## Future Enhancements

- [ ] User authentication with SSO
- [ ] Organization management
- [ ] Spend tracking and billing
- [ ] Advanced analytics dashboard
- [ ] Multi-region deployment
- [x] Circuit breaker for Anthropic API failures (completed)
- [ ] Webhook support for events
- [ ] Admin UI for token management

## Troubleshooting

### Token expired errors

Tokens expire after 24 hours by default. Use the `/refresh` endpoint to get a new token, or call `/bootstrap` again.

### Rate limit errors

Check your `RATE_LIMIT_MAX` setting. You can increase it or implement per-token limits via JWT claims.

### Proxy connection errors

Verify:
1. Proxy is running: `curl http://localhost:3001/healthz`
2. `ANTHROPIC_API_KEY` is set correctly
3. Network connectivity to Anthropic API

### Streaming not working

Ensure your client:
1. Sets `Content-Type: application/json`
2. Includes `"stream": true` in request body
3. Handles `text/event-stream` responses

## License

MIT
