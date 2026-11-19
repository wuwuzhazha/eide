/*
    MIT License

    Copyright (c) 2019 github0null

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
*/

import * as os from 'os';
import * as NodePath from 'path';
import { File } from '../lib/node-utility/File';

export function getDotnetRootDirs(): string[] {
    if (os.platform() === 'win32') {
        const dirs: string[] = [];
        for (const key of ['ProgramFiles', 'ProgramFiles(x86)']) {
            const programFiles = process.env[key];
            if (programFiles) {
                dirs.push(NodePath.join(programFiles, 'dotnet'));
            }
        }
        dirs.push('C:\\Program Files\\dotnet', 'C:\\Program Files (x86)\\dotnet');
        return dirs.filter((dir, index) => dirs.indexOf(dir) === index);
    }
    return ['/usr/share/dotnet', '/usr/local/share/dotnet'];
}

export function findDotnetExecutable(): string | undefined {
    const exeName = os.platform() === 'win32' ? 'dotnet.exe' : 'dotnet';
    for (const root of getDotnetRootDirs()) {
        const exe = NodePath.join(root, exeName);
        if (File.IsFile(exe)) {
            return exe;
        }
    }
    return undefined;
}

export function findRuntimeInRoots(roots: string[], minMajor: number): string | undefined {
    for (const root of roots) {
        const sharedDir = NodePath.join(root, 'shared', 'Microsoft.NETCore.App');
        if (!File.IsDir(sharedDir)) {
            continue;
        }
        let runtimeDirs: File[];
        try {
            runtimeDirs = new File(sharedDir).GetList(undefined, [/^\d+\./]);
        } catch {
            continue;
        }
        for (const runtimeDir of runtimeDirs) {
            const m = /^(\d+)\./.exec(runtimeDir.name);
            if (m && parseInt(m[1]) >= minMajor) {
                return `Microsoft.NETCore.App ${runtimeDir.name}`;
            }
        }
    }
    return undefined;
}

export function findInstalledDotnetRuntime(minMajor: number): string | undefined {
    return findRuntimeInRoots(getDotnetRootDirs(), minMajor);
}
