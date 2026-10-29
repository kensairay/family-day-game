import {mkdir, copyFile} from 'node:fs/promises';
await mkdir('dist/vendor', {recursive:true});
await copyFile('node_modules/qrcode-generator/dist/qrcode.js', 'dist/vendor/qrcode.js');
// qrcode.js includes its MIT copyright/license notice.
// Excel parsing is bundled locally and loaded only after the host selects a file.
const {build}=await import('esbuild');
await build({entryPoints:['client/xlsx-worker.js'],outfile:'dist/vendor/xlsx-worker.js',bundle:true,format:'esm',platform:'browser',minify:true,legalComments:'eof'});
