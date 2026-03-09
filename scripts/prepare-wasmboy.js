const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '..', 'node_modules', 'wasmboy', 'dist', 'wasmboy.wasm.iife.js');
const outputPath = path.join(__dirname, '..', 'media', 'wasmboy.wasm.iife.js');

function main() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing WasmBoy bundle at ${sourcePath}. Run: npm install`);
  }

  fs.copyFileSync(sourcePath, outputPath);
  console.log(`WasmBoy bundle copied (unmodified) to ${outputPath}`);
}

main();
