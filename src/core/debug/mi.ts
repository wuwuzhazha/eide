import { spawn } from 'child_process';
import type { ProcessOptions } from '../adapters';

export type MiValue = string | number | MiValue[] | MiTuple;

export interface MiTuple {
    [key: string]: MiValue;
}

export interface MiPromptRecord {
    type: 'prompt';
}

export interface MiResultRecord {
    type: 'result';
    token?: number;
    class: string;
    results: MiTuple;
}

export interface MiAsyncRecord {
    type: 'async';
    token?: number;
    kind: '*' | '=' | '+';
    class: string;
    results: MiTuple;
}

export interface MiStreamRecord {
    type: 'stream';
    kind: '~' | '@' | '&';
    text: string;
}

export type MiRecord = MiPromptRecord | MiResultRecord | MiAsyncRecord | MiStreamRecord;

export class MiParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MiParseError';
    }
}

export class MiRecordParser {
    private buffered = '';

    feed(chunk: string): MiRecord[] {
        this.buffered += chunk;
        const records: MiRecord[] = [];
        let newline = this.buffered.indexOf('\n');
        while (newline >= 0) {
            let line = this.buffered.slice(0, newline);
            this.buffered = this.buffered.slice(newline + 1);
            if (line.endsWith('\r')) {
                line = line.slice(0, -1);
            }
            const record = parseMiLine(line);
            if (record !== undefined) {
                records.push(record);
            }
            newline = this.buffered.indexOf('\n');
        }
        return records;
    }
}

function parseMiLine(line: string): MiRecord | undefined {
    const trimmed = line.trim();
    if (trimmed === '') {
        return undefined;
    }
    if (trimmed === '(gdb)') {
        return { type: 'prompt' };
    }

    let cursor = 0;
    let token: number | undefined;
    const tokenMatch = /^\d+/.exec(line);
    if (tokenMatch !== null) {
        token = Number(tokenMatch[0]);
        if (!Number.isSafeInteger(token)) {
            throw new MiParseError(`token is not a safe integer: ${tokenMatch[0]}`);
        }
        cursor = tokenMatch[0].length;
    }

    const kind = line[cursor];
    if (kind === '~' || kind === '@' || kind === '&') {
        if (token !== undefined) {
            throw new MiParseError('stream record cannot carry a token');
        }
        const stream = parseCString(line, cursor + 1);
        const end = skipSpaces(line, stream.next);
        if (end !== line.length) {
            throw new MiParseError(`unexpected data after stream record: ${line.slice(end)}`);
        }
        return { type: 'stream', kind, text: stream.value };
    }

    if (kind === '^') {
        const body = parseRecordBody(line, cursor + 1);
        return { type: 'result', token, class: body.class, results: body.results };
    }

    if (kind === '*' || kind === '=' || kind === '+') {
        const body = parseRecordBody(line, cursor + 1);
        return { type: 'async', token, kind, class: body.class, results: body.results };
    }

    throw new MiParseError(`unknown MI record: ${line}`);
}

function parseRecordBody(line: string, index: number): { class: string; results: MiTuple } {
    const classMatch = /^[A-Za-z][A-Za-z0-9_.-]*/.exec(line.slice(index));
    if (classMatch === null) {
        throw new MiParseError(`missing MI record class: ${line}`);
    }
    let cursor = index + classMatch[0].length;
    cursor = skipSpaces(line, cursor);
    let results: MiTuple = {};
    if (line[cursor] === ',') {
        const parsed = parseResults(line, cursor + 1);
        results = parsed.value;
        cursor = parsed.next;
    }
    cursor = skipSpaces(line, cursor);
    if (cursor !== line.length) {
        throw new MiParseError(`unexpected data after MI record: ${line.slice(cursor)}`);
    }
    return { class: classMatch[0], results };
}

