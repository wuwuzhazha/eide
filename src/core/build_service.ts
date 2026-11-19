import * as fs from 'fs';
import * as NodePath from 'path';
import { detectBuildStage, makeLogTail, parseMemoryUsage } from '../BuildReport';
import { Logger, ProcessRunner, ProcessResult } from './adapters';
import { BuildEnvironment, createBuildPlan, resolveOutputDir } from './build_plan';
import { collectArtifacts, writeBuildManifest } from './build_manifest';
import { BuildProblem, parseGccProblems } from './problems';
import { loadProjectSnapshot, ProjectSnapshot } from './project_snapshot';
import { BuildPlan, BuildService, CleanResult } from './services';
import { ProcessTimeoutError } from './process_runner';
import { BuildRequest, BuildResult, EffectiveBuildConfig } from './types';

export interface HeadlessBuildServiceOptions extends BuildEnvironment {
    runner: ProcessRunner;
    timeoutMs: number;
    logger?: Logger;
}

function readOptionalText(path: string): string | undefined {
    try {
        return fs.readFileSync(path, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

function optionString(options: { [key: string]: any }, path: string[]): string {
    let value: any = options;
    for (const key of path) {
        value = value?.[key];
    }
    return typeof value === 'string' ? value : '';
}

function toProblems(compilerLog: string | undefined): BuildProblem[] {
    if (compilerLog === undefined) {
        return [];
    }
    return parseGccProblems(compilerLog, 'GCC').map(problem => ({
        file: problem.file,
        line: problem.line,
        column: problem.column,
        severity: problem.severity,
        code: problem.code,
        message: problem.message
    }));
}

function effectiveConfig(params: BuildPlan['params'], outDir: string): EffectiveBuildConfig {
    return {
        target: params.target,
        toolchain: params.toolchain,
        outDir,
        defines: params.defines,
        includeDirs: params.incDirs,
        cFlags: optionString(params.options, ['c/cpp-compiler', 'C_FLAGS']),
        cxxFlags: optionString(params.options, ['c/cpp-compiler', 'CXX_FLAGS']),
        asmFlags: optionString(params.options, ['asm-compiler', 'ASM_FLAGS']),
        ldFlags: optionString(params.options, ['linker', 'LD_FLAGS'])
    };
}

export class HeadlessBuildService implements BuildService {
    constructor(private readonly options: HeadlessBuildServiceOptions) {
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
            throw new Error(`Invalid build timeout: ${options.timeoutMs}`);
        }
    }

    async plan(request: BuildRequest): Promise<BuildPlan> {
        const snapshot = this.loadSnapshot(request);
        return createBuildPlan(snapshot, request, this.options);
    }

    async build(request: BuildRequest): Promise<BuildResult> {
        const snapshot = this.loadSnapshot(request);
        const plan = await createBuildPlan(snapshot, request, this.options);
        this.options.logger?.info(`Build ${plan.buildId}: ${plan.file} ${plan.args.join(' ')}`);
        const compilerLogPath = NodePath.join(plan.outDir, 'compiler.log');
        fs.rmSync(compilerLogPath, { force: true });

        let processResult: ProcessResult;
        let analysisError: string | undefined;
        try {
            processResult = await this.options.runner.run(plan.file, plan.args, {
                cwd: snapshot.projectPath,
                timeoutMs: this.options.timeoutMs,
                env: process.env
            });
        } catch (error) {
            if (!(error instanceof ProcessTimeoutError)) {
                throw error;
            }
            processResult = { code: null, stdout: error.stdout, stderr: error.stderr };
            analysisError = error.message;
        }

        const compilerLog = readOptionalText(compilerLogPath);
        const processLog = [processResult.stdout, processResult.stderr]
            .filter(text => text.length > 0)
            .join('\n');
        const logText = compilerLog ?? processLog;
        const problems = toProblems(compilerLog);
        const success = processResult.code === 0 && !problems.some(p => p.severity === 'error');
        if (!success && analysisError === undefined && processResult.code === null) {
            analysisError = 'Builder process terminated by a signal.';
        }
        const stage = detectBuildStage(logText, success, problems);
        const artifacts = collectArtifacts(plan.outDir);

        writeBuildManifest(plan.outDir, {
            buildId: plan.buildId,
            createdAt: new Date().toISOString(),
            request,
            target: plan.params.target,
            toolchain: plan.params.toolchain,
            outDir: plan.outDir,
            defines: plan.params.defines,
            includeDirs: plan.params.incDirs,
            success,
            artifacts
        });

        return {
            success,
            buildId: plan.buildId,
            stage,
            problems,
            memory: parseMemoryUsage(logText),
            artifacts,
            effectiveConfig: effectiveConfig(plan.params, plan.outDir),
            logTail: success ? undefined : makeLogTail(logText),
            analysisError
        };
    }

    async clean(request: BuildRequest): Promise<CleanResult> {
        const snapshot = this.loadSnapshot(request);
        const outDir = resolveOutputDir(snapshot);
        const relative = NodePath.relative(snapshot.projectPath, outDir);
        if (relative.length === 0 || relative === '..' || relative.startsWith(`..${NodePath.sep}`)
            || NodePath.isAbsolute(relative)) {
            throw new Error(`Refusing to clean output directory outside project: ${outDir}`);
        }
        if (!fs.existsSync(outDir)) {
            return { success: true, message: 'Output directory does not exist.' };
        }
        fs.rmSync(outDir, { recursive: true, force: true });
        return { success: true, message: `Removed ${outDir}` };
    }

    private loadSnapshot(request: BuildRequest): ProjectSnapshot {
        if (request.profile !== undefined) {
            throw new Error('Named build profiles are not supported yet.');
        }
        return loadProjectSnapshot(request.projectPath, request.target);
    }
}
