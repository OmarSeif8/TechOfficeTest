/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const srcStatic = path.join(process.cwd(), '.next', 'static');
const destStatic = path.join(process.cwd(), '.next', 'standalone', '.next', 'static');
const srcPublic = path.join(process.cwd(), 'public');
const destPublic = path.join(process.cwd(), '.next', 'standalone', 'public');

if (fs.existsSync(srcStatic)) {
  fs.mkdirSync(path.dirname(destStatic), { recursive: true });
  fs.cpSync(srcStatic, destStatic, { recursive: true, force: true });
}

if (fs.existsSync(srcPublic)) {
  fs.mkdirSync(destPublic, { recursive: true });
  fs.cpSync(srcPublic, destPublic, { recursive: true, force: true });
}
