// Test notarization to see the actual error
const { notarize } = require('@electron/notarize');
const { execSync } = require('child_process');

async function test() {
  console.log('Testing notarization credentials...\n');

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  console.log('Apple ID:', appleId);
  console.log('Team ID:', teamId);
  console.log('Password:', appleIdPassword ? '***SET***' : 'NOT SET');
  console.log('');

  // First, let's try the raw xcrun command to see the error
  console.log('Testing with xcrun notarytool directly...\n');

  try {
    const result = execSync(
      `xcrun notarytool history --apple-id "${appleId}" --team-id "${teamId}" --password "${appleIdPassword}" --output-format json`,
      { encoding: 'utf8', stdio: 'pipe' }
    );
    console.log('✅ Credentials work! History output:');
    console.log(result);
  } catch (error) {
    console.log('❌ Error from xcrun notarytool:');
    console.log('STDOUT:', error.stdout);
    console.log('STDERR:', error.stderr);
    console.log('');
  }

  // Now check if we have a signed app to test with
  const appPath = 'release/mac-arm64/Claude Agent Desktop.app';
  const fs = require('fs');

  if (fs.existsSync(appPath)) {
    console.log('\nFound app at:', appPath);
    console.log('Attempting notarization...\n');

    try {
      await notarize({
        appPath,
        appleId,
        appleIdPassword,
        teamId,
      });
      console.log('✅ Notarization succeeded!');
    } catch (error) {
      console.log('❌ Notarization error:');
      console.log('Error message:', error.message);
      console.log('Full error:', error);
    }
  } else {
    console.log('\nNo app found at:', appPath);
    console.log('Run `npm run build && npm run package` first (it will fail, but create the app)');
  }
}

test().catch(console.error);
