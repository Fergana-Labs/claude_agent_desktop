const { notarize } = require('@electron/notarize');
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function (context) {
  const outDir = context.outDir || 'release';

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn('⚠️  Skipping DMG notarization: credentials not set');
    return;
  }

  console.log('\n📝 Notarizing and stapling DMG files...');

  const { readdirSync, existsSync } = require('fs');

  if (!existsSync(outDir)) {
    console.log('No release directory found');
    return;
  }

  const files = readdirSync(outDir);
  const dmgFiles = files.filter(f => f.endsWith('.dmg'));

  for (const dmgFile of dmgFiles) {
    const dmgPath = path.join(outDir, dmgFile);

    console.log(`\n📝 Notarizing ${dmgFile}...`);

    try {
      // Notarize the DMG
      await notarize({
        appPath: dmgPath,
        appleId,
        appleIdPassword,
        teamId,
      });
      console.log(`✅ Notarization complete for ${dmgFile}`);

      // Staple the DMG
      console.log(`🔖 Stapling ${dmgFile}...`);
      execSync(`xcrun stapler staple "${dmgPath}"`, { stdio: 'inherit' });
      console.log(`✅ Stapling complete for ${dmgFile}`);

    } catch (error) {
      console.error(`❌ Failed to notarize/staple ${dmgFile}:`, error.message);
      throw error;
    }
  }

  console.log('\n✅ All DMGs notarized and stapled!\n');
};
