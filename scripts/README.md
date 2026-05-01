# Version Update Script

## Overview

The `update-version.js` script updates versions across all Toolpack packages and their peer dependencies in a single command.

## What It Updates

### 1. Package Versions
- `packages/toolpack-sdk/package.json`
- `packages/toolpack-knowledge/package.json`
- `packages/toolpack-agents/package.json`
- `samples/toolpack-cli/package.json`

### 2. Peer Dependencies
- `@toolpack-sdk/agents` peer dependencies:
  - `toolpack-sdk` → `^{version}`
  - `@toolpack-sdk/knowledge` → `^{version}`

### 3. Display Versions
- `samples/toolpack-cli/source/components/AppInfo.tsx`

## Usage

```bash
# Basic usage
node scripts/update-version.js <version>

# Examples
node scripts/update-version.js 1.4.0
node scripts/update-version.js 2.0.0-beta.1
node scripts/update-version.js 1.3.1-SNAPSHOT.13042026

# Via npm script
npm run version 1.4.0
```

## Version Format

The script validates version format using semantic versioning:

```
X.Y.Z               # Standard release (e.g., 1.4.0)
X.Y.Z-suffix        # Pre-release (e.g., 2.0.0-beta.1)
X.Y.Z-SNAPSHOT.date # Snapshot (e.g., 1.4.0-SNAPSHOT.13042026)
```

## Output Example

```bash
$ node scripts/update-version.js 1.4.0

🔄 Updating version to 1.4.0...

📦 Step 1: Updating package versions

✅ toolpack-sdk
   1.3.0 → 1.4.0
✅ @toolpack-sdk/knowledge
   1.3.0 → 1.4.0
✅ @toolpack-sdk/agents
   1.3.0 → 1.4.0
✅ toolpack-cli
   1.3.0 → 1.4.0
✅ AppInfo.tsx
   const version = 'v1.3.0'; → const version = 'v1.4.0';

✨ Updated 5/5 package versions

📦 Step 2: Updating peer dependencies

✅ @toolpack-sdk/agents peer dependencies:
   toolpack-sdk: ^1.3.0 → ^1.4.0
   @toolpack-sdk/knowledge: ^1.3.0 → ^1.4.0

✨ Version update complete!

💡 Next steps:
   1. Review changes: git diff
   2. Build packages: npm run build
   3. Run tests: npm test
   4. Commit: git commit -am "chore: bump version to 1.4.0"
   5. Tag: git tag v1.4.0
   6. Push: git push && git push --tags
```

## What Gets Updated

### Before
```json
// packages/toolpack-sdk/package.json
{
  "name": "toolpack-sdk",
  "version": "1.3.0"
}

// packages/toolpack-knowledge/package.json
{
  "name": "@toolpack-sdk/knowledge",
  "version": "1.3.0"
}

// packages/toolpack-agents/package.json
{
  "name": "@toolpack-sdk/agents",
  "version": "1.3.0",
  "peerDependencies": {
    "toolpack-sdk": "^1.3.0",
    "@toolpack-sdk/knowledge": "^1.3.0"
  }
}
```

### After (running `node scripts/update-version.js 1.4.0`)
```json
// packages/toolpack-sdk/package.json
{
  "name": "toolpack-sdk",
  "version": "1.4.0"
}

// packages/toolpack-knowledge/package.json
{
  "name": "@toolpack-sdk/knowledge",
  "version": "1.4.0"
}

// packages/toolpack-agents/package.json
{
  "name": "@toolpack-sdk/agents",
  "version": "1.4.0",
  "peerDependencies": {
    "toolpack-sdk": "^1.4.0",
    "@toolpack-sdk/knowledge": "^1.4.0"
  }
}
```

## Error Handling

### Missing Version Argument
```bash
$ node scripts/update-version.js

❌ Error: Version argument required

Usage:
  node scripts/update-version.js <version>
```

### Invalid Version Format
```bash
$ node scripts/update-version.js 1.4

❌ Error: Invalid version format: 1.4
   Expected format: X.Y.Z or X.Y.Z-suffix
```

### File Not Found
```bash
❌ Failed to update packages/toolpack-sdk/package.json: ENOENT: no such file or directory
```

## Integration with npm

Add to `package.json`:

```json
{
  "scripts": {
    "version": "node scripts/update-version.js"
  }
}
```

Then use:

```bash
npm run version 1.4.0
```

## Best Practices

### 1. Always Review Changes
```bash
git diff
```

### 2. Build and Test Before Committing
```bash
npm run build
npm test
```

### 3. Use Consistent Version Numbers
- All packages use the same version
- Peer dependencies use `^` (caret) for compatibility

### 4. Follow Semantic Versioning
- **Patch** (1.3.1): Bug fixes
- **Minor** (1.4.0): New features, backward compatible
- **Major** (2.0.0): Breaking changes

### 5. Tag Releases
```bash
git tag v1.4.0
git push --tags
```

## Troubleshooting

### Script Fails to Update File

**Problem:** Permission denied or file not found

**Solution:**
```bash
# Check file exists
ls -la packages/toolpack-sdk/package.json

# Check permissions
chmod +x scripts/update-version.js
```

### Peer Dependencies Not Updated

**Problem:** Agents package doesn't have peer dependencies

**Solution:**
- Check `packages/toolpack-agents/package.json` has `peerDependencies` field
- Script only updates existing peer dependencies

### Version Mismatch After Update

**Problem:** Some files show old version

**Solution:**
```bash
# Re-run the script
node scripts/update-version.js 1.4.0

# Check all files
git diff
```

## Future Enhancements

Potential improvements:

1. **Dry Run Mode**
   ```bash
   node scripts/update-version.js 1.4.0 --dry-run
   ```

2. **Selective Updates**
   ```bash
   node scripts/update-version.js 1.4.0 --only=sdk,agents
   ```

3. **Automatic Git Operations**
   ```bash
   node scripts/update-version.js 1.4.0 --commit --tag
   ```

4. **Changelog Generation**
   - Auto-generate CHANGELOG.md entries
   - Pull from git commits since last tag

5. **Pre-release Versions**
   - Auto-increment pre-release numbers
   - `1.4.0-beta.1` → `1.4.0-beta.2`

## Related Scripts

- `npm run build` — Build all packages
- `npm test` — Run all tests
- `npm run lint` — Lint all packages
- `npm run publish` — Publish to npm (future)
