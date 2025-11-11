/**
 * Circuit Breaker pattern implementation
 * Prevents cascading failures by stopping requests to a failing service
 */

export enum CircuitState {
  CLOSED = 'CLOSED',   // Normal operation
  OPEN = 'OPEN',       // Circuit tripped, fast-fail
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

export interface CircuitBreakerOptions {
  failureThreshold: number; // Number of failures before opening
  successThreshold: number; // Number of successes to close from half-open
  timeout: number;          // Time in ms before attempting half-open
  name: string;            // Name for logging
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private nextAttempt: number = Date.now();
  private options: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = {
      failureThreshold: options.failureThreshold || 5,
      successThreshold: options.successThreshold || 2,
      timeout: options.timeout || 30000, // 30 seconds
      name: options.name || 'default',
    };
  }

  /**
   * Check if the circuit allows requests
   */
  canAttempt(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      // Check if timeout has passed
      if (Date.now() >= this.nextAttempt) {
        console.log(`[CircuitBreaker:${this.options.name}] Attempting half-open state`);
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        return true;
      }
      return false;
    }

    // HALF_OPEN state allows attempts
    return true;
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        console.log(`[CircuitBreaker:${this.options.name}] Closing circuit - service recovered`);
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
      }
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    this.failureCount++;

    if (this.state === CircuitState.HALF_OPEN) {
      console.log(`[CircuitBreaker:${this.options.name}] Failure in half-open, reopening circuit`);
      this.trip();
      return;
    }

    if (this.failureCount >= this.options.failureThreshold) {
      this.trip();
    }
  }

  /**
   * Trip the circuit breaker (open it)
   */
  private trip(): void {
    this.state = CircuitState.OPEN;
    this.nextAttempt = Date.now() + this.options.timeout;
    console.warn(
      `[CircuitBreaker:${this.options.name}] Circuit opened due to ${this.failureCount} failures. ` +
      `Will retry in ${this.options.timeout}ms`
    );
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    console.log(`[CircuitBreaker:${this.options.name}] Circuit manually reset`);
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttempt: this.state === CircuitState.OPEN ? new Date(this.nextAttempt) : null,
    };
  }
}

// Global circuit breaker for Anthropic API
export const anthropicCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000, // 30 seconds
  name: 'anthropic-api',
});