function parseResults(text: string, index: number): { value: MiTuple; next: number } {
    const value: MiTuple = {};
    let cursor = skipSpaces(text, index);
    for (;;) {
        const entry = parseKeyValue(text, cursor);
        if (Object.prototype.hasOwnProperty.call(value, entry.key)) {
            throw new MiParseError(`duplicate MI result field: ${entry.key}`);
        }
        value[entry.key] = entry.value;
        cursor = skipSpaces(text, entry.next);
        if (cursor >= text.length) {
            return { value, next: cursor };
        }
        if (text[cursor] !== ',') {
            throw new MiParseError(`expected ',' between MI results: ${text.slice(cursor)}`);
        }
        cursor = skipSpaces(text, cursor + 1);
        if (cursor >= text.length) {
            throw new MiParseError('trailing comma in MI results');
        }
    }
}

function parseTuple(text: string, index: number): { value: MiTuple; next: number } {
    const value: MiTuple = {};
    let cursor = skipSpaces(text, index + 1);
    if (text[cursor] === '}') {
        return { value, next: cursor + 1 };
    }
    for (;;) {
        const entry = parseKeyValue(text, cursor);
        if (Object.prototype.hasOwnProperty.call(value, entry.key)) {
            throw new MiParseError(`duplicate MI tuple field: ${entry.key}`);
        }
        value[entry.key] = entry.value;
        cursor = skipSpaces(text, entry.next);
        if (text[cursor] === '}') {
            return { value, next: cursor + 1 };
        }
        if (text[cursor] !== ',') {
            throw new MiParseError(`expected ',' between MI tuple fields: ${text.slice(cursor)}`);
        }
        cursor = skipSpaces(text, cursor + 1);
        if (text[cursor] === '}') {
            throw new MiParseError('trailing comma in MI tuple');
        }
    }
}

function parseList(text: string, index: number): { value: MiValue[]; next: number } {
    const value: MiValue[] = [];
    let cursor = skipSpaces(text, index + 1);
    if (text[cursor] === ']') {
        return { value, next: cursor + 1 };
    }
    for (;;) {
        const named = parseNamedEntry(text, cursor);
        if (named !== undefined) {
            value.push({ [named.key]: named.value });
            cursor = named.next;
        } else {
            const parsed = parseValue(text, cursor);
            value.push(parsed.value);
            cursor = parsed.next;
        }
        cursor = skipSpaces(text, cursor);
        if (text[cursor] === ']') {
            return { value, next: cursor + 1 };
        }
        if (text[cursor] !== ',') {
            throw new MiParseError(`expected ',' between MI list values: ${text.slice(cursor)}`);
        }
        cursor = skipSpaces(text, cursor + 1);
        if (text[cursor] === ']') {
            throw new MiParseError('trailing comma in MI list');
        }
    }
}

function parseNamedEntry(
    text: string,
    index: number,
): { key: string; value: MiValue; next: number } | undefined {
    const named = /^[A-Za-z_][A-Za-z0-9_.-]*\s*=/.exec(text.slice(index));
    if (named === null) {
        return undefined;
    }
    return parseKeyValue(text, index);
}

function parseKeyValue(
    text: string,
    index: number,
): { key: string; value: MiValue; next: number } {
    const cursor = skipSpaces(text, index);
    const keyMatch = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(text.slice(cursor));
    if (keyMatch === null) {
        throw new MiParseError(`missing MI result name: ${text.slice(cursor)}`);
    }
    let next = skipSpaces(text, cursor + keyMatch[0].length);
    if (text[next] !== '=') {
        throw new MiParseError(`expected '=' after MI result name: ${keyMatch[0]}`);
    }
    const parsed = parseValue(text, next + 1);
    return { key: keyMatch[0], value: parsed.value, next: parsed.next };
}

function parseValue(text: string, index: number): { value: MiValue; next: number } {
    const cursor = skipSpaces(text, index);
    const kind = text[cursor];
    if (kind === '"') {
        return parseCString(text, cursor);
    }
    if (kind === '{') {
        return parseTuple(text, cursor);
    }
    if (kind === '[') {
        return parseList(text, cursor);
    }
    return parseIntegerValue(text, cursor);
}

