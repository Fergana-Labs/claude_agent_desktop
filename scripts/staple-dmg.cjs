const { execSync } = require('child_process');
const path = require('path');

exports.default = async function (context) {
  // afterAllArtifactBuild receives different context
  const outDir = context.outDir || 'release';

  console.log('\n🔖 Stapling DMG files...');

  // Find all DMG files in the release directory
  const { readdirSync, existsSync } = require('fs');

  if (!existsSync(outDir)) {
    console.log('No release directory found, skipping DMG stapling');
    return;
  }

  const files = readdirSync(outDir);
  const dmgFiles = files.filter(f => f.endsWith('.dmg'));

  if (dmgFiles.length === 0) {
    console.log('No DMG files found, skipping stapling');
    return;
  }

  for (const dmgFile of dmgFiles) {
    const dmgPath = path.join(outDir, dmgFile);
    console.log(`\nStapling ${dmgFile}...`);

    try {
      execSync(`xcrun stapler staple "${dmgPath}"`, { stdio: 'inherit' });
      console.log(`✅ Successfully stapled ${dmgFile}`);
    } catch (error) {
      console.error(`❌ Failed to staple ${dmgFile}:`, error.message);
      throw error;
    }
  }

  console.log('\n✅ All DMGs stapled!\n');
};
