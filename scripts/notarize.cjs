const { execSync } = require('child_process');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`\n🔖 Stapling notarization ticket to ${appPath}...`);

  try {
    execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });
    console.log('✅ Stapling complete!\n');
  } catch (error) {
    console.error('❌ Stapling failed:', error.message);
    console.log('Note: This happens if the app was not notarized yet.\n');
    throw error;
  }
};
