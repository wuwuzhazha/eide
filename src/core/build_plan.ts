import * as fs from 'fs';
import * as NodePath from 'path';
import * as ArmCpuUtils from '../ArmCpuUtils';
import { applyBuildOverrides, hasBuildOverrides, OverridableBuilderParams } from './build_overrides';
import { createBuildId } from './build_manifest';
import { createProjectEnvironment, resolveEnvironmentVariables } from './project_env';
import { ProjectSnapshot } from './project_snapshot';
import { scanSourceFiles } from './source_scan';
import { BuildOverrides, BuildRequest, BuildMode } from './types';

export interface BuildEnvironment {
    resourcesDir: string;
    toolchainPath: string;
    toolchainPrefix?: string;
    threadNum?: number;
    useMultithread?: boolean;
    showRepathOnLog?: boolean;
}

export interface BuilderParamsData extends OverridableBuilderParams {
    name: string;
    target: string;
    toolchain: string;
    toolchainCfgFile: string;
    toolchainLocation: string;
    buildMode: string;
    showRepathOnLog: boolean;
    threadNum: number;
    dumpPath: string;
    outDir: string;
    rootDir: string;
    sourceList: string[];
    sourceParams: { [name: string]: string };
    incDirs: string[];
    libDirs: string[];
    defines: string[];
    options: { [key: string]: any };
    env: { [name: string]: any };
    sysPaths: string[];
    alwaysInBuildSources: string[];
}

export interface BuildPlanOutput {
    params: BuilderParamsData;
    paramsPath: string;
    file: string;
    args: string[];
    outDir: string;
    buildId: string;
}

function ensureDirectory(path: string, name: string): void {
    if (!fs.existsSync(path) || !fs.statSync(path).isDirectory()) {
        throw new Error(`${name} not found: ${path}`);
    }
}

function builderExecutable(resourcesDir: string): string {
    let path: string;
    if (process.platform === 'win32') {
        path = NodePath.join(resourcesDir, 'tools', 'win32', 'unify_builder', 'unify_builder.exe');
    } else if (process.platform === 'linux') {
        path = NodePath.join(resourcesDir, 'tools', 'linux', 'unify_builder', 'unify_builder');
    } else if (process.platform === 'darwin') {
        const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
        path = NodePath.join(resourcesDir, 'tools', 'darwin', 'unify_builder', arch, 'unify_builder');
    } else {
        throw new Error(`Unsupported platform for headless build: ${process.platform}`);
    }
    if (!fs.existsSync(path)) {
        throw new Error(`Builder executable not found: ${path}`);
    }
    return path;
}

function toolchainPrefix(environment: BuildEnvironment): string {
    const prefix = environment.toolchainPrefix || 'arm-none-eabi-';
    const exe = process.platform === 'win32' ? '.exe' : '';
    const compiler = NodePath.join(environment.toolchainPath, 'bin', `${prefix}gcc${exe}`);
    if (!fs.existsSync(compiler)) {
        throw new Error(`Toolchain compiler not found: ${compiler}`);
    }
    return prefix;
}

function fpuSuffix(cpu: string, hardOption: string): string {
    if (hardOption === 'single') {
        return ArmCpuUtils.hasFpu(cpu) ? '-sp' : '';
    }
    if (hardOption === 'double') {
        return ArmCpuUtils.hasFpu(cpu, true) ? '-dp' : '';
    }
    return '';
}

function linkerScriptPath(rootDir: string, path: string): string {
    const absolute = NodePath.resolve(rootDir, path.trim());
    const unixPath = absolute.replace(/\\/g, '/');
    return unixPath.includes(' ') ? `"${unixPath}"` : unixPath;
}

function prepareOptions(
    snapshot: ProjectSnapshot,
    prefix: string,
    sources: string[],
    rootDir: string
): { [key: string]: any } {
    const options = JSON.parse(JSON.stringify(snapshot.toolchainOptions || {}));
    if (!options.global || typeof options.global !== 'object') {
        options.global = {};
    }
    if (!options['c/cpp-compiler'] || typeof options['c/cpp-compiler'] !== 'object') {
        options['c/cpp-compiler'] = {};
    }

    options.global.toolPrefix = prefix;
    const lto = options['c/cpp-compiler']['optimization-lto'];
    if (lto !== undefined) {
        options.global['optimization-lto'] = lto;
        delete options['c/cpp-compiler']['optimization-lto'];
    }
    if (!options.global['arm-thumb-mode']) {
        options.global['arm-thumb-mode'] = 'thumb';
    }

    const cpu = String(snapshot.toolchainConfig.cpuType || 'cortex-m3').toLowerCase();
    let suffix = fpuSuffix(cpu, snapshot.toolchainConfig.floatingPointHardware);
    if (ArmCpuUtils.isArmArchName(cpu)) {
        suffix = '';
    }
    options.global['microcontroller-cpu'] = cpu + suffix;
    options.global['microcontroller-fpu'] = cpu + suffix;
    options.global['microcontroller-float'] = cpu + suffix;
    options.global['$arch-extensions'] = ArmCpuUtils.getArchExtensions(cpu, 'GCC').length > 0
        ? String(snapshot.toolchainConfig.archExtensions || '').split(',').join('')
        : '';
    options.global['$clang-arch-extensions'] = '';
    options.global['$armlink-arch-extensions'] = '';

    if (!options.linker || typeof options.linker !== 'object') {
        options.linker = {};
    }
    const hasCpp = sources.some(file => /\.(?:cpp|c\+\+|cc|cxx)$/i.test(file));
    options.linker['$toolName'] = hasCpp ? 'g++' : 'gcc';
    const scatter = String(snapshot.toolchainConfig.scatterFilePath || '');
    options.linker['link-scatter'] = scatter.split(',')
        .map(path => path.trim())
        .filter(path => path.length > 0)
        .map(path => linkerScriptPath(rootDir, path));

    return options;
}

