#!/usr/bin/env node

/**
 * Patches the Claude Agent SDK to work with proxy wrapper tokens
 * This allows the SDK to accept non-Anthropic API keys when in proxy mode
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SDK_PATH = path.join(__dirname, '../node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs');

console.log('Patching Claude Agent SDK for proxy support...');

try {
  let sdk = fs.readFileSync(SDK_PATH, 'utf8');

  // Find and patch the API key validation
  // Look for patterns like: if (!apiKey.startsWith('sk-ant-'))
  const originalValidation = /if\s*\(\s*!\s*\w+\.startsWith\s*\(\s*['"]sk-ant-['"]\s*\)\s*\)/g;

  // Replace with: if (!apiKey.startsWith('sk-ant-') && !process.env.ANTHROPIC_BASE_URL?.includes('proxy'))
  const patchedValidation = `if (!apiKey.startsWith('sk-ant-') && !process.env.ANTHROPIC_BASE_URL?.includes('127.0.0.1'))`;

  const patchedSDK = sdk.replace(originalValidation, patchedValidation);

  if (sdk !== patchedSDK) {
    fs.writeFileSync(SDK_PATH, patchedSDK, 'utf8');
    console.log('✅ SDK patched successfully - proxy wrapper tokens will now work!');
  } else {
    console.log('⚠️  No validation pattern found to patch (SDK may have changed)');
    console.log('   The SDK might already be compatible or use a different validation method');
  }

} catch (error) {
  console.error('❌ Failed to patch SDK:', error.message);
  console.log('   The app will still work but may require a real Anthropic API key');
  process.exit(0); // Don't fail the build
}