function parseIntegerValue(text: string, index: number): { value: number; next: number } {
    let cursor = index;
    while (cursor < text.length && text[cursor] !== ',' && text[cursor] !== '}' && text[cursor] !== ']') {
        cursor++;
    }
    const raw = text.slice(index, cursor).trim();
    if (!/^-?\d+$/.test(raw)) {
        throw new MiParseError(`invalid MI value: ${raw}`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) {
        throw new MiParseError(`MI integer is not a safe integer: ${raw}`);
    }
    return { value, next: cursor };
}

function parseCString(text: string, index: number): { value: string; next: number } {
    if (text[index] !== '"') {
        throw new MiParseError(`expected MI string: ${text.slice(index)}`);
    }
    const parts: Buffer[] = [];
    let literal = '';
    const pushByte = (byte: number): void => {
        if (literal !== '') {
            parts.push(Buffer.from(literal, 'utf8'));
            literal = '';
        }
        parts.push(Buffer.from([byte]));
    };
    let cursor = index + 1;
    while (cursor < text.length) {
        const ch = text[cursor++];
        if (ch === '"') {
            if (literal !== '') {
                parts.push(Buffer.from(literal, 'utf8'));
            }
            return { value: Buffer.concat(parts).toString('utf8'), next: cursor };
        }
        if (ch !== '\\') {
            literal += ch;
            continue;
        }
        if (cursor >= text.length) {
            throw new MiParseError('unterminated MI string escape');
        }
        const escape = text[cursor++];
        switch (escape) {
            case 'a':
                literal += '\u0007';
                break;
            case 'b':
                literal += '\b';
                break;
            case 'e':
                literal += '\u001b';
                break;
            case 'f':
                literal += '\f';
                break;
            case 'n':
                literal += '\n';
                break;
            case 'r':
                literal += '\r';
                break;
            case 't':
                literal += '\t';
                break;
            case 'v':
                literal += '\v';
                break;
            case '"':
                literal += '"';
                break;
            case '\'':
                literal += '\'';
                break;
            case '?':
                literal += '?';
                break;
            case '\\':
                literal += '\\';
                break;
            case 'x': {
                let digits = '';
                while (digits.length < 2 && cursor < text.length && /[0-9a-fA-F]/.test(text[cursor])) {
                    digits += text[cursor++];
                }
                if (digits.length === 0) {
                    throw new MiParseError('invalid hexadecimal MI string escape');
                }
                pushByte(parseInt(digits, 16));
                break;
            }
            default: {
                if (escape < '0' || escape > '7') {
                    throw new MiParseError(`unsupported MI string escape: \\${escape}`);
                }
                let digits = escape;
                while (digits.length < 3 && cursor < text.length && text[cursor] >= '0' && text[cursor] <= '7') {
                    digits += text[cursor++];
                }
                const byte = parseInt(digits, 8);
                if (byte > 0xff) {
                    throw new MiParseError(`MI octal escape is not a byte: \\${digits}`);
                }
                pushByte(byte);
            }
        }
    }
    throw new MiParseError('unterminated MI string');
}

function skipSpaces(text: string, index: number): number {
    let cursor = index;
    while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t')) {
        cursor++;
    }
    return cursor;
}

export interface MiChildProcess {
    write(data: string): void;
    onStdout(listener: (chunk: string) => void): void;
    onStderr(listener: (chunk: string) => void): void;
    onExit(listener: (code: number | null, signal: string | null) => void): void;
    onError(listener: (error: Error) => void): void;
    kill(): void;
}

export type MiSpawn = (
    file: string,
    args: string[],
    options: Pick<ProcessOptions, 'cwd' | 'env'>,
) => MiChildProcess;

export type MiErrorCode = 'timeout' | 'exited' | 'protocol' | 'target' | 'state';

export class MiError extends Error {
    constructor(readonly code: MiErrorCode, message: string) {
        super(message);
        this.name = 'MiError';
    }
}

export type MiRemoteMode = 'remote' | 'extended-remote';

export type MiStopEvent = MiAsyncRecord & { class: 'stopped' };

export interface MiBreakpointOptions {
    hardware?: boolean;
    condition?: string;
}

export interface MiBreakpoint {
    id: number;
    address?: number;
    functionName?: string;
    file?: string;
    line?: number;
}

