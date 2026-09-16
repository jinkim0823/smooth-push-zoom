// SPDX-License-Identifier: GPL-3.0-or-later
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const metadata = JSON.parse(fs.readFileSync('metadata.json', 'utf8'));
assert.equal(metadata.uuid, 'smooth-push-zoom@jinkim0823.github.io');
assert.equal(metadata.url, 'https://github.com/jinkim0823/smooth-push-zoom');
for (const [channel, version] of [['standard', '46'], ['experimental-51', '51']]) {
    const zip = `dist/${channel}/${metadata.uuid}.shell-extension.zip`;
    const files = execFileSync('unzip', ['-Z1', zip], {encoding: 'utf8'}).trim().split('\n');
    const expected = ['extension.js', 'prefs.js', 'metadata.json', 'README.md',
        'LICENSE', 'NOTICE.md', 'CHANGELOG.md', 'schemas/',
        'schemas/org.gnome.shell.extensions.smooth-push-zoom.gschema.xml'];
    assert.deepEqual(files.sort(), expected.sort());
    const packed = JSON.parse(execFileSync('unzip', ['-p', zip, 'metadata.json'], {encoding: 'utf8'}));
    assert.deepEqual(packed['shell-version'], [version]);
    assert.equal(packed.uuid, metadata.uuid);
    assert.equal(packed.url, metadata.url);
    for (const file of ['extension.js', 'prefs.js', 'LICENSE', 'NOTICE.md']) {
        assert.equal(execFileSync('unzip', ['-p', zip, file], {encoding: 'utf8'}), fs.readFileSync(file, 'utf8'));
    }
    console.log(`PASS: ${channel} package contents, metadata and source match`);
}
assert.deepEqual(JSON.parse(fs.readFileSync('metadata.json'))['shell-version'], ['46']);
