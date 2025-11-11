#!/bin/bash

# Test script for Claude Code Proxy
# This script tests all major proxy endpoints

set -e

PROXY_URL="${PROXY_URL:-http://localhost:3001}"
DEVICE_ID="test-device-$(date +%s)"

echo "🧪 Testing Claude Code Proxy at $PROXY_URL"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test 1: Health Check
echo -e "${BLUE}Test 1: Health Check${NC}"
HEALTH_RESPONSE=$(curl -s "$PROXY_URL/healthz")
if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ Health check passed${NC}"
else
    echo -e "${RED}✗ Health check failed${NC}"
    exit 1
fi
echo ""

# Test 2: Readiness Check
echo -e "${BLUE}Test 2: Readiness Check${NC}"
READY_RESPONSE=$(curl -s "$PROXY_URL/readyz")
if echo "$READY_RESPONSE" | grep -q '"status":"ready"'; then
    echo -e "${GREEN}✓ Readiness check passed${NC}"
else
    echo -e "${RED}✗ Readiness check failed${NC}"
    echo "Response: $READY_RESPONSE"
    exit 1
fi
echo ""

# Test 3: Bootstrap Token
echo -e "${BLUE}Test 3: Bootstrap Token${NC}"
BOOTSTRAP_RESPONSE=$(curl -s -X POST "$PROXY_URL/bootstrap" \
    -H "Content-Type: application/json" \
    -d "{\"device_id\":\"$DEVICE_ID\",\"app_version\":\"1.0.0\"}")

if echo "$BOOTSTRAP_RESPONSE" | grep -q 'wrapper_token'; then
    echo -e "${GREEN}✓ Bootstrap succeeded${NC}"
    TOKEN=$(echo "$BOOTSTRAP_RESPONSE" | grep -o '"wrapper_token":"[^"]*"' | cut -d'"' -f4)
    echo "Token: ${TOKEN:0:50}..."
else
    echo -e "${RED}✗ Bootstrap failed${NC}"
    echo "Response: $BOOTSTRAP_RESPONSE"
    exit 1
fi
echo ""

# Test 4: Token Refresh
echo -e "${BLUE}Test 4: Token Refresh${NC}"
REFRESH_RESPONSE=$(curl -s -X POST "$PROXY_URL/refresh" \
    -H "Authorization: Bearer $TOKEN")

if echo "$REFRESH_RESPONSE" | grep -q 'wrapper_token'; then
    echo -e "${GREEN}✓ Token refresh succeeded${NC}"
    NEW_TOKEN=$(echo "$REFRESH_RESPONSE" | grep -o '"wrapper_token":"[^"]*"' | cut -d'"' -f4)
    TOKEN=$NEW_TOKEN
else
    echo -e "${RED}✗ Token refresh failed${NC}"
    echo "Response: $REFRESH_RESPONSE"
    exit 1
fi
echo ""

# Test 5: Authenticated Admin Endpoint
echo -e "${BLUE}Test 5: Admin Stats Endpoint${NC}"
STATS_RESPONSE=$(curl -s "$PROXY_URL/admin/stats" \
    -H "Authorization: Bearer $TOKEN")

if echo "$STATS_RESPONSE" | grep -q 'totalRequests'; then
    echo -e "${GREEN}✓ Admin stats endpoint working${NC}"
    echo "Stats: $STATS_RESPONSE"
else
    echo -e "${RED}✗ Admin stats endpoint failed${NC}"
    echo "Response: $STATS_RESPONSE"
    exit 1
fi
echo ""

# Test 6: Circuit Breaker Status
echo -e "${BLUE}Test 6: Circuit Breaker Status${NC}"
CB_RESPONSE=$(curl -s "$PROXY_URL/admin/circuit-breaker" \
    -H "Authorization: Bearer $TOKEN")

if echo "$CB_RESPONSE" | grep -q 'state'; then
    echo -e "${GREEN}✓ Circuit breaker status working${NC}"
    echo "Circuit Breaker: $CB_RESPONSE"
else
    echo -e "${RED}✗ Circuit breaker status failed${NC}"
    echo "Response: $CB_RESPONSE"
    exit 1
fi
echo ""

# Test 7: Anthropic API Proxy (optional - requires valid API key)
if [ ! -z "$TEST_ANTHROPIC_API" ]; then
    echo -e "${BLUE}Test 7: Anthropic API Proxy${NC}"
    API_RESPONSE=$(curl -s -X POST "$PROXY_URL/v1/messages" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -H "anthropic-version: 2023-06-01" \
        -d '{
            "model": "claude-sonnet-4-5-20250929",
            "max_tokens": 50,
            "messages": [{"role": "user", "content": "Say hello in 5 words"}]
        }')

    if echo "$API_RESPONSE" | grep -q 'content'; then
        echo -e "${GREEN}✓ Anthropic API proxy working${NC}"
        echo "Response preview: $(echo "$API_RESPONSE" | head -c 200)..."
    else
        echo -e "${RED}✗ Anthropic API proxy failed${NC}"
        echo "Response: $API_RESPONSE"
        exit 1
    fi
    echo ""
else
    echo -e "${BLUE}Test 7: Anthropic API Proxy${NC}"
    echo "⊘ Skipped (set TEST_ANTHROPIC_API=1 to enable)"
    echo ""
fi

# Summary
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ All tests passed!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Proxy is ready for use!"
echo "Device ID used: $DEVICE_ID"
echo "Token: ${TOKEN:0:50}..."