export interface MiSessionOptions {
    gdbPath?: string;
    gdbArgs?: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    commandTimeoutMs?: number;
    stopTimeoutMs?: number;
    spawn?: MiSpawn;
    onRecord?: (record: MiRecord) => void;
}

export type MiAddress = number | bigint;

const DEFAULT_GDB_PATH = 'arm-none-eabi-gdb';
const DEFAULT_GDB_ARGS = ['--interpreter=mi2', '--quiet', '--nx'];
const DEFAULT_COMMAND_TIMEOUT_MS = 10000;
const DEFAULT_STOP_TIMEOUT_MS = 30000;
const STDERR_TAIL_LIMIT = 4096;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

interface PendingCommand {
    command: string;
    expectedClasses: string[];
    resolve: (record: MiResultRecord) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

interface StopWaiter {
    resolve: (event: MiStopEvent) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

export class MiSession {
    private readonly gdbPath: string;
    private readonly gdbArgs: string[];
    private readonly cwd?: string;
    private readonly env?: NodeJS.ProcessEnv;
    private readonly commandTimeoutMs: number;
    private readonly stopTimeoutMs: number;
    private readonly spawnProcess: MiSpawn;
    private readonly onRecord?: (record: MiRecord) => void;

    private readonly parser = new MiRecordParser();
    private readonly pendingCommands = new Map<number, PendingCommand>();
    private readonly stopQueue: MiStopEvent[] = [];
    private readonly stopWaiters: StopWaiter[] = [];

