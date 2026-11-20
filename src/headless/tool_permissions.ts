import * as fs from 'fs';
import * as NodePath from 'path';

const BUNDLED_TOOLS = [
    ['7z', '7za'],
    ['unify_builder', 'unify_builder'],
    ['unify_builder', 'axf2elf'],
    ['unify_builder', 'serial_monitor']
];

export function ensureBundledToolPermissions(resourcesDir: string): void {
    if (process.platform === 'win32') {
        return;
    }
    const toolsDir = NodePath.join(NodePath.resolve(resourcesDir), 'tools', process.platform);
    const builderDir = process.platform === 'darwin'
        ? NodePath.join(toolsDir, 'unify_builder', process.arch === 'arm64' ? 'arm64' : 'x86_64')
        : NodePath.join(toolsDir, 'unify_builder');
    for (const parts of BUNDLED_TOOLS) {
        const executable = parts[0] === 'unify_builder'
            ? NodePath.join(builderDir, ...parts.slice(1))
            : NodePath.join(toolsDir, ...parts);
        if (!fs.existsSync(executable)) {
            continue;
        }
        const mode = fs.statSync(executable).mode;
        if ((mode & 0o111) !== 0o111) {
            fs.chmodSync(executable, mode | 0o111);
        }
    }
}
