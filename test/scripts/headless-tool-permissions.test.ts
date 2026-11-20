const fs = require('fs');
const os = require('os');
const NodePath = require('path');
const { ensureBundledToolPermissions } = require('../../../src/headless/tool_permissions') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

const root = NodePath.join(os.tmpdir(), `eide-tool-permissions-${process.pid}-${Date.now()}`);

function write(path: string, content = ''): void {
    fs.mkdirSync(NodePath.dirname(path), { recursive: true });
    fs.writeFileSync(path, content);
}

function run(): void {
    ensureBundledToolPermissions(root);
    assert(true, 'missing bundled tools are ignored');

    if (process.platform === 'win32') {
        console.log('SKIP: executable permissions are not applicable on Windows');
        return;
    }

    const builderDir = process.platform === 'darwin'
        ? NodePath.join(root, 'tools', 'darwin', 'unify_builder', process.arch === 'arm64' ? 'arm64' : 'x86_64')
        : NodePath.join(root, 'tools', process.platform, 'unify_builder');
    const builder = NodePath.join(builderDir, 'unify_builder');
    const sevenZip = NodePath.join(root, 'tools', process.platform, '7z', '7za');
    write(builder);
    write(sevenZip);
    fs.chmodSync(builder, 0o644);
    fs.chmodSync(sevenZip, 0o644);

    ensureBundledToolPermissions(root);

    assert((fs.statSync(builder).mode & 0o111) === 0o111,
        'permissions: builder becomes executable');
    assert((fs.statSync(sevenZip).mode & 0o111) === 0o111,
        'permissions: 7za becomes executable');
}

run();
fs.rmSync(root, { recursive: true, force: true });
export {};
