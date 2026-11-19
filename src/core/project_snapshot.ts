import * as fs from 'fs';
import * as NodePath from 'path';
import * as yaml from 'yaml';

export const SUPPORTED_CONFIG_VERSION = '4.1';

export interface ProjectSnapshot {
    projectPath: string;
    configPath: string;
    name: string;
    type: string;
    target: string;
    targets: string[];
    toolchain: string;
    outDir: string;
    srcDirs: string[];
    includeDirs: string[];
    libDirs: string[];
    defines: string[];
    excludeList: string[];
    toolchainConfig: { [key: string]: any };
    toolchainOptions: { [key: string]: any };
    virtualFolder?: any;
    packDir?: string;
    deviceName?: string;
    uploader: string;
    uploadConfig: { [key: string]: any };
    hasDependencies: boolean;
}

function readVersion(value: unknown): string {
    if (typeof value === 'number') {
        return String(value);
    }
    if (typeof value === 'string') {
        return value;
    }
    return '0';
}

function compareVersion(a: string, b: string): number {
    const pa = a.split('.').map(part => parseInt(part, 10) || 0);
    const pb = b.split('.').map(part => parseInt(part, 10) || 0);
    const length = Math.max(pa.length, pb.length);
    for (let i = 0; i < length; i++) {
        const va = pa[i] ?? 0;
        const vb = pb[i] ?? 0;
        if (va !== vb) {
            return va - vb;
        }
    }
    return 0;
}

function asStringArray(value: unknown, name: string): string[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new Error(`Invalid project config: '${name}' must be a string array.`);
    }
    return value as string[];
}

function resolveProjectRoot(projectPath: string): string {
    const absolute = NodePath.resolve(projectPath);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
        if (!absolute.endsWith('.code-workspace')) {
            throw new Error(`Unsupported project file: ${absolute}`);
        }
        return NodePath.dirname(absolute);
    }
    return absolute;
}

export function loadProjectSnapshot(projectPath: string, target?: string): ProjectSnapshot {
    const root = resolveProjectRoot(projectPath);
    const configPath = NodePath.join(root, '.eide', 'eide.yml');
    if (!fs.existsSync(configPath)) {
        throw new Error(`Project config not found: ${configPath}`);
    }

    const config = yaml.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config || typeof config !== 'object') {
        throw new Error(`Invalid project config: ${configPath}`);
    }

    const version = readVersion(config.version);
    const versionDiff = compareVersion(version, SUPPORTED_CONFIG_VERSION);
    if (versionDiff > 0) {
        throw new Error(
            `Project config version '${version}' is newer than supported '${SUPPORTED_CONFIG_VERSION}'.`);
    }
    if (versionDiff < 0) {
        throw new Error(
            `Project config version '${version}' requires migration; ` +
            `open the project in VS Code with EIDE once, then retry.`);
    }

    const targets = config.targets && typeof config.targets === 'object'
        ? Object.keys(config.targets)
        : [];
    if (targets.length === 0) {
        throw new Error(`Invalid project config: no targets in ${configPath}`);
    }
    const targetName = target || targets[0];
    if (!targets.includes(targetName)) {
        throw new Error(`Target '${targetName}' not found. Available: ${targets.join(', ')}`);
    }

    const targetConfig = config.targets[targetName];
    const toolchain = targetConfig.toolchain;
    if (typeof toolchain !== 'string' || toolchain.length === 0) {
        throw new Error(`Invalid project config: target '${targetName}' has no toolchain.`);
    }
    const toolchainConfig = targetConfig.toolchainConfigMap?.[toolchain];
    if (!toolchainConfig || typeof toolchainConfig !== 'object') {
        throw new Error(
            `Invalid project config: target '${targetName}' has no config for toolchain '${toolchain}'.`);
    }
    const cpp = targetConfig.cppPreprocessAttrs || {};
    const uploader = String(targetConfig.uploader || '');
    const uploadConfig = targetConfig.uploadConfigMap?.[uploader];
    if (uploadConfig !== undefined
        && (typeof uploadConfig !== 'object' || Array.isArray(uploadConfig))) {
        throw new Error(`Invalid project config: upload config for '${uploader}' must be an object.`);
    }

    const srcDirs = asStringArray(config.srcDirs, 'srcDirs')
        .map(dir => NodePath.isAbsolute(dir) ? dir : NodePath.resolve(root, dir));

    return {
        projectPath: root,
        configPath,
        name: String(config.name || NodePath.basename(root)),
        type: String(config.type || 'UNKNOWN'),
        target: targetName,
        targets,
        toolchain,
        outDir: String(config.outDir || 'build'),
        srcDirs,
        includeDirs: asStringArray(cpp.incList, 'cppPreprocessAttrs.incList'),
        libDirs: asStringArray(cpp.libList, 'cppPreprocessAttrs.libList'),
        defines: asStringArray(cpp.defineList, 'cppPreprocessAttrs.defineList'),
        excludeList: asStringArray(targetConfig.excludeList, 'excludeList'),
        toolchainConfig,
        toolchainOptions: toolchainConfig.options || {},
        virtualFolder: config.virtualFolder,
        packDir: config.packDir || undefined,
        deviceName: config.deviceName || undefined,
        uploader,
        uploadConfig: uploadConfig || {},
        hasDependencies: Array.isArray(config.dependenceList) && config.dependenceList.length > 0
    };
}

export function resolveOutputDir(snapshot: ProjectSnapshot): string {
    return NodePath.resolve(snapshot.projectPath, snapshot.outDir, snapshot.target);
}
