import * as os from 'os';
import * as NodePath from 'path';
import { ProjectSnapshot } from './project_snapshot';

export interface ProjectEnvironment {
    [name: string]: string;
}

export function createProjectEnvironment(
    snapshot: ProjectSnapshot, outDirRelative: string): ProjectEnvironment {
    const root = snapshot.projectPath;
    const outDir = NodePath.resolve(root, outDirRelative);
    return {
        workspaceFolder: root,
        workspaceFolderBasename: NodePath.basename(root),
        OutDir: outDir,
        OutDirRoot: snapshot.outDir,
        OutDirBase: outDirRelative,
        ProjectName: snapshot.name,
        ConfigName: snapshot.target,
        ProjectRoot: root,
        ExecutableName: NodePath.join(outDir, snapshot.name),
        ChipPackDir: snapshot.packDir || '',
        ChipName: snapshot.deviceName || '',
        SYS_Platform: process.platform,
        SYS_DirSep: NodePath.sep,
        SYS_DirSeparator: NodePath.sep,
        SYS_PathSep: NodePath.delimiter,
        SYS_PathSeparator: NodePath.delimiter,
        SYS_EOL: os.EOL
    };
}

export function resolveEnvironmentVariables(
    value: string, environment: ProjectEnvironment): string {
    return value.replace(/\$\{([^}]+)\}/g, (match, name) => {
        const resolved = environment[name];
        return resolved === undefined ? match : resolved;
    });
}
