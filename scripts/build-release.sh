#!/bin/bash

# Build and Sign Release Script
# This script builds and signs a macOS release of Claude Agent Desktop

set -e

echo "🔨 Building Claude Agent Desktop Release..."
echo ""

# Check if environment variables are set
if [ -z "$APPLE_TEAM_ID" ] || [ -z "$APPLE_ID" ] || [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
    echo "⚠️  Warning: Signing credentials not set"
    echo ""
    echo "To enable code signing and notarization, set these environment variables:"
    echo "  export APPLE_TEAM_ID=\"your-team-id\""
    echo "  export APPLE_ID=\"your-email@example.com\""
    echo "  export APPLE_APP_SPECIFIC_PASSWORD=\"xxxx-xxxx-xxxx-xxxx\""
    echo ""
    echo "Continuing without signing..."
    echo ""
fi

# Check for signing identity
if security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
    echo "✅ Code signing identity found"
else
    echo "⚠️  No Developer ID Application certificate found in Keychain"
    echo "   The build will not be signed."
    echo ""
fi

# Build the application
echo "📦 Building application..."
npm run build

# Package
echo "📦 Packaging..."
npm run package

echo ""
echo "✅ Build complete!"
echo ""
echo "Output directory: release/"
ls -lh release/*.dmg 2>/dev/null || echo "No DMG files found"
echo ""

if [ -n "$APPLE_TEAM_ID" ] && [ -n "$APPLE_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
    echo "✅ Application signed and notarized"
    echo "   Your friends can open this DMG without security warnings"
else
    echo "ℹ️  Application was not signed"
    echo "   Users will need to right-click → Open to bypass Gatekeeper"
fi
