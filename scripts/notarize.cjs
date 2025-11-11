const { notarize } = require('@electron/notarize');
const { execSync } = require('child_process');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn('⚠️  Skipping notarization: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID must be set');
    return;
  }

  console.log(`\n📝 Notarizing ${appPath}...`);

  try {
    await notarize({
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log('✅ Notarization complete!');

    console.log(`\n🔖 Stapling notarization ticket...`);
    execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });
    console.log('✅ Stapling complete!\n');
  } catch (error) {
    console.error('❌ Notarization/stapling failed:', error.message);
    throw error;
  }
};