function builtinEnv(
    snapshot: ProjectSnapshot,
    outDirRelative: string,
    toolchainPath: string,
    builderDir: string
): { [name: string]: any } {
    return {
        ...createProjectEnvironment(snapshot, outDirRelative),
        ToolchainRoot: toolchainPath,
        EIDE_BUILDER_DIR: builderDir
    };
}

function ensureSupported(snapshot: ProjectSnapshot): void {
    if (snapshot.type !== 'ARM' || snapshot.toolchain !== 'GCC') {
        throw new Error(
            `Headless build currently supports ARM GCC only, got type='${snapshot.type}', ` +
            `toolchain='${snapshot.toolchain}'.`);
    }
    if (snapshot.hasDependencies) {
        throw new Error('Headless build does not support project dependencyList yet.');
    }
    const virtualFolder = snapshot.virtualFolder;
    if (virtualFolder && ((virtualFolder.files && virtualFolder.files.length > 0)
        || (virtualFolder.folders && virtualFolder.folders.length > 0))) {
        throw new Error('Headless build does not support virtual source folders yet.');
    }
    if (fs.existsSync(NodePath.join(snapshot.projectPath, '.eide', 'env.ini'))) {
        throw new Error('Headless build does not support .eide/env.ini yet.');
    }
}

export function resolveOutputDir(snapshot: ProjectSnapshot): string {
    return NodePath.resolve(snapshot.projectPath, snapshot.outDir, snapshot.target);
}

export function createBuildPlan(
    snapshot: ProjectSnapshot,
    request: BuildRequest,
    environment: BuildEnvironment
): BuildPlanOutput {
    ensureSupported(snapshot);
    ensureDirectory(environment.resourcesDir, 'EIDE resources directory');
    ensureDirectory(environment.toolchainPath, 'Toolchain directory');
    const prefix = toolchainPrefix(environment);

    const modelPath = NodePath.join(environment.resourcesDir, 'data', 'models', 'arm.gcc.model.json');
    if (!fs.existsSync(modelPath)) {
        throw new Error(`Toolchain model not found: ${modelPath}`);
    }
    const builder = builderExecutable(environment.resourcesDir);

    const outDirRelative = NodePath.join(snapshot.outDir, snapshot.target);
    const outDir = resolveOutputDir(snapshot);
    fs.mkdirSync(outDir, { recursive: true });

    const sourceList = scanSourceFiles({
        rootDir: snapshot.projectPath,
        srcDirs: snapshot.srcDirs,
        excludeList: snapshot.excludeList
    });

    const env = builtinEnv(snapshot, outDirRelative, environment.toolchainPath, NodePath.dirname(builder));
    const options = prepareOptions(snapshot, prefix, sourceList, snapshot.projectPath);
    const threadNum = environment.threadNum ?? 4;

    const params: BuilderParamsData = {
        name: snapshot.name,
        target: snapshot.target,
        toolchain: snapshot.toolchain,
        toolchainCfgFile: modelPath,
        toolchainLocation: environment.toolchainPath,
        buildMode: (environment.useMultithread ?? true) ? 'fast|multhread' : 'fast',
        showRepathOnLog: environment.showRepathOnLog ?? true,
        threadNum,
        dumpPath: outDirRelative,
        outDir: outDirRelative,
        rootDir: snapshot.projectPath,
        sourceList,
        sourceParams: {},
        incDirs: snapshot.includeDirs.map(path => resolveEnvironmentVariables(path, env)),
        libDirs: snapshot.libDirs.map(path => resolveEnvironmentVariables(path, env)),
        defines: snapshot.defines.map(value => resolveEnvironmentVariables(value, env)),
        options,
        env,
        sysPaths: [],
        alwaysInBuildSources: []
    };

    const effective = applyBuildOverrides(params, request.overrides);
    const mode: BuildMode = request.mode ?? (hasBuildOverrides(request.overrides) ? 'rebuild' : 'incremental');
    const paramsPath = NodePath.join(outDir, 'builder.params');
    fs.writeFileSync(paramsPath, JSON.stringify(effective, undefined, 4));

    const args = ['-p', paramsPath, '--no-color'];
    if (mode === 'rebuild') {
        args.push('--rebuild');
    }

    return {
        params: effective,
        paramsPath,
        file: builder,
        args,
        outDir,
        buildId: createBuildId(effective, request)
    };
}
