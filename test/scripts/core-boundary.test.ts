import * as fs from 'fs';
import * as NodePath from 'path';

const roots = [
    NodePath.join(__dirname, '../../../../src/core'),
    NodePath.join(__dirname, '../../../../src/cli')
];
const vscodeImport = /(?:\bfrom\s+['"]vscode['"]|\brequire\s*\(\s*['"]vscode['"]\s*\))/;

function listTypeScriptFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = NodePath.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listTypeScriptFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            files.push(fullPath);
        }
    }
    return files;
}

const files: string[] = [];
for (const root of roots) {
    files.push(...listTypeScriptFiles(root));
}
if (files.length === 0) {
    console.error('FAIL: no core source files found');
    process.exit(1);
}

const violations: string[] = [];
for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (vscodeImport.test(text)) {
        violations.push(file);
    }
}

if (violations.length > 0) {
    console.error('FAIL: core/cli modules depend on vscode:');
    for (const file of violations) {
        console.error('  -', file);
    }
    process.exit(1);
}

console.log(`OK: ${files.length} core/cli files have no vscode dependency`);
export {};