    private process?: MiChildProcess;
    private started = false;
    private closed = false;
    private targetConnected = false;
    private promptSeen = false;
    private promptWaiter?: { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
    private nextToken = 1;
    private commandQueue: Promise<void> = Promise.resolve();
    private exitInfo?: { code: number | null; signal: string | null };
    private exitPromise?: Promise<void>;
    private resolveExit?: () => void;
    private stderrTail = '';

    constructor(options: MiSessionOptions = {}) {
        this.gdbPath = options.gdbPath ?? DEFAULT_GDB_PATH;
        this.gdbArgs = (options.gdbArgs ?? DEFAULT_GDB_ARGS).slice();
        this.cwd = options.cwd;
        this.env = options.env;
        this.commandTimeoutMs = resolveTimeout(options.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS, 'commandTimeoutMs');
        this.stopTimeoutMs = resolveTimeout(options.stopTimeoutMs, DEFAULT_STOP_TIMEOUT_MS, 'stopTimeoutMs');
        this.spawnProcess = options.spawn ?? spawnGdb;
        this.onRecord = options.onRecord;
    }

    async connect(target: string, mode: MiRemoteMode = 'extended-remote'): Promise<void> {
        if (this.started) {
            throw new MiError('state', 'GDB session has already been started');
        }
        if (target.trim() === '' || /\s/.test(target)) {
            throw new MiError('state', 'target must be a non-empty address without whitespace');
        }
        if (mode !== 'remote' && mode !== 'extended-remote') {
            throw new MiError('state', `unsupported remote mode: ${String(mode)}`);
        }
        this.started = true;
        try {
            await this.start();
            await this.runCommand(`-target-select ${mode} ${target}`, ['connected']);
            this.targetConnected = true;
        } catch (error) {
            this.closed = true;
            this.process?.kill();
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        if (!this.started || this.closed) {
            return;
        }
        let firstError: Error | undefined;
        if (this.targetConnected) {
            try {
                await this.runCommand('-target-disconnect', ['done']);
            } catch (error) {
                firstError = asError(error);
            }
            this.targetConnected = false;
        }
        if (this.exitInfo === undefined) {
            try {
                await this.runCommand('-gdb-exit', ['exit']);
            } catch (error) {
                if (!(error instanceof MiError && error.code === 'exited')) {
                    firstError = firstError ?? asError(error);
                }
            }
        }
        if (this.exitInfo === undefined) {
            try {
                await this.waitForProcessExit();
            } catch (error) {
                firstError = firstError ?? asError(error);
            }
        }
        this.closed = true;
        if (firstError !== undefined) {
            throw firstError;
        }
    }

    async readRegister(name: string): Promise<number> {
        if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) {
            throw new MiError('state', `invalid register name: ${name}`);
        }
        const record = await this.runCommand(
            `-data-evaluate-expression ${encodeMiArgument(`$${name}`)}`,
            ['done'],
        );
        const raw = record.results.value;
        if (typeof raw !== 'string') {
            throw new MiError('protocol', `register $${name} response has no string value`);
        }
        const value = parseTargetValue(raw);
        if (value === undefined) {
            throw new MiError('target', `register $${name} is not numeric: ${raw}`);
        }
        return value;
    }

    async readMemory(address: MiAddress, length: number): Promise<Buffer> {
        if (!Number.isSafeInteger(length) || length <= 0) {
            throw new MiError('state', 'memory length must be a positive integer');
        }
        const record = await this.runCommand(
            `-data-read-memory-bytes ${formatMiAddress(address)} ${length}`,
            ['done'],
        );
        const blocks = record.results.memory;
        if (!Array.isArray(blocks)) {
            throw new MiError('protocol', 'read memory response has no memory list');
        }
        let contents = '';
        let byteCount = 0;
        for (const block of blocks) {
            if (block === null || typeof block !== 'object' || Array.isArray(block)) {
                throw new MiError('protocol', 'read memory response contains an invalid block');
            }
            const offsetRaw = block.offset;
            const blockContents = block.contents;
            if (typeof offsetRaw !== 'string' || typeof blockContents !== 'string') {
                throw new MiError('protocol', 'read memory block is missing offset or contents');
            }
            const offset = parseTargetValue(offsetRaw);
            if (offset === undefined) {
                throw new MiError('protocol', `invalid memory block offset: ${offsetRaw}`);
            }
            if (offset !== byteCount) {
                throw new MiError(
                    'target',
                    `memory block offset ${offset} does not follow ${byteCount} contiguous bytes`,
                );
            }
            if (!/^[0-9a-f]*$/i.test(blockContents) || blockContents.length % 2 !== 0) {
                throw new MiError('protocol', `invalid memory block contents: ${blockContents}`);
            }
            contents += blockContents;
            byteCount += blockContents.length / 2;
        }
        const buffer = Buffer.from(contents, 'hex');
        if (buffer.length !== length) {
            throw new MiError('target', `read ${buffer.length} bytes but requested ${length}`);
        }
        return buffer;
    }

    async writeMemory(address: MiAddress, data: Buffer): Promise<void> {
        if (data.length === 0) {
            throw new MiError('state', 'memory data must not be empty');
        }
        await this.runCommand(
            `-data-write-memory-bytes ${formatMiAddress(address)} ${data.toString('hex')}`,
            ['done'],
        );
    }

    async insertBreakpoint(location: string, options: MiBreakpointOptions = {}): Promise<MiBreakpoint> {
        if (location.trim() === '') {
            throw new MiError('state', 'breakpoint location must not be empty');
        }
        let command = '-break-insert';
        if (options.hardware === true) {
            command += ' -h';
        }
        if (options.condition !== undefined) {
            if (options.condition.trim() === '') {
                throw new MiError('state', 'breakpoint condition must not be empty');
            }
            command += ` -c ${encodeMiArgument(options.condition)}`;
        }
        command += ` ${encodeMiArgument(location)}`;
        const record = await this.runCommand(command, ['done']);
        const bkpt = record.results.bkpt;
        if (bkpt === null || typeof bkpt !== 'object' || Array.isArray(bkpt)) {
            throw new MiError('protocol', 'breakpoint response has no breakpoint tuple');
        }
        const numberRaw = bkpt.number;
        if (typeof numberRaw !== 'string') {
            throw new MiError('protocol', 'breakpoint response has no breakpoint number');
        }
        const breakpoint: MiBreakpoint = { id: parseDecimalInteger(numberRaw, 'breakpoint number') };
        const addressRaw = bkpt.addr;
        if (typeof addressRaw === 'string' && addressRaw !== '<PENDING>') {
            const address = parseTargetValue(addressRaw);
            if (address === undefined) {
                throw new MiError('protocol', `invalid breakpoint address: ${addressRaw}`);
            }
            breakpoint.address = address;
        }
        if (typeof bkpt.func === 'string') {
            breakpoint.functionName = bkpt.func;
        }
        if (typeof bkpt.file === 'string') {
            breakpoint.file = bkpt.file;
        }
        if (typeof bkpt.line === 'string') {
            breakpoint.line = parseDecimalInteger(bkpt.line, 'breakpoint line');
        }
        return breakpoint;
    }

    async removeBreakpoint(id: number): Promise<void> {
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new MiError('state', 'breakpoint id must be a positive integer');
        }
        await this.runCommand(`-break-delete ${id}`, ['done']);
    }

