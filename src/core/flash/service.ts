import * as fs from 'fs';
import * as os from 'os';
import * as NodePath from 'path';

import type { ProcessOptions, ProcessResult, ProcessRunner } from '../adapters';
import {
    FlashBuildError,
    FLASH_COMMAND_FILE_PLACEHOLDER,
    buildFlashCommand,
    getFlashCapabilities,
    listFlashTools
} from './builders';
import type {
    FlashCapabilities,
    FlashCommand,
    FlashReadbackRequest,
    FlashRequest,
    FlashResult,
    FlashService,
    FlashTool,
    FlashUploaderName
} from './types';

export const DEFAULT_FLASH_TIMEOUT_MS = 120000;

const FAILURE_MARKERS =
    /\bError\b\s*[:!]|\bFailed to \w+|\bCannot connect|\bCould not connect|\bNo (?:probe|target|emulator|device)\b|\*\* (?:Programming|Verify) Failed \*\*|Verification\.\.\.KO/i;

const VERIFICATION_FAILURE_MARKERS =
    /Verification\.\.\.KO|\*\* Verify Failed \*\*|Verification (?:failed|error)|verify(?:ing|ication)?\s+failed|Failed to verify/i;

interface PreparedCommand {
    args: string[];
    cleanup(): Promise<void>;
}

type RunOutcome =
    | { kind: 'result'; result: ProcessResult }
    | { kind: 'timeout' }
    | { kind: 'error'; error: unknown };

function notSupported(reason: string): FlashResult {
    return { success: false, code: 'not_supported', stdout: '', stderr: '', reason };
}

function invalidRequest(reason: string): FlashResult {
    return { success: false, code: 'invalid_request', stdout: '', stderr: '', reason };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function firstMatchingLine(text: string, pattern: RegExp): string | undefined {
    for (const line of text.split(/\r?\n/)) {
        if (pattern.test(line)) {
            return line.trim();
        }
    }
    return undefined;
}

async function prepareCommand(command: FlashCommand): Promise<PreparedCommand> {
    if (!command.script) {
        return { args: command.args, cleanup: async () => undefined };
    }

    const dir = await fs.promises.mkdtemp(NodePath.join(os.tmpdir(), 'eide-flash-'));
    const file = NodePath.join(dir, `commands${command.script.extension}`);
    await fs.promises.writeFile(file, command.script.contents);

    return {
        args: command.args.map((arg) => arg === FLASH_COMMAND_FILE_PLACEHOLDER ? file : arg),
        cleanup: async () => {
            await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
    };
}

async function runBounded(
    runner: ProcessRunner,
    command: FlashCommand,
    args: string[],
    options: ProcessOptions,
    timeoutMs: number
): Promise<RunOutcome> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<RunOutcome>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    });

    const execution = Promise.resolve()
        .then(() => runner.run(command.executable, args, options))
        .then((result): RunOutcome => ({ kind: 'result', result }))
        .catch((error): RunOutcome => ({ kind: 'error', error }));

    try {
        return await Promise.race([execution, timeout]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

function processFailure(
    command: FlashCommand,
    stdout: string,
    stderr: string,
    reason: string,
    code: FlashResult['code']
): FlashResult {
    return {
        success: false,
        code,
        stdout,
        stderr,
        verified: command.verify ? false : undefined,
        reason
    };
}

function resultFromOutcome(
    command: FlashCommand,
    outcome: RunOutcome,
    timeoutMs: number
): FlashResult {
    if (outcome.kind === 'timeout') {
        return processFailure(
            command, '', '',
            `flash command timed out after ${timeoutMs} ms`,
            'timeout'
        );
    }

    if (outcome.kind === 'error') {
        return processFailure(
            command, '', '',
            `failed to run flash command: ${errorMessage(outcome.error)}`,
            'failed'
        );
    }

    const { code, stdout, stderr } = outcome.result;

    if (code === null) {
        return processFailure(
            command, stdout, stderr,
            'flash command ended without an exit code',
            'timeout'
        );
    }

    const output = [stdout, stderr].filter((part) => part.length > 0).join('\n');

    const verificationFailure = command.verify
        ? firstMatchingLine(output, VERIFICATION_FAILURE_MARKERS)
        : undefined;
    if (verificationFailure) {
        return processFailure(
            command, stdout, stderr,
            `verification failed: ${verificationFailure}`,
            'failed'
        );
    }

    const failure = firstMatchingLine(output, FAILURE_MARKERS);
    if (code !== 0) {
        return processFailure(
            command, stdout, stderr,
            failure ?? `flash command exited with code ${code}`,
            'failed'
        );
    }
    if (failure) {
        return processFailure(
            command, stdout, stderr,
            `flash tool reported failure: ${failure}`,
            'failed'
        );
    }

    return {
        success: true,
        code: 'ok',
        stdout,
        stderr,
        verified: command.verify ? true : undefined
    };
}

export class ProcessFlashService implements FlashService {

    constructor(private readonly runner: ProcessRunner) { }

    listTools(): FlashTool[] {
        return listFlashTools();
    }

    getCapabilities(uploader: FlashUploaderName): FlashCapabilities {
        return getFlashCapabilities(uploader);
    }

    async flash(request: FlashRequest): Promise<FlashResult> {

        const capabilities = this.getCapabilities(request.uploader);

        if (!capabilities.supported) {
            return notSupported(capabilities.reason ?? `uploader '${request.uploader}' is not supported`);
        }
        if (request.verify === true && capabilities.verify === 'unsupported') {
            return notSupported(`verification is not supported for '${request.uploader}'`);
        }
        if (request.eraseAll && !capabilities.eraseAll) {
            return notSupported(`eraseAll is not supported for '${request.uploader}'`);
        }
        if (request.eraseAll && request.verify === true) {
            return notSupported(`verify cannot be performed for eraseAll on '${request.uploader}'`);
        }

        let command: FlashCommand;
        try {
            command = buildFlashCommand(request);
        } catch (error) {
            if (error instanceof FlashBuildError) {
                return error.code === 'not_supported'
                    ? notSupported(error.message)
                    : invalidRequest(error.message);
            }
            return invalidRequest(errorMessage(error));
        }

        if (request.verify === true && !command.verify) {
            return notSupported(`verification is not supported for '${request.uploader}'`);
        }

        const timeoutMs = request.timeoutMs ?? DEFAULT_FLASH_TIMEOUT_MS;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            return invalidRequest('timeoutMs must be a positive number');
        }

        let prepared: PreparedCommand;
        try {
            prepared = await prepareCommand(command);
        } catch (error) {
            return processFailure(
                command, '', '',
                `failed to prepare flash command: ${errorMessage(error)}`,
                'failed'
            );
        }

        try {
            const outcome = await runBounded(
                this.runner,
                command,
                prepared.args,
                { cwd: request.cwd, env: request.env, timeoutMs },
                timeoutMs
            );
            return resultFromOutcome(command, outcome, timeoutMs);
        } finally {
            await prepared.cleanup();
        }
    }

    async readback(request: FlashReadbackRequest): Promise<FlashResult> {
        return notSupported(`readback is not supported for '${request.uploader}'`);
    }
}
