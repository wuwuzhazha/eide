export interface ProcessResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

export interface ProcessOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
}

export interface ProcessRunner {
    run(file: string, args: string[], options?: ProcessOptions): Promise<ProcessResult>;
}

export interface Logger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string | Error): void;
}

export interface WorkspaceState {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): void | Promise<void>;
}

export interface ResourceLocator {
    appDataDir: string;
    builtInToolsDir: string;
    builderModelsDir: string;
    gccForceIncludeHeader: string;
}
