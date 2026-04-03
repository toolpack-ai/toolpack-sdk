#!/usr/bin/env node

const { buildSync } = require('esbuild');
const fs = require('fs');
const path = require('path');

function getAllJsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      getAllJsFiles(filePath, fileList);
    } else if (file.endsWith('.js')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

const distDir = path.join(__dirname, '../dist');
const jsFiles = getAllJsFiles(distDir);

console.log(`Minifying ${jsFiles.length} JavaScript files...`);

let minified = 0;
let errors = 0;

jsFiles.forEach(file => {
  try {
    buildSync({
      entryPoints: [file],
      outfile: file,
      allowOverwrite: true,
      minify: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      keepNames: true,
    });
    minified++;
  } catch (err) {
    console.error(`Failed to minify ${file}:`, err.message);
    errors++;
  }
});

console.log(`✓ Minified ${minified} files`);
if (errors > 0) {
  console.error(`✗ Failed to minify ${errors} files`);
  process.exit(1);
}
