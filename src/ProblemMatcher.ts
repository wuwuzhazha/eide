
import * as vscode from 'vscode';
import { ProjectBaseApi } from './EIDETypeDefine';
import { File } from '../lib/node-utility/File';
import {
    BuildProblemSeverity,
    ParsedProblem,
    parseArmccProblems,
    parseCosmicStm8Problems,
    parseGccProblems,
    parseIarProblems,
    parseKeilc51Problems,
    parseSdccProblems
} from './core/problems';

//////////////////////////////////////////////////////////////////////

export enum EideDiagnosticCode {
    GCC_SYS_STUB_MISSED = 10,
};

export type CompilerDiagnostics = { [path: string]: vscode.Diagnostic[]; }

function toVscSeverity(severity: BuildProblemSeverity): vscode.DiagnosticSeverity {
    switch (severity) {
        case 'error':
            return vscode.DiagnosticSeverity.Error;
        case 'warning':
            return vscode.DiagnosticSeverity.Warning;
        case 'hint':
            return vscode.DiagnosticSeverity.Hint;
        case 'info':
            return vscode.DiagnosticSeverity.Information;
    }
}

function newVscRange(problem: ParsedProblem): vscode.Range {
    const line = problem.line > 0 ? (problem.line - 1) : 0;
    const start = problem.column > 0 ? (problem.column - 1) : 0;
    const len = problem.rangeLength < 0 ? 0 : problem.rangeLength;
    return new vscode.Range(
        new vscode.Position(line, start),
        new vscode.Position(line, start + len));
}

function toCompilerDiagnostics(projApi: ProjectBaseApi, problems: ParsedProblem[]): CompilerDiagnostics {
    const result: CompilerDiagnostics = {};
    for (const problem of problems) {
        const fspath = projApi.toAbsolutePath(problem.file);
        let diags = result[fspath];
        if (diags === undefined) {
            diags = [];
            result[fspath] = diags;
        }
        const diag = new vscode.Diagnostic(
            newVscRange(problem), problem.message, toVscSeverity(problem.severity));
        diag.code = problem.code;
        diag.source = problem.source;
        diags.push(diag);
    }
    return result;
}

function readCompilerLog(logFile: File): string | undefined {
    try {
        return logFile.Read();
    } catch {
        return undefined;
    }
}

function parseCompilerLogWith(
    projApi: ProjectBaseApi, logFile: File,
    parse: (logText: string) => ParsedProblem[]): CompilerDiagnostics {
    const logText = readCompilerLog(logFile);
    if (logText === undefined) {
        return {};
    }
    return toCompilerDiagnostics(projApi, parse(logText));
}

export function parseCompilerLog(
    toolchain: string, projApi: ProjectBaseApi, logFile: File): CompilerDiagnostics {
    switch (toolchain) {
        case 'IAR_ARM':
        case 'IAR_STM8':
            return parseIarCompilerLog(projApi, logFile);
        case 'Keil_C51':
            return parseKeilc51CompilerLog(projApi, logFile);
        case 'AC5':
            return parseArmccCompilerLog(projApi, logFile);
        case 'SDCC':
        case 'GNU_SDCC_MCS51':
            return parseSdccCompilerLog(projApi, logFile);
        case 'COSMIC_STM8':
            return parseCosmicStm8CompilerLog(projApi, logFile);
        default:
            return parseGccCompilerLog(projApi, logFile);
    }
}

export function parseArmccCompilerLog(projApi: ProjectBaseApi, logFile: File): CompilerDiagnostics {
    return parseCompilerLogWith(projApi, logFile, parseArmccProblems);
}

export function parseSdccCompilerLog(projApi: ProjectBaseApi, logfile: File): CompilerDiagnostics {
    return parseCompilerLogWith(projApi, logfile, parseSdccProblems);
}

export function parseGccCompilerLog(projApi: ProjectBaseApi, logfile: File): CompilerDiagnostics {
    return parseCompilerLogWith(
        projApi, logfile, logText => parseGccProblems(logText, projApi.toolchainName()));
}

export function parseKeilc51CompilerLog(projApi: ProjectBaseApi, logfile: File): CompilerDiagnostics {
    return parseCompilerLogWith(projApi, logfile, parseKeilc51Problems);
}

export function parseIarCompilerLog(projApi: ProjectBaseApi, logfile: File): CompilerDiagnostics {
    return parseCompilerLogWith(
        projApi, logfile, logText => parseIarProblems(logText, projApi.toolchainName()));
}

export function parseCosmicStm8CompilerLog(projApi: ProjectBaseApi, logfile: File): CompilerDiagnostics {
    return parseCompilerLogWith(projApi, logfile, parseCosmicStm8Problems);
}
