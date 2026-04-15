#!/usr/bin/env node
/**
 * Update version across all Toolpack packages and their peer dependencies
 * 
 * Usage:
 *   node scripts/update-version.js <version>
 *   npm run version 1.3.0
 * 
 * This script:
 * - Updates version in SDK, Knowledge, and Agents packages
 * - Updates peer dependency versions in Agents package
 * - Updates CLI sample version
 * - Updates AppInfo.tsx version display
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Package paths
const PACKAGES = {
  sdk: 'packages/toolpack-sdk/package.json',
  knowledge: 'packages/toolpack-knowledge/package.json',
  agents: 'packages/toolpack-agents/package.json',
};

// Files to update
const FILES_TO_UPDATE = [
  {
    path: PACKAGES.sdk,
    field: 'version',
    name: 'toolpack-sdk',
  },
  {
    path: PACKAGES.knowledge,
    field: 'version',
    name: '@toolpack-sdk/knowledge',
  },
  {
    path: PACKAGES.agents,
    field: 'version',
    name: '@toolpack-sdk/agents',
  },
  {
    path: 'samples/toolpack-cli/package.json',
    field: 'version',
    name: 'toolpack-cli',
  },
  {
    path: 'samples/toolpack-cli/source/components/AppInfo.tsx',
    type: 'typescript',
    pattern: /const version = 'v[\d\.\-A-Z]+';/,
    replacement: (version) => `const version = 'v${version}';`,
    name: 'AppInfo.tsx',
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

function updatePeerDependencies(filePath, versions) {
  const fullPath = path.join(rootDir, filePath);
  const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  
  if (!content.peerDependencies) {
    return null;
  }
  
  const updates = [];
  
  // Update toolpack-sdk peer dependency
  if (content.peerDependencies['toolpack-sdk'] && versions.sdk) {
    const oldVersion = content.peerDependencies['toolpack-sdk'];
    content.peerDependencies['toolpack-sdk'] = `^${versions.sdk}`;
    updates.push({ package: 'toolpack-sdk', old: oldVersion, new: `^${versions.sdk}` });
  }
  
  // Update @toolpack-sdk/knowledge peer dependency
  if (content.peerDependencies['@toolpack-sdk/knowledge'] && versions.knowledge) {
    const oldVersion = content.peerDependencies['@toolpack-sdk/knowledge'];
    content.peerDependencies['@toolpack-sdk/knowledge'] = `^${versions.knowledge}`;
    updates.push({ package: '@toolpack-sdk/knowledge', old: oldVersion, new: `^${versions.knowledge}` });
  }
  
  if (updates.length > 0) {
    fs.writeFileSync(fullPath, JSON.stringify(content, null, 2) + '\n');
  }
  
  return updates;
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
  console.log('📦 Step 1: Updating package versions\n');

  let updatedCount = 0;
  const versions = {
    sdk: newVersion,
    knowledge: newVersion,
    agents: newVersion,
  };

  // Update all package versions
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

      console.log(`✅ ${file.name || file.path}`);
      console.log(`   ${oldVersion} → ${newVersion}`);
      updatedCount++;
    } catch (error) {
      console.error(`❌ Failed to update ${file.path}:`, error.message);
    }
  }

  console.log(`\n✨ Updated ${updatedCount}/${FILES_TO_UPDATE.length} package versions`);

  // Update peer dependencies in agents package
  console.log(`\n📦 Step 2: Updating peer dependencies\n`);
  
  try {
    const peerUpdates = updatePeerDependencies(PACKAGES.agents, versions);
    
    if (peerUpdates && peerUpdates.length > 0) {
      console.log(`✅ @toolpack-sdk/agents peer dependencies:`);
      for (const update of peerUpdates) {
        console.log(`   ${update.package}: ${update.old} → ${update.new}`);
      }
    } else {
      console.log(`ℹ️  No peer dependencies to update`);
    }
  } catch (error) {
    console.error(`❌ Failed to update peer dependencies:`, error.message);
  }

  console.log(`\n✨ Version update complete!`);
  console.log(`\n💡 Next steps:`);
  console.log(`   1. Review changes: git diff`);
  console.log(`   2. Build packages: npm run build`);
  console.log(`   3. Run tests: npm test`);
  console.log(`   4. Commit: git commit -am "chore: bump version to ${newVersion}"`);
  console.log(`   5. Tag: git tag v${newVersion}`);
  console.log(`   6. Push: git push && git push --tags`);
}

main();
