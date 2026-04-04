#!/usr/bin/env node
/**
 * Update version across all Toolpack packages
 * 
 * Usage:
 *   node scripts/update-version.js
 *   node scripts/update-version.js
 *   npm run version 1.3.0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Files to update
const FILES_TO_UPDATE = [
  {
    path: 'packages/toolpack-sdk/package.json',
    field: 'version',
  },
  {
    path: 'packages/toolpack-knowledge/package.json',
    field: 'version',
  },
  {
    path: 'samples/toolpack-cli/package.json',
    field: 'version',
  },
  {
    path: 'samples/toolpack-cli/source/components/AppInfo.tsx',
    type: 'typescript',
    pattern: /const version = 'v[\d\.\-A-Z]+';/,
    replacement: (version) => `const version = 'v${version}';`,
  },
];

function updatePackageJson(filePath, version) {
  const fullPath = path.join(rootDir, filePath);
  const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const oldVersion = content.version;
  content.version = version;
  fs.writeFileSync(fullPath, JSON.stringify(content, null, 2) + '\n');
  return oldVersion;
}

function updateTypeScriptFile(filePath, pattern, replacement, version) {
  const fullPath = path.join(rootDir, filePath);
  let content = fs.readFileSync(fullPath, 'utf8');
  const oldMatch = content.match(pattern);
  const oldVersion = oldMatch ? oldMatch[0] : 'unknown';
  content = content.replace(pattern, replacement(version));
  fs.writeFileSync(fullPath, content);
  return oldVersion;
}

function main() {
  const newVersion = process.argv[2];

  if (!newVersion) {
    console.error('❌ Error: Version argument required');
    console.log('\nUsage:');
    console.log('  node scripts/update-version.js <version>');
    console.log('\nExamples:');
    console.log('  node scripts/update-version.js 1.2.0');
    console.log('  node scripts/update-version.js 1.2.0-SNAPSHOT.04032026');
    console.log('  node scripts/update-version.js 2.0.0-beta.1');
    process.exit(1);
  }

  // Validate version format (basic semver check)
  const versionRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9\.\-]+)?$/;
  if (!versionRegex.test(newVersion)) {
    console.error(`❌ Error: Invalid version format: ${newVersion}`);
    console.log('   Expected format: X.Y.Z or X.Y.Z-suffix');
    process.exit(1);
  }

  console.log(`🔄 Updating version to ${newVersion}...\n`);

  let updatedCount = 0;

  for (const file of FILES_TO_UPDATE) {
    try {
      let oldVersion;

      if (file.type === 'typescript') {
        oldVersion = updateTypeScriptFile(
          file.path,
          file.pattern,
          file.replacement,
          newVersion
        );
      } else {
        oldVersion = updatePackageJson(file.path, newVersion);
      }

      console.log(`✅ ${file.path}`);
      console.log(`   ${oldVersion} → ${newVersion}`);
      updatedCount++;
    } catch (error) {
      console.error(`❌ Failed to update ${file.path}:`, error.message);
    }
  }

  console.log(`\n✨ Updated ${updatedCount}/${FILES_TO_UPDATE.length} files`);
  console.log(`\n💡 Next steps:`);
  console.log(`   1. Review changes: git diff`);
  console.log(`   2. Build packages: npm run build`);
  console.log(`   3. Commit: git commit -am "chore: bump version to ${newVersion}"`);
}

main();
