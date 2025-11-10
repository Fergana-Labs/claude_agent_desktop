# Building and Signing a Release

This guide explains how to create a signed and notarized DMG for macOS distribution.

## Prerequisites

1. **Apple Developer Account** - You need an active Apple Developer account
2. **Code Signing Certificate** - "Developer ID Application" certificate installed in Keychain

## Step 1: Set Up Certificates

1. Go to https://developer.apple.com/account/resources/certificates/list
2. Create a "Developer ID Application" certificate
3. Download and install it (double-click to add to Keychain)

## Step 2: Get Your Credentials

### Find Your Team ID
- Go to https://developer.apple.com/account
- Your Team ID is shown in the top right (10 characters, like "ABC123XYZ9")

### Find Your Signing Identity
```bash
security find-identity -v -p codesigning
```
Look for a line like: `Developer ID Application: Your Name (TEAMID)`

### Create App-Specific Password
1. Go to https://appleid.apple.com/account/manage
2. Under "Security" → "App-Specific Passwords"
3. Click "Generate an app-specific password"
4. Save this password (format: xxxx-xxxx-xxxx-xxxx)

## Step 3: Set Environment Variables

Create a file `~/.signing-env` with your credentials:

```bash
export APPLE_TEAM_ID="YOUR_TEAM_ID"
export APPLE_ID="your-email@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
```

Then load it before building:
```bash
source ~/.signing-env
```

## Step 4: Build the Release

```bash
# Build the application
npm run build

# Package and sign (this will also notarize)
npm run package
```

**Important:**
- The signing identity will be automatically detected from your Keychain
- Notarization can take 5-15 minutes
- You'll see "Notarizing..." messages during the process

## Step 5: Distribute

The signed and notarized DMG will be in the `release/` directory:
- `release/Claude Agent Desktop-1.0.0-arm64.dmg` (Apple Silicon)
- `release/Claude Agent Desktop-1.0.0-x64.dmg` (Intel)

You can now share these DMG files with your friends. They should be able to:
1. Download the DMG
2. Open it without security warnings
3. Drag the app to Applications
4. Launch it normally

## Troubleshooting

### "No identity found" error
- Make sure you've installed the Developer ID Application certificate
- Run `security find-identity -v -p codesigning` to verify

### Notarization fails
- Check that your APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD are correct
- Ensure you're using an app-specific password, not your regular Apple ID password
- Check that your Apple Developer account is in good standing

### "App is damaged" message
- This usually means notarization didn't complete
- Try running: `xattr -cr "Claude Agent Desktop.app"` to clear attributes
- Then re-notarize manually

## Manual Notarization (if automatic fails)

If the automatic notarization fails, you can do it manually:

```bash
# Submit for notarization
xcrun notarytool submit "release/Claude Agent Desktop-1.0.0-arm64.dmg" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

# Staple the ticket
xcrun stapler staple "release/Claude Agent Desktop-1.0.0-arm64.dmg"
```
