# Claude Code Zero-Config Proxy Plan

## Objective
- Let any end user download our desktop app and immediately use Claude Code locally without touching API keys.
- Keep the Claude agent running on the user’s machine (full filesystem/tool access) while every HTTP request transparently detours through `https://www.stash.ac`.
- Ensure Anthropic only ever sees our organization-owned API key, not the user’s traffic directly.

## High-Level Approach
1. **SDK patch**: bundle the Claude Code CLI/SDK with its `CLAUDE_API_BASE_URL` (or equivalent constant) set to `https://www.stash.ac/v1`. Users never enter a key; the app injects a short wrapper token at launch.
2. **Wrapper token bootstrap**: on first run, the desktop app calls `/bootstrap` on our backend to obtain a signed wrapper token + proxy base URL. Token proves the request came from an untampered build/device.
3. **Thin HTTPS proxy**: `www.stash.ac` terminates TLS, validates the wrapper token, swaps the `Authorization` header for our real Anthropic API key, and forwards the request byte-for-byte to Anthropic. Streaming responses pass back unchanged.
4. **Observability & guardrails**: proxy logs request metadata, enforces per-device rate limits, and rotates tokens. Anthropic sees only our master key, so billing stays centralized.

## Detailed Components

### 1. Desktop App Changes
- **Bundled CLI**: ship Claude Code CLI binaries with the base URL defaulted to `https://www.stash.ac/v1`. 
- **Bootstrap call**: during first launch (and periodically), call `POST https://api.stash.ac/bootstrap` with:
  - Code-signature hash + build version.
  - An anonymized device identifier.
  - App channel (stable/beta).
- **Response**: `{ wrapper_token, proxy_base_url, expires_at }`.
- **Runtime config**: set `ANTHROPIC_API_KEY=wrapper_token`, `CLAUDE_API_BASE_URL=proxy_base_url`, then spawn the CLI. Token stored only in secure storage (Keychain/keytar).
- **Refresh**: background job hits `/refresh` before `expires_at`; if refresh fails, prompt the user to restart or re-bootstrap.

### 2. Bootstrap & Refresh APIs
- `POST /bootstrap`
  - Auth: code-signature verification + rate limit per device fingerprint.
  - Allocates wrapper token (JWT/PASETO) containing `device_id`, `app_version`, `scopes`, and TTL (e.g., 30 min).
  - Optionally returns feature flags (model allowlist, logging level).
- `POST /refresh`
  - Input: existing wrapper token + refresh nonce.
  - Output: new wrapper token with extended TTL.
  - If refresh denied (e.g., suspected abuse), instructs client to show “reinstall/update” message.

### 3. Proxy Service (`www.stash.ac`)
- **Tech**: Fastify/TypeScript or Go HTTP server with streaming support.
- **Flow**:
  1. Validate wrapper token signature & claims.
  2. Enforce per-device/model rate & concurrency limits.
  3. Construct upstream request:
     - Copy method, path, headers, body exactly.
     - Replace `Authorization: Bearer <wrapper_token>` with `Authorization: Bearer <org_anthropic_key>`.
     - Add `X-Stash-Device` header for logging.
  4. Send to `https://api.anthropic.com` using persistent TLS connections.
  5. Stream response back to client verbatim (support SSE, chunked).
  6. Log usage metrics (status, latency, tokens if provided) for analytics.
- **Safety**:
  - Allowlist Anthropic hosts only.
  - Body size limit (e.g., 2 MB) before forwarding.
  - Circuit breaker for upstream 5xx spikes (surface friendly error to client).

### 4. Security Considerations
- Wrapper tokens live only in memory + OS keychain; wipe on logout/app uninstall.
- Use attestation to make sure only official builds can call `/bootstrap` (e.g., signature verification, notarization checks).
- Monitor for leaked wrapper tokens by checking IP ranges; revoke tokens seen outside expected geos.
- Keep Anthropic keys in secret manager, rotate monthly; proxy should hot-reload keys.

### 5. Rollout Plan
| Phase | Scope | Success Criteria |
| --- | --- | --- |
| **Week 1** | Patch bundled CLI base URL, implement bootstrap API stub, hardcode proxy to echo requests for local testing. | Desktop app launches CLI hitting proxy, proxy captures traffic. |
| **Week 2** | Build production-ready proxy (auth, rate limiting, streaming), hook bootstrap + refresh flows, store tokens securely. | End-to-end chat flows succeed; Anthropic only sees org key; no manual config needed. |
| **Week 3** | Add observability (logs, metrics dashboards), failure handling (circuit breaker, retries), and user-facing error states. | Proxy resilient under load; desktop shows actionable errors. |
| **Week 4+** | Hardening (multi-region, autoscaling), optional auth/SSO upgrade, analytics dashboards. | System ready for public beta. |

### 6. Testing Strategy
- **Unit**: token issuance/verification, proxy header rewriting, error handling.
- **Integration**: run Claude CLI against staging proxy + mocked Anthropic to ensure identical responses and streaming behavior.
- **Security**: attempt token replay from different machines/IPs; verify proxy rejection.
- **Load**: simulate concurrent sessions to validate rate limits and throughput.

### 7. Documentation & Support
- Update README/onboarding docs to state “Claude works out of the box—no API key needed.”
- Provide internal runbook (bootstrap failures, token revocation, rotating Anthropic keys).
- Add troubleshooting UI copy for proxy downtime or refresh errors.
