import * as micromatch from 'micromatch';
import { BuildOverrides } from './types';

export interface OverridableBuilderParams {
    sourceList: string[];
    incDirs: string[];
    libDirs: string[];
    defines: string[];
    options: { [key: string]: any };
    env?: { [key: string]: any };
}

function isPlainObject(value: unknown): value is { [key: string]: any } {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function mergeOptions<T>(base: T, patch: unknown): T {
    if (!isPlainObject(base) || !isPlainObject(patch)) {
        return clone(patch) as T;
    }
    const result: { [key: string]: any } = { ...base };
    for (const key of Object.keys(patch)) {
        const value = patch[key];
        if (isPlainObject(value) && isPlainObject(result[key])) {
            result[key] = mergeOptions(result[key], value);
        } else if (value === undefined) {
            result[key] = undefined;
        } else {
            result[key] = clone(value);
        }
    }
    return result as T;
}

function appendUnique(target: string[], values: string[] | undefined): string[] {
    if (!values || values.length === 0) {
        return target;
    }
    const result = target.slice();
    for (const value of values) {
        if (!result.includes(value)) {
            result.push(value);
        }
    }
    return result;
}

function ensureObject(parent: { [key: string]: any }, key: string): { [key: string]: any } {
    if (!isPlainObject(parent[key])) {
        parent[key] = {};
    }
    return parent[key];
}

function appendFlag(options: { [key: string]: any }, path: string[], flag: string | undefined): void {
    if (flag === undefined || flag.trim().length === 0) {
        return;
    }
    let current = options;
    for (let i = 0; i < path.length - 1; i++) {
        current = ensureObject(current, path[i]);
    }
    const key = path[path.length - 1];
    const existing = typeof current[key] === 'string' ? current[key].trim() : '';
    current[key] = existing.length > 0 ? `${existing} ${flag.trim()}` : flag.trim();
}

function normalizePattern(pattern: string): string {
    return pattern.replace(/\\/g, '/');
}

function filterSources(sourceList: string[], source: BuildOverrides['source']): string[] {
    if (!source) {
        return sourceList;
    }
    let result = sourceList;
    if (source.include && source.include.length > 0) {
        const patterns = source.include.map(normalizePattern);
        result = result.filter(path => micromatch.isMatch(normalizePattern(path), patterns));
    }
    if (source.exclude && source.exclude.length > 0) {
        const patterns = source.exclude.map(normalizePattern);
        result = result.filter(path => !micromatch.isMatch(normalizePattern(path), patterns));
    }
    return result;
}

export function applyBuildOverrides<T extends OverridableBuilderParams>(
    params: T, overrides: BuildOverrides | undefined): T {
    if (!overrides) {
        return clone(params);
    }
    const result = clone(params);
    result.defines = appendUnique(result.defines, overrides.defines);
    result.incDirs = appendUnique(result.incDirs, overrides.includeDirs);
    result.libDirs = appendUnique(result.libDirs, overrides.libDirs);
    result.sourceList = filterSources(result.sourceList, overrides.source);
    if (overrides.options) {
        result.options = mergeOptions(result.options, overrides.options);
    }
    appendFlag(result.options, ['c/cpp-compiler', 'C_FLAGS'], overrides.cFlags);
    appendFlag(result.options, ['c/cpp-compiler', 'CXX_FLAGS'], overrides.cxxFlags);
    appendFlag(result.options, ['asm-compiler', 'ASM_FLAGS'], overrides.asmFlags);
    appendFlag(result.options, ['linker', 'LD_FLAGS'], overrides.ldFlags);
    if (overrides.env) {
        result.env = { ...(result.env || {}), ...overrides.env };
    }
    return result;
}

function validateStringArray(value: unknown, name: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim().length === 0)) {
        return `'${name}' must be an array of non-empty strings.`;
    }
    return undefined;
}

function validateFlags(value: unknown, name: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string') {
        return `'${name}' must be a string.`;
    }
    return undefined;
}

export function validateBuildOverrides(overrides: unknown): string | undefined {
    if (overrides === undefined) {
        return undefined;
    }
    if (!isPlainObject(overrides)) {
        return `'overrides' must be an object.`;
    }
    const checks = [
        validateStringArray(overrides.defines, 'defines'),
        validateStringArray(overrides.includeDirs, 'includeDirs'),
        validateStringArray(overrides.libDirs, 'libDirs'),
        validateFlags(overrides.cFlags, 'cFlags'),
        validateFlags(overrides.cxxFlags, 'cxxFlags'),
        validateFlags(overrides.asmFlags, 'asmFlags'),
        validateFlags(overrides.ldFlags, 'ldFlags')
    ];
    for (const error of checks) {
        if (error) {
            return error;
        }
    }
    if (overrides.options !== undefined && !isPlainObject(overrides.options)) {
        return `'options' must be an object.`;
    }
    if (overrides.source !== undefined) {
        if (!isPlainObject(overrides.source)) {
            return `'source' must be an object.`;
        }
        const sourceError = validateStringArray(overrides.source.include, 'source.include')
            || validateStringArray(overrides.source.exclude, 'source.exclude');
        if (sourceError) {
            return sourceError;
        }
    }
    if (overrides.env !== undefined) {
        if (!isPlainObject(overrides.env) ||
            Object.values(overrides.env).some(value => typeof value !== 'string')) {
            return `'env' must be an object with string values.`;
        }
    }
    return undefined;
}
