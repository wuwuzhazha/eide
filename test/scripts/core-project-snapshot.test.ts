const fs = require('fs');
const os = require('os');
const NodePath = require('path');
const yaml = require('yaml');
const { loadProjectSnapshot } = require('../../../src/core/project_snapshot') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

function writeProject(root: string, overrides?: (cfg: any) => void): void {
    const cfg: any = {
        version: '4.1',
        name: 'demo',
        type: 'ARM',
        srcDirs: ['src'],
        outDir: 'build',
        miscInfo: { uid: 'demo-uid' },
        targets: {
            Debug: {
                toolchain: 'GCC',
                toolchainConfigMap: {
                    GCC: { options: { 'c/cpp-compiler': { C_FLAGS: '' } } }
                },
                uploadConfigMap: { JLink: {} },
                uploader: 'JLink',
                excludeList: ['src/excluded.c'],
                cppPreprocessAttrs: {
                    name: 'default',
                    incList: ['src', 'inc'],
                    libList: [],
                    defineList: ['DEMO=1']
                },
                settings: {}
            },
            Release: {
                toolchain: 'GCC',
                toolchainConfigMap: { GCC: { options: {} } },
                uploadConfigMap: { JLink: {} },
                uploader: 'JLink',
                excludeList: [],
                cppPreprocessAttrs: { name: 'default', incList: [], libList: [], defineList: [] },
                settings: {}
            }
        }
    };
    overrides?.(cfg);
    fs.mkdirSync(NodePath.join(root, '.eide'), { recursive: true });
    fs.writeFileSync(NodePath.join(root, '.eide', 'eide.yml'), yaml.stringify(cfg));
}

const root = NodePath.join(os.tmpdir(), `eide-snapshot-${process.pid}-${Date.now()}`);
try {
    writeProject(root);

    const snapshot = loadProjectSnapshot(root);
    assert(snapshot.name === 'demo' && snapshot.type === 'ARM', 'snapshot: reads identity');
    assert(snapshot.target === 'Debug', 'snapshot: defaults to first target');
    assert(snapshot.targets.join('|') === 'Debug|Release', 'snapshot: lists targets');
    assert(snapshot.toolchain === 'GCC', 'snapshot: toolchain');
    assert(snapshot.outDir === 'build', 'snapshot: output dir');
    assert(snapshot.srcDirs.length === 1 && snapshot.srcDirs[0].endsWith('src'),
        'snapshot: resolves source dirs');
    assert(snapshot.includeDirs.join('|') === 'src|inc', 'snapshot: include dirs');
    assert(snapshot.defines.join('|') === 'DEMO=1', 'snapshot: defines');
    assert(snapshot.excludeList.join('|') === 'src/excluded.c', 'snapshot: excludes');

    const release = loadProjectSnapshot(root, 'Release');
    assert(release.target === 'Release', 'snapshot: explicit target');

    const workspaceFile = NodePath.join(root, 'demo.code-workspace');
    fs.writeFileSync(workspaceFile, '{}');
    const fromWorkspace = loadProjectSnapshot(workspaceFile);
    assert(fromWorkspace.projectPath === root, 'snapshot: accepts code-workspace path');

    let missingTarget = false;
    try {
        loadProjectSnapshot(root, 'Nope');
    } catch {
        missingTarget = true;
    }
    assert(missingTarget, 'snapshot: missing target fails explicitly');

    let newerVersion = false;
    const newerRoot = NodePath.join(root, 'newer');
    writeProject(newerRoot, cfg => { cfg.version = '4.2'; });
    try {
        loadProjectSnapshot(newerRoot);
    } catch {
        newerVersion = true;
    }
    assert(newerVersion, 'snapshot: newer config version fails explicitly');

    let oldVersion = false;
    const oldRoot = NodePath.join(root, 'old');
    writeProject(oldRoot, cfg => { cfg.version = '3.5'; });
    try {
        loadProjectSnapshot(oldRoot);
    } catch {
        oldVersion = true;
    }
    assert(oldVersion, 'snapshot: old config requires migration');

    let badList = false;
    const badRoot = NodePath.join(root, 'bad');
    writeProject(badRoot, cfg => { cfg.targets.Debug.cppPreprocessAttrs.incList = 'src'; });
    try {
        loadProjectSnapshot(badRoot);
    } catch {
        badList = true;
    }
    assert(badList, 'snapshot: invalid include list fails explicitly');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('All project snapshot tests passed.');
export {};
