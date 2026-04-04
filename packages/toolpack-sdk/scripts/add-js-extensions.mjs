import nodePath from 'path';
import nodeFs from 'fs';

export default function transformer(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);
  const fileDir = nodePath.dirname(file.path);

  function processSource(source) {
    if (!source || !source.value) return;
    const specifier = source.value;

    // Only process relative imports
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return;

    // Skip if already has an extension
    if (/\.(js|ts|mjs|cjs|json|node)$/.test(specifier)) return;

    // Determine whether this resolves to a directory (index file) or a direct file
    const resolvedDir = nodePath.resolve(fileDir, specifier);
    const resolvedFile = resolvedDir + '.ts';

    if (nodeFs.existsSync(resolvedDir) && nodeFs.statSync(resolvedDir).isDirectory()) {
      source.value = specifier + '/index.js';
    } else if (nodeFs.existsSync(resolvedFile)) {
      source.value = specifier + '.js';
    }
    // If neither exists, leave unchanged — may be a type-only or aliased import
  }

  // Handle import declarations
  root.find(j.ImportDeclaration).forEach(declaration => {
    processSource(declaration.value.source);
  });

  // Handle export all declarations: export * from './module'
  root.find(j.ExportAllDeclaration).forEach(declaration => {
    processSource(declaration.value.source);
  });

  // Handle export named declarations: export { foo } from './module'
  root.find(j.ExportNamedDeclaration).forEach(declaration => {
    processSource(declaration.value.source);
  });

  // Handle dynamic import expressions: import('./module')
  root.find(j.ImportExpression).forEach(expr => {
    processSource(expr.value.source);
  });

  return root.toSource();
}
