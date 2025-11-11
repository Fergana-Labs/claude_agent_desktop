# Claude Agent Desktop 1.0.1

## Downloads
Grab the files from the GitHub release assets:

- `Claude Agent Desktop-1.0.0-arm64.dmg` – Apple Silicon build (recommended for M‑series Macs)
- `Claude Agent Desktop-1.0.0.dmg` – universal build (works on both Intel and Apple Silicon)
- `Claude Agent Desktop-1.0.0-arm64-mac.zip` – zipped app bundle for advanced deployment scenarios

## Install & Launch
1. Download the DMG that matches your Mac.
2. Double-click the DMG, then drag `Claude Agent Desktop.app` into `Applications`.
3. Launch the app from Finder or Spotlight. Gatekeeper should allow it to open normally.
---


#### "No identity found" error
- Make sure you've installed the Developer ID Application certificate
- Run `security find-identity -v -p codesigning` to verify

#### Notarization fails
- Check that your APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD are correct
- Ensure you're using an app-specific password, not your regular Apple ID password
- Check that your Apple Developer account is in good standing

#### "App is damaged" message
- This usually means notarization didn't complete
- Try running: `xattr -cr "Claude Agent Desktop.app"` to clear attributes
- Then re-notarize manually

### Manual Notarization (if automatic fails)

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