    async continue(): Promise<void> {
        await this.runCommand('-exec-continue', ['running', 'done']);
    }

    async interrupt(): Promise<void> {
        await this.runCommand('-exec-interrupt', ['done']);
    }

    waitForStop(timeoutMs: number = this.stopTimeoutMs): Promise<MiStopEvent> {
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
            return Promise.reject(new MiError('state', 'stop timeout must be a positive integer'));
        }
        const queued = this.stopQueue.shift();
        if (queued !== undefined) {
            return Promise.resolve(queued);
        }
        if (this.closed || this.exitInfo !== undefined) {
            return Promise.reject(new MiError('exited', 'GDB session is closed before the target stopped'));
        }
        return new Promise<MiStopEvent>((resolve, reject) => {
            const timer = setTimeout(() => {
                const index = this.stopWaiters.findIndex(waiter => waiter.timer === timer);
                if (index >= 0) {
                    this.stopWaiters.splice(index, 1);
                }
                reject(
                    new MiError(
                        'timeout',
                        `timed out after ${timeoutMs} ms waiting for target stop${this.stderrSuffix()}`,
                    ),
                );
            }, timeoutMs);
            this.stopWaiters.push({ resolve, reject, timer });
        });
    }

    async evaluate(expression: string): Promise<string> {
        if (expression.trim() === '') {
            throw new MiError('state', 'expression must not be empty');
        }
        const record = await this.runCommand(
            `-data-evaluate-expression ${encodeMiArgument(expression)}`,
            ['done'],
        );
        const value = record.results.value;
        if (typeof value !== 'string') {
            throw new MiError('protocol', 'evaluate response has no string value');
        }
        return value;
    }

    private async start(): Promise<void> {
        const child = this.createProcess();
        this.process = child;
        child.onStdout(chunk => this.handleStdout(chunk));
        child.onStderr(chunk => this.handleStderr(chunk));
        child.onExit((code, signal) => this.handleExit(code, signal));
        child.onError(error => this.handleProcessError(error));
        this.exitPromise = new Promise<void>(resolve => {
            this.resolveExit = resolve;
        });
        await this.waitForPrompt();
        await this.runCommand('-gdb-set mi-async on', ['done']);
        await this.runCommand('-gdb-set confirm off', ['done']);
    }

    private createProcess(): MiChildProcess {
        try {
            return this.spawnProcess(this.gdbPath, this.gdbArgs.slice(), { cwd: this.cwd, env: this.env });
        } catch (error) {
            throw new MiError('exited', `failed to start ${this.gdbPath}: ${asError(error).message}`);
        }
    }

