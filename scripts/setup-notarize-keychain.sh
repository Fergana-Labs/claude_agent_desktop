#!/bin/bash
# Store notarization credentials in keychain instead of env vars

set -e

echo "Setting up notarization credentials in keychain..."
echo ""

# Check if credentials are in environment
if [ -z "$APPLE_ID" ] || [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
    echo "❌ Environment variables not set. Please run:"
    echo "   source ~/.signing-env"
    exit 1
fi

echo "Storing credentials in keychain profile 'notarytool-profile'..."
xcrun notarytool store-credentials "notarytool-profile" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD"

echo ""
echo "✅ Credentials stored in keychain!"
echo ""
echo "Now update package.json to use keychain instead of env vars."
