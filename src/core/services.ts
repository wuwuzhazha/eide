import { BuildRequest, BuildResult } from './types';

export interface BuildPlan {
    params: unknown;
    file: string;
    args: string[];
}

export interface CleanResult {
    success: boolean;
    message?: string;
}

export interface BuildService {
    plan(request: BuildRequest): Promise<BuildPlan>;
    build(request: BuildRequest): Promise<BuildResult>;
    clean(request: BuildRequest): Promise<CleanResult>;
}
