import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as NodePath from 'path';
import { BuildStatistics, queryCallgraph, summarizeStackUsage } from '../BuildStatistics';
import { HeadlessBuildService } from '../core/build_service';
import { validateBuilderOptionsAgainstSchema } from '../core/builder_options';
import { validateBuildOverrides } from '../core/build_overrides';
import { createFlashPlan } from '../core/flash/plan';
import { ProcessFlashService } from '../core/flash/service';
import { Logger, ProcessRunner } from '../core/adapters';
import { loadProjectSnapshot } from '../core/project_snapshot';
import { BuildOverrides } from '../core/types';
import { HeadlessProject } from './headless_project';

export interface HeadlessToolOptions {
    projectPaths: string[];
    target?: string;
    resourcesDir: string;
    toolchainPath: string;
    schemaDir: string;
    flasherExecutable?: string;
    buildTimeoutMs: number;
    flashTimeoutMs: number;
    runner: ProcessRunner;
    logger?: Logger;
}

function makeTextResult(success: boolean, message: string): CallToolResult {
    return {
        isError: !success,
        content: [{ type: 'text', text: message }]
    };
}

function makeJsonResult(data: unknown, isError = false): CallToolResult {
    return {
        isError,
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function readPositiveInt(value: unknown, fallback: number, max: number, name: string): number {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
        throw new Error(`'${name}' must be an integer between 1 and ${max}.`);
    }
    return value;
}

function schemaForToolchain(toolchain: string): string {
    if (toolchain === 'GCC') {
        return 'arm.gcc.verify.json';
    }
    throw new Error(`Builder options are not available for toolchain '${toolchain}'.`);
}

function readBuildStatistics(project: HeadlessProject): BuildStatistics {
    const snapshot = project.getSnapshot();
    const file = NodePath.join(
        snapshot.projectPath, snapshot.outDir, snapshot.target, 'statistic.json');
    if (!fs.existsSync(file)) {
        throw new Error(
            `Build statistics not found: ${file}. ` +
            'Build the project with -fstack-usage or -fcallgraph-info first.');
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object'
        || !Array.isArray(data.callgraph) || !Array.isArray(data.stackusage)) {
        throw new Error(`Invalid build statistics: ${file}`);
    }
    return data as BuildStatistics;
}

class HeadlessToolRunner {
    private readonly projects = new Map<string, HeadlessProject>();

    constructor(private readonly options: HeadlessToolOptions) {
        for (const projectPath of options.projectPaths) {
            const absolute = NodePath.resolve(projectPath);
            this.projects.set(absolute, new HeadlessProject(absolute, options.target));
        }
    }

    resolveProject(uid: string | null | undefined): HeadlessProject {
        if (this.projects.size === 1) {
            return Array.from(this.projects.values())[0];
        }
        if (!uid) {
            throw new Error("Params 'uid' cannot be empty.");
        }
        for (const project of this.projects.values()) {
            if (project.getUid() === uid) {
                return project;
            }
        }
        throw new Error(`Not such project (uid=${uid}).`);
    }

    private buildService(project: HeadlessProject): HeadlessBuildService {
        return new HeadlessBuildService({
            resourcesDir: this.options.resourcesDir,
            toolchainPath: this.options.toolchainPath,
            runner: this.options.runner,
            timeoutMs: this.options.buildTimeoutMs,
            logger: this.options.logger
        });
    }

    async execute(tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
        const uid = args.uid as string | null | undefined;
        const project = this.resolveProject(uid);

        switch (tool) {
            case 'eide_build':
            case 'eide_rebuild': {
                const overrides = args.overrides as BuildOverrides | undefined;
                const overrideError = validateBuildOverrides(overrides);
                if (overrideError) {
                    return makeTextResult(false, `Invalid overrides: ${overrideError}`);
                }
                const request = {
                    projectPath: project.projectPath,
                    target: project.getTargetName(),
                    mode: tool === 'eide_rebuild' ? 'rebuild' as const : undefined,
                    overrides
                };
                const service = this.buildService(project);
                if (args.dryRun === true) {
                    const plan = await service.plan(request);
                    return makeJsonResult({
                        success: true,
                        dryRun: true,
                        buildId: plan.buildId,
                        outDir: plan.outDir,
                        builder: plan.file,
                        args: plan.args,
                        paramsFile: plan.paramsPath,
                        params: plan.params
                    });
                }
                const result = await service.build(request);
                return makeJsonResult(result, !result.success);
            }
            case 'eide_clean': {
                const service = this.buildService(project);
                const result = await service.clean({
                    projectPath: project.projectPath,
                    target: project.getTargetName()
                });
                return makeJsonResult(result, !result.success);
            }
            case 'eide_flash': {
                const snapshot = loadProjectSnapshot(
                    project.projectPath, project.getTargetName());
                const plan = createFlashPlan(snapshot, {
                    flasherExecutable: this.options.flasherExecutable,
                    timeoutMs: this.options.flashTimeoutMs,
                    eraseAll: args.eraseAll === true,
                    verify: args.verify === true ? true : undefined
                });
                const result = await new ProcessFlashService(this.options.runner).flash(plan.request);
                return makeJsonResult({ uploader: plan.uploader, ...result }, !result.success);
            }
            case 'eide_reload':
                return makeTextResult(true, 'Succeed.');
            case 'eide_get_targets':
                return makeJsonResult({
                    actived: project.getTargetName(),
                    targets: project.getTargetNames()
                });
            case 'eide_switch_target': {
                const targetName = typeof args.targetName === 'string' ? args.targetName : '';
                project.selectTarget(targetName);
                return makeTextResult(true, 'Succeed.');
            }
            case 'eide_get_src_dirs':
                return makeJsonResult(project.getSrcDirs());
            case 'eide_add_src_dir':
                project.addSrcDir(String(args.path));
                return makeTextResult(true, 'Succeed.');
            case 'eide_del_src_dir':
                project.removeSrcDir(String(args.path));
                return makeTextResult(true, 'Succeed.');
            case 'eide_exclude_src_file':
                project.excludeSourceFile(String(args.path));
                return makeTextResult(true, 'Succeed.');
            case 'eide_include_src_file':
                project.includeSourceFile(String(args.path));
                return makeTextResult(true, 'Succeed.');
            case 'eide_get_inc_dirs':
                return makeJsonResult(project.getIncludeDirs());
            case 'eide_set_inc_dirs': {
                const paths = args.paths;
                if (!Array.isArray(paths)) {
                    return makeTextResult(false, 'paths must be an array of strings.');
                }
                project.setIncludeDirs(paths as string[]);
                return makeTextResult(true, 'Succeed.');
            }
            case 'eide_get_defines':
                return makeJsonResult(project.getDefines());
            case 'eide_set_defines': {
                const defines = args.defines;
                if (!Array.isArray(defines)) {
                    return makeTextResult(false, 'defines must be an array of strings.');
                }
                project.setDefines(defines as string[]);
                return makeTextResult(true, 'Succeed.');
            }
            case 'eide_get_builder_opts_schema': {
                const file = NodePath.join(
                    this.options.schemaDir, schemaForToolchain(project.getToolchainName()));
                if (!fs.existsSync(file)) {
                    throw new Error(`Builder options schema not found: ${file}`);
                }
                return makeJsonResult(JSON.parse(fs.readFileSync(file, 'utf8')));
            }
            case 'eide_get_builder_opts':
                return makeJsonResult(project.getBuilderOptions());
            case 'eide_set_builder_opts': {
                const options = args.options;
                const schemaFile = NodePath.join(
                    this.options.schemaDir, schemaForToolchain(project.getToolchainName()));
                if (!fs.existsSync(schemaFile)) {
                    throw new Error(`Builder options schema not found: ${schemaFile}`);
                }
                const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
                const validation = validateBuilderOptionsAgainstSchema(schema, options);
                if (validation) {
                    return makeTextResult(false, `Builder options validation failed:\n${validation}`);
                }
                project.setBuilderOptions(options);
                return makeTextResult(true, 'Succeed.');
            }
            case 'eide_get_stack_usage': {
                const topN = readPositiveInt(args.topN, 20, 500, 'topN');
                const stats = readBuildStatistics(project);
                return makeJsonResult(summarizeStackUsage(stats.stackusage, topN));
            }
            case 'eide_query_callgraph': {
                const symbol = typeof args.symbol === 'string' ? args.symbol.trim() : '';
                if (symbol.length === 0) {
                    return makeTextResult(false, "Params 'symbol' cannot be empty.");
                }
                const depth = readPositiveInt(args.depth, 2, 6, 'depth');
                const stats = readBuildStatistics(project);
                return makeJsonResult(queryCallgraph(stats.callgraph, symbol, depth));
            }
            default:
                return makeTextResult(false, `Unknown tool: ${tool}`);
        }
    }
}

export function createHeadlessToolExecutor(
    options: HeadlessToolOptions
): (tool: string, args: Record<string, unknown>) => Promise<CallToolResult> {
    const runner = new HeadlessToolRunner(options);
    let queue: Promise<void> = Promise.resolve();
    return (tool, args) => {
        const execution = queue.then(async () => {
            try {
                return await runner.execute(tool, args);
            } catch (error) {
                return makeTextResult(false, errorMessage(error));
            }
        });
        queue = execution.then(() => undefined, () => undefined);
        return execution;
    };
}

export async function executeHeadlessTool(
    tool: string,
    args: Record<string, unknown>,
    options: HeadlessToolOptions
): Promise<CallToolResult> {
    return createHeadlessToolExecutor(options)(tool, args);
}