    private waitForPrompt(): Promise<void> {
        if (this.promptSeen) {
            return Promise.resolve();
        }
        if (this.closed || this.exitInfo !== undefined) {
            return Promise.reject(new MiError('exited', 'GDB exited before the initial prompt'));
        }
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.promptWaiter !== undefined) {
                    this.promptWaiter = undefined;
                    reject(
                        new MiError(
                            'timeout',
                            `timed out after ${this.commandTimeoutMs} ms waiting for GDB prompt${this.stderrSuffix()}`,
                        ),
                    );
                }
            }, this.commandTimeoutMs);
            this.promptWaiter = {
                resolve: () => {
                    clearTimeout(timer);
                    resolve();
                },
                reject: error => {
                    clearTimeout(timer);
                    reject(error);
                },
                timer,
            };
        });
    }

    private runCommand(command: string, expectedClasses: string[]): Promise<MiResultRecord> {
        const execute = (): Promise<MiResultRecord> => this.sendCommand(command, expectedClasses);
        const result = this.commandQueue.then(execute, execute);
        this.commandQueue = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    private sendCommand(command: string, expectedClasses: string[]): Promise<MiResultRecord> {
        if (this.closed || this.exitInfo !== undefined) {
            return Promise.reject(new MiError('exited', `GDB session is closed: ${command}`));
        }
        if (this.process === undefined) {
            return Promise.reject(new MiError('state', `GDB process is not started: ${command}`));
        }
        const token = this.nextToken++;
        return new Promise<MiResultRecord>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (!this.pendingCommands.delete(token)) {
                    return;
                }
                reject(
                    new MiError(
                        'timeout',
                        `GDB command timed out after ${this.commandTimeoutMs} ms: ${command}${this.stderrSuffix()}`,
                    ),
                );
            }, this.commandTimeoutMs);
            this.pendingCommands.set(token, { command, expectedClasses, resolve, reject, timer });
            try {
                this.process!.write(`${token}${command}\n`);
            } catch (error) {
                this.pendingCommands.delete(token);
                clearTimeout(timer);
                reject(new MiError('exited', `failed to write GDB command: ${asError(error).message}`));
            }
        });
    }

    private handleStdout(chunk: string): void {
        if (this.closed) {
            return;
        }
        let records: MiRecord[];
        try {
            records = this.parser.feed(chunk);
        } catch (error) {
            this.failProtocol(error);
            return;
        }
        for (const record of records) {
            this.handleRecord(record);
        }
    }

    private handleRecord(record: MiRecord): void {
        switch (record.type) {
            case 'prompt': {
                this.promptSeen = true;
                const waiter = this.promptWaiter;
                this.promptWaiter = undefined;
                waiter?.resolve();
                break;
            }
            case 'result':
                if (record.token !== undefined) {
                    this.resolveCommand(record);
                }
                break;
            case 'async':
                if (record.class === 'stopped') {
                    this.publishStop(record as MiStopEvent);
                }
                break;
            case 'stream':
                break;
        }
        this.onRecord?.(record);
    }

    private resolveCommand(record: MiResultRecord): void {
        if (record.token === undefined) {
            return;
        }
        const pending = this.pendingCommands.get(record.token);
        if (pending === undefined) {
            return;
        }
        this.pendingCommands.delete(record.token);
        clearTimeout(pending.timer);
        if (record.class === 'error') {
            const message = record.results.msg;
            if (typeof message !== 'string') {
                pending.reject(new MiError('protocol', `${pending.command} failed without an error message`));
                return;
            }
            pending.reject(new MiError('target', `${pending.command} failed: ${message}`));
            return;
        }
        if (!pending.expectedClasses.includes(record.class)) {
            pending.reject(
                new MiError('protocol', `${pending.command} returned unexpected result class ^${record.class}`),
            );
            return;
        }
        pending.resolve(record);
    }

    private publishStop(record: MiStopEvent): void {
        const waiter = this.stopWaiters.shift();
        if (waiter !== undefined) {
            clearTimeout(waiter.timer);
            waiter.resolve(record);
            return;
        }
        this.stopQueue.push(record);
    }

    private handleStderr(chunk: string): void {
        this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_LIMIT);
    }

    private handleExit(code: number | null, signal: string | null): void {
        this.exitInfo = { code, signal };
        this.closed = true;
        this.targetConnected = false;
        const resolveExit = this.resolveExit;
        this.resolveExit = undefined;
        resolveExit?.();
        this.rejectAll(
            new MiError(
                'exited',
                `GDB exited${code !== null ? ` with code ${code}` : ''}${signal !== null ? ` from signal ${signal}` : ''}`,
            ),
        );
    }

    private handleProcessError(error: Error): void {
        const failure = new MiError('exited', `GDB process error: ${error.message}`);
        if (this.exitInfo === undefined) {
            this.exitInfo = { code: null, signal: null };
            const resolveExit = this.resolveExit;
            this.resolveExit = undefined;
            resolveExit?.();
        }
        this.closed = true;
        this.rejectAll(failure);
        this.process?.kill();
    }

    private failProtocol(error: unknown): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.rejectAll(new MiError('protocol', `GDB/MI protocol error: ${asError(error).message}`));
        this.process?.kill();
    }

    private rejectAll(error: Error): void {
        for (const pending of this.pendingCommands.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pendingCommands.clear();
        const prompt = this.promptWaiter;
        this.promptWaiter = undefined;
        prompt?.reject(error);
        while (this.stopWaiters.length > 0) {
            const waiter = this.stopWaiters.shift()!;
            clearTimeout(waiter.timer);
            waiter.reject(error);
        }
    }

    private async waitForProcessExit(): Promise<void> {
        if (this.exitInfo !== undefined || this.exitPromise === undefined) {
            return;
        }
        try {
            await withTimeout(this.exitPromise, this.commandTimeoutMs, 'GDB did not exit');
        } catch (error) {
            this.process?.kill();
            await withTimeout(this.exitPromise, this.commandTimeoutMs, 'GDB did not exit after being killed');
        }
    }

    private stderrSuffix(): string {
        const tail = this.stderrTail.trim();
        return tail === '' ? '' : ` (gdb stderr: ${tail})`;
    }
}

