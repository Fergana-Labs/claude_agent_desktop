export interface WrapperTokenPayload {
  device_id: string;
  user_id?: string;
  org_id?: string;
  models: string[];
  rate_limit?: number;
  spend_cap?: number;
  iat: number;
  exp: number;
}

export interface UsageMetrics {
  user_id?: string;
  org_id?: string;
  device_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  latency_ms: number;
  status: number;
  timestamp: Date;
  request_id: string;
}

export interface BootstrapRequest {
  device_id: string;
  app_version?: string;
}

export interface BootstrapResponse {
  wrapper_token: string;
  proxy_base_url: string;
  expires_at: string;
  refresh_token?: string;
}

export interface ProxyRequestContext {
  requestId: string;
  tokenPayload: WrapperTokenPayload;
  startTime: number;
}
