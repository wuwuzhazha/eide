import * as fs from 'fs';
import * as os from 'os';
import * as NodePath from 'path';
import { findRuntimeInRoots } from '../../src/DotnetRuntime';

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

const base = NodePath.join(os.tmpdir(), `eide-dotnet-runtime-${process.pid}-${Date.now()}`);
const rootOld = NodePath.join(base, 'old');
const rootNew = NodePath.join(base, 'new');

fs.mkdirSync(NodePath.join(rootOld, 'shared', 'Microsoft.NETCore.App', '3.1.8'), { recursive: true });
fs.mkdirSync(NodePath.join(rootNew, 'shared', 'Microsoft.NETCore.App', '6.0.5'), { recursive: true });

try {
    assert(findRuntimeInRoots([rootOld], 6) === undefined,
        'findRuntimeInRoots: ignores runtime older than required major');

    assert(findRuntimeInRoots([rootOld, rootNew], 6) === 'Microsoft.NETCore.App 6.0.5',
        'findRuntimeInRoots: finds .NET 6 in a later root');

    assert(findRuntimeInRoots([rootNew], 7) === undefined,
        'findRuntimeInRoots: requires requested major version');

    assert(findRuntimeInRoots([NodePath.join(base, 'missing')], 6) === undefined,
        'findRuntimeInRoots: ignores missing root');
} finally {
    fs.rmSync(base, { recursive: true, force: true });
}
