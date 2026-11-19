const fs = require('fs');
const os = require('os');
const NodePath = require('path');
const { scanSourceFiles } = require('../../../src/core/source_scan') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

const root = NodePath.join(os.tmpdir(), `eide-source-scan-${process.pid}-${Date.now()}`);
try {
    const dirs = ['src/sub', 'src/.hidden', 'hal'];
    for (const dir of dirs) {
        fs.mkdirSync(NodePath.join(root, dir), { recursive: true });
    }
    const files = [
        'src/main.c',
        'src/debug.c',
        'src/startup.s',
        'src/readme.txt',
        'src/sub/x.cpp',
        'src/.hidden/y.c',
        'hal/gpio.c'
    ];
    for (const file of files) {
        fs.writeFileSync(NodePath.join(root, file), '');
    }

    const scanned = scanSourceFiles({
        rootDir: root,
        srcDirs: ['src', 'hal'],
        excludeList: ['src/debug.c', 'src/sub/**']
    }).map((p: string) => p.replace(/\\/g, '/'));
    assert(scanned.join('|') === 'hal/gpio.c|src/main.c|src/startup.s',
        'source scan: collects sources, applies excludes, skips hidden dirs');
    assert(!scanned.some((p: string) => p.endsWith('.txt')),
        'source scan: ignores non-source files');

    const absolute = scanSourceFiles({
        rootDir: root,
        srcDirs: [NodePath.join(root, 'src')],
        excludeList: ['src/debug.c', 'src/sub/**']
    }).map((p: string) => p.replace(/\\/g, '/'));
    assert(absolute.join('|') === 'src/main.c|src/startup.s',
        'source scan: accepts absolute source dirs');

    let missing = false;
    try {
        scanSourceFiles({ rootDir: root, srcDirs: ['not-exists'] });
    } catch {
        missing = true;
    }
    assert(missing, 'source scan: missing source dir fails explicitly');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('All source scan tests passed.');
export {};
