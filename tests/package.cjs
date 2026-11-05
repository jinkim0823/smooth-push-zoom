// SPDX-License-Identifier: GPL-3.0-or-later
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');

const metadata = JSON.parse(fs.readFileSync('metadata.json', 'utf8'));
assert.equal(metadata.uuid, 'smooth-push-zoom@jinkim0823.github.io');
assert.deepEqual(metadata['shell-version'], ['46']);

const zip = `dist/standard/${metadata.uuid}.shell-extension.zip`;
const unzip = (...args) => execFileSync('unzip', [...args, zip], {encoding: 'utf8'});
const files = unzip('-Z1').trim().split('\n').sort();
assert.deepEqual(files, ['CHANGELOG.md', 'LICENSE', 'NOTICE.md', 'README.md', 'extension.js',
    'geometry.js', 'metadata.json', 'prefs.js', 'schemas/',
    'schemas/org.gnome.shell.extensions.smooth-push-zoom.gschema.xml'].sort());
assert.deepEqual(JSON.parse(execFileSync('unzip', ['-p', zip, 'metadata.json'], {encoding: 'utf8'})), metadata);
for (const file of ['extension.js', 'geometry.js', 'prefs.js', 'LICENSE', 'NOTICE.md'])
    assert.equal(execFileSync('unzip', ['-p', zip, file], {encoding: 'utf8'}), fs.readFileSync(file, 'utf8'));
console.log('PASS: package contents, metadata and source match');
