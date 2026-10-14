import {mkdir, copyFile} from 'node:fs/promises';
await mkdir('dist/vendor', {recursive:true});
await copyFile('node_modules/qrcode-generator/dist/qrcode.js', 'dist/vendor/qrcode.js');
// qrcode.js includes its MIT copyright/license notice.
