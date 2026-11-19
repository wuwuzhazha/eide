import { BuilderParamsData } from './build_plan';
import { BuildRequest, BuildResult } from './types';

export interface BuildPlan {
    params: BuilderParamsData;
    paramsPath: string;
    file: string;
    args: string[];
    outDir: string;
    buildId: string;
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