function spawnGdb(
    file: string,
    args: string[],
    options: Pick<ProcessOptions, 'cwd' | 'env'>,
): MiChildProcess {
    const child = spawn(file, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    return {
        write: data => {
            child.stdin.write(data);
        },
        onStdout: listener => {
            child.stdout.on('data', listener);
        },
        onStderr: listener => {
            child.stderr.on('data', listener);
        },
        onExit: listener => {
            child.on('exit', listener);
        },
        onError: listener => {
            child.on('error', listener);
        },
        kill: () => {
            child.kill();
        },
    };
}

function resolveTimeout(value: number | undefined, fallback: number, name: string): number {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved <= 0) {
        throw new MiError('state', `${name} must be a positive integer`);
    }
    return resolved;
}

function encodeMiArgument(text: string): string {
    let encoded = '';
    for (const ch of text) {
        switch (ch) {
            case '\\':
                encoded += '\\\\';
                break;
            case '"':
                encoded += '\\"';
                break;
            case '\n':
                encoded += '\\n';
                break;
            case '\r':
                encoded += '\\r';
                break;
            case '\t':
                encoded += '\\t';
                break;
            default: {
                const code = ch.charCodeAt(0);
                encoded += code < 0x20 || code === 0x7f ? `\\${code.toString(8).padStart(3, '0')}` : ch;
            }
        }
    }
    return `"${encoded}"`;
}

function formatMiAddress(address: MiAddress): string {
    if (typeof address === 'number') {
        if (!Number.isSafeInteger(address) || address < 0) {
            throw new MiError('state', `invalid address: ${String(address)}`);
        }
        return `0x${address.toString(16)}`;
    }
    if (address < BigInt(0)) {
        throw new MiError('state', `invalid address: ${String(address)}`);
    }
    return `0x${address.toString(16)}`;
}

function parseTargetValue(text: string): number | undefined {
    const match = /^(0x[0-9a-f]+|-?\d+)(?=\s|$)/i.exec(text);
    if (match === null) {
        return undefined;
    }
    const value = BigInt(match[1]);
    if (value > MAX_SAFE_BIGINT || value < MIN_SAFE_BIGINT) {
        throw new MiError('protocol', `value is not a safe integer: ${text}`);
    }
    return Number(value);
}

function parseDecimalInteger(text: string, context: string): number {
    if (!/^\d+$/.test(text)) {
        throw new MiError('protocol', `${context} is not a decimal integer: ${text}`);
    }
    const value = Number(text);
    if (!Number.isSafeInteger(value)) {
        throw new MiError('protocol', `${context} is not a safe integer: ${text}`);
    }
    return value;
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new MiError('timeout', message)), timeoutMs);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}
