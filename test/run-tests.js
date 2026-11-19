const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testDir = path.join(__dirname, '..', 'out', 'tmp', 'test', 'scripts');
const files = fs.readdirSync(testDir).filter(file => file.endsWith('.js')).sort();

if (files.length === 0) {
    console.error(`No tests found in ${testDir}`);
    process.exit(1);
}

let failed = false;

for (const file of files) {
    console.log(`\n=== ${file} ===`);
    const result = spawnSync(process.execPath, [path.join(testDir, file)], { stdio: 'inherit' });
    if (result.status !== 0) {
        failed = true;
    }
}

process.exit(failed ? 1 : 0);
