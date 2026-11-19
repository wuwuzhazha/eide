import * as fs from 'fs';
import * as NodePath from 'path';
import * as micromatch from 'micromatch';

const sourceFile = /\.(?:c|cpp|c\+\+|cc|cxx|s|asm|a51)$/i;

export interface SourceScanOptions {
    rootDir: string;
    srcDirs: string[];
    excludeList?: string[];
}

function normalize(path: string): string {
    return path.replace(/\\/g, '/');
}

function walk(dir: string, files: string[]): void {
    if (!fs.existsSync(dir)) {
        throw new Error(`Source directory not found: ${dir}`);
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) {
            continue;
        }
        if (entry.isDirectory()) {
            if (entry.name.startsWith('.')) {
                continue;
            }
            walk(NodePath.join(dir, entry.name), files);
            continue;
        }
        if (entry.isFile() && sourceFile.test(entry.name)) {
            files.push(NodePath.join(dir, entry.name));
        }
    }
}

export function scanSourceFiles(options: SourceScanOptions): string[] {
    const files: string[] = [];
    for (const dir of options.srcDirs) {
        const absolute = NodePath.isAbsolute(dir)
            ? dir
            : NodePath.join(options.rootDir, dir);
        walk(absolute, files);
    }
    const excludes = (options.excludeList || []).map(normalize);
    const result: string[] = [];
    for (const file of files) {
        const relative = normalize(NodePath.relative(options.rootDir, file));
        if (excludes.some(pattern => micromatch.isMatch(relative, pattern))) {
            continue;
        }
        result.push(NodePath.relative(options.rootDir, file));
    }
    return result.sort();
}
