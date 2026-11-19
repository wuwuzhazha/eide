const fs = require('fs');
const os = require('os');
const NodePath = require('path');
const {
    stableStringify,
    createBuildId,
    writeBuildManifest,
    collectArtifacts
} = require('../../../src/core/build_manifest') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

const a = { b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } };
const b = { a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 };
assert(stableStringify(a) === stableStringify(b), 'manifest: stable stringify sorts keys');

const request = {
    projectPath: 'E:/demo',
    target: 'Debug',
    overrides: { defines: ['A=1'] }
};
const params = { defines: ['BASE'], sourceList: ['src/main.c'] };
const id1 = createBuildId(params, request);
const id2 = createBuildId(params, request);
assert(id1 === id2 && id1.length === 64, 'manifest: build id is deterministic sha256');

const changed = createBuildId(params, {
    ...request,
    overrides: { defines: ['A=2'] }
});
assert(changed !== id1, 'manifest: build id changes with overrides');

const baseDir = NodePath.join(os.tmpdir(), `eide-manifest-${process.pid}-${Date.now()}`);
try {
    fs.mkdirSync(baseDir, { recursive: true });
    for (const name of ['firmware.elf', 'firmware.hex', 'firmware.bin', 'firmware.map', 'notes.txt']) {
        fs.writeFileSync(NodePath.join(baseDir, name), 'x');
    }
    const artifacts = collectArtifacts(baseDir);
    assert(artifacts.length === 4, 'manifest: collects known artifacts');
    assert(artifacts.every((p: string) => !p.endsWith('notes.txt')),
        'manifest: ignores unrelated files');

    const manifestPath = writeBuildManifest(baseDir, {
        buildId: id1,
        createdAt: new Date(0).toISOString(),
        request,
        target: 'Debug',
        toolchain: 'GCC',
        outDir: baseDir,
        defines: ['BASE', 'A=1'],
        includeDirs: ['src'],
        success: true,
        artifacts
    });
    const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert(written.buildId === id1, 'manifest: writes build id');
    assert(written.artifacts.length === 4, 'manifest: writes artifacts');
} finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
}

console.log('All build manifest tests passed.');
export {};
