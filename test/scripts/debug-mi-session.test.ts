import {
    MiChildProcess,
    MiError,
    MiSession,
    MiSessionOptions,
    MiSpawn,
    MiStopEvent,
} from '../../src/core/debug/mi';

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
    console.log('OK:', message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
    assert(actual === expected, `${message} (expected ${String(expected)}, got ${String(actual)})`);
}

function assertWritten(fake: FakeGdb, expected: string[], message: string): void {
    assertEqual(fake.written.join(''), expected.join(''), message);
}

async function captureReject(promise: Promise<unknown>, message: string): Promise<MiError> {
    try {
        await promise;
    } catch (error) {
        assert(error instanceof MiError, `${message}: rejection is MiError`);
        return error as MiError;
    }
    throw new Error(`${message}: expected rejection`);
}

class FakeGdb implements MiChildProcess {
    readonly written: string[] = [];
    killCount = 0;
    onCommand?: (line: string) => void;

    private exited = false;
    private readonly stdoutListeners: Array<(chunk: string) => void> = [];
    private readonly stderrListeners: Array<(chunk: string) => void> = [];
    private readonly exitListeners: Array<(code: number | null, signal: string | null) => void> = [];
    private readonly errorListeners: Array<(error: Error) => void> = [];

    write(data: string): void {
        if (this.exited) {
            throw new Error('GDB stdin is closed');
        }
        this.written.push(data);
        this.onCommand?.(data);
    }

    onStdout(listener: (chunk: string) => void): void {
        this.stdoutListeners.push(listener);
    }

    onStderr(listener: (chunk: string) => void): void {
        this.stderrListeners.push(listener);
    }

    onExit(listener: (code: number | null, signal: string | null) => void): void {
        this.exitListeners.push(listener);
    }

    onError(listener: (error: Error) => void): void {
        this.errorListeners.push(listener);
    }

    kill(): void {
        this.killCount++;
        queueMicrotask(() => this.emitExit(null, 'SIGKILL'));
    }

    emitStdout(chunk: string): void {
        for (const listener of this.stdoutListeners) {
            listener(chunk);
        }
    }

    emitStderr(chunk: string): void {
        for (const listener of this.stderrListeners) {
            listener(chunk);
        }
    }

    emitExit(code: number | null, signal: string | null = null): void {
        if (this.exited) {
            return;
        }
        this.exited = true;
        for (const listener of this.exitListeners) {
            listener(code, signal);
        }
    }

    emitError(error: Error): void {
        for (const listener of this.errorListeners) {
            listener(error);
        }
    }
}

type Responder = (command: string, token: number, fake: FakeGdb) => string | string[] | undefined;

function standardResponse(command: string, token: number): string | undefined {
    switch (command) {
        case '-gdb-set mi-async on':
        case '-gdb-set confirm off':
            return `${token}^done\n(gdb) \n`;
        case '-target-disconnect':
            return `${token}^done\n(gdb) \n`;
        case '-gdb-exit':
            return `${token}^exit\n`;
        default:
            return command.startsWith('-target-select ')
                ? `${token}^connected\n(gdb) \n`
                : undefined;
    }
}

function createHarness(
    responder: Responder,
    options: Partial<MiSessionOptions> = {},
    startupPrompt = true,
): { fake: FakeGdb; session: MiSession } {
    const fake = new FakeGdb();
    const spawn: MiSpawn = () => {
        if (startupPrompt) {
            queueMicrotask(() => fake.emitStdout('=thread-group-added,id="i1"\n(gdb) \n'));
        }
        return fake;
    };
    const session = new MiSession({
        commandTimeoutMs: 200,
        stopTimeoutMs: 200,
        spawn,
        ...options,
    });
    fake.onCommand = line => {
        const match = /^(\d+)(.*)\n$/.exec(line);
        if (match === null) {
            throw new Error(`unexpected GDB input: ${line}`);
        }
        const response = responder(match[2], Number(match[1]), fake);
        if (response !== undefined) {
            const chunks = Array.isArray(response) ? response : [response];
            queueMicrotask(() => {
                for (const chunk of chunks) {
                    fake.emitStdout(chunk);
                }
                if (match[2] === '-gdb-exit') {
                    setImmediate(() => fake.emitExit(0));
                }
            });
        }
    };
    return { fake, session };
}

async function testConnectAndDisconnect(): Promise<void> {
    const { fake, session } = createHarness(standardResponse);
    await session.connect('localhost:3333');
    assertWritten(
        fake,
        [
            '1-gdb-set mi-async on\n',
            '2-gdb-set confirm off\n',
            '3-target-select extended-remote localhost:3333\n',
        ],
        'extended-remote connect command sequence',
    );
    await session.disconnect();
    assertWritten(
        fake,
        [
            '1-gdb-set mi-async on\n',
            '2-gdb-set confirm off\n',
            '3-target-select extended-remote localhost:3333\n',
            '4-target-disconnect\n',
            '5-gdb-exit\n',
        ],
        'disconnect command sequence',
    );
    await session.disconnect();
    assertEqual(fake.written.length, 5, 'second disconnect is a no-op');

    const remote = createHarness(standardResponse);
    await remote.session.connect('localhost:3334', 'remote');
    assertEqual(
        remote.fake.written[2],
        '3-target-select remote localhost:3334\n',
        'remote mode command',
    );
    await remote.session.disconnect();
}

async function testConnectErrors(): Promise<void> {
    const targetError = createHarness((command, token) => {
        if (command.startsWith('-target-select ')) {
            return `${token}^error,msg="localhost:1: Connection timed out."\n`;
        }
        return standardResponse(command, token);
    });
    const targetFailure = await captureReject(
        targetError.session.connect('localhost:1'),
        'target connect failure',
    );
    assertEqual(targetFailure.code, 'target', 'target connect error code');
    assert(targetFailure.message.includes('Connection timed out'), 'target connect error message');
    assertEqual(targetError.fake.killCount, 1, 'failed connect kills GDB');

    const started = Date.now();
    const promptError = createHarness(() => undefined, { commandTimeoutMs: 30 }, false);
    const promptFailure = await captureReject(
        promptError.session.connect('localhost:1'),
        'startup prompt timeout',
    );
    assertEqual(promptFailure.code, 'timeout', 'startup prompt timeout code');
    assert(Date.now() - started < 1000, 'startup prompt timeout is bounded');
    assertEqual(promptError.fake.killCount, 1, 'startup timeout kills GDB');

    const stderrHarness = createHarness(() => undefined, { commandTimeoutMs: 30 }, false);
    const stderrConnect = stderrHarness.session.connect('localhost:1');
    stderrHarness.fake.emitStderr('cannot open device');
    const stderrFailure = await captureReject(stderrConnect, 'startup prompt timeout with stderr');
    assert(stderrFailure.message.includes('cannot open device'), 'startup timeout includes stderr');
}

async function testRegisterAndMemory(): Promise<void> {
    const register = createHarness((command, token) => {
        if (command.startsWith('-data-evaluate-expression ')) {
            return `${token}^done,value="0xE000ED28 <SCB+0>"\n`;
        }
        return standardResponse(command, token);
    });
    await register.session.connect('localhost:3333');
    const cfsr = await register.session.readRegister('cfsr');
    assertEqual(cfsr, 0xE000ED28, 'register value');
    assertEqual(
        register.fake.written[3],
        '4-data-evaluate-expression "$cfsr"\n',
        'register read command',
    );
    await register.session.disconnect();

    const voidRegister = createHarness((command, token) => {
        if (command.startsWith('-data-evaluate-expression ')) {
            return `${token}^done,value="void"\n`;
        }
        return standardResponse(command, token);
    });
    await voidRegister.session.connect('localhost:3333');
    const voidFailure = await captureReject(
        voidRegister.session.readRegister('missing'),
        'non-numeric register',
    );
    assertEqual(voidFailure.code, 'target', 'non-numeric register code');
    await voidRegister.session.disconnect();

    const memory = createHarness((command, token) => {
        if (command.startsWith('-data-read-memory-bytes ')) {
            return `${token}^done,memory=[{begin="0x20000000",offset="0x0",end="0x20000004",contents="DEADBEEF"}]\n`;
        }
        if (command.startsWith('-data-write-memory-bytes ')) {
            return `${token}^done\n`;
        }
        return standardResponse(command, token);
    });
    await memory.session.connect('localhost:3333');
    const bytes = await memory.session.readMemory(0x20000000, 4);
    assertEqual(bytes.toString('hex'), 'deadbeef', 'read memory bytes');
    assertEqual(
        memory.fake.written[3],
        '4-data-read-memory-bytes 0x20000000 4\n',
        'read memory command',
    );
    await memory.session.writeMemory(0x20000000, Buffer.from([1, 2, 3, 4]));
    assertEqual(
        memory.fake.written[4],
        '5-data-write-memory-bytes 0x20000000 01020304\n',
        'write memory command',
    );
    await memory.session.disconnect();

    const gap = createHarness((command, token) => {
        if (command.startsWith('-data-read-memory-bytes ')) {
            return `${token}^done,memory=[{begin="0x20000000",offset="0x0",end="0x20000002",contents="0102"},{begin="0x20000004",offset="0x4",end="0x20000006",contents="0304"}]\n`;
        }
        return standardResponse(command, token);
    });
    await gap.session.connect('localhost:3333');
    const gapFailure = await captureReject(gap.session.readMemory(0x20000000, 6), 'memory gap');
    assertEqual(gapFailure.code, 'target', 'memory gap code');
    await gap.session.disconnect();
}

async function testBreakpointsAndEvaluation(): Promise<void> {
    const harness = createHarness((command, token) => {
        if (command.startsWith('-break-insert ')) {
            return `${token}^done,bkpt={number="7",type="breakpoint",addr="0x08000100",func="tick",file="main.c",line="42"}\n`;
        }
        if (command === '-break-delete 7') {
            return `${token}^done\n`;
        }
        if (command.startsWith('-data-evaluate-expression ')) {
            return `${token}^done,value="9"\n`;
        }
        return standardResponse(command, token);
    });
    await harness.session.connect('localhost:3333');
    const breakpoint = await harness.session.insertBreakpoint('tick', {
        hardware: true,
        condition: 'x > 1',
    });
    assertEqual(
        harness.fake.written[3],
        '4-break-insert -h -c "x > 1" "tick"\n',
        'breakpoint insert command',
    );
    assertEqual(breakpoint.id, 7, 'breakpoint id');
    assertEqual(breakpoint.address, 0x08000100, 'breakpoint address');
    assertEqual(breakpoint.functionName, 'tick', 'breakpoint function');
    assertEqual(breakpoint.file, 'main.c', 'breakpoint file');
    assertEqual(breakpoint.line, 42, 'breakpoint line');
    await harness.session.removeBreakpoint(7);
    assertEqual(harness.fake.written[4], '5-break-delete 7\n', 'breakpoint delete command');
    const value = await harness.session.evaluate('sizeof(int) + 5');
    assertEqual(value, '9', 'evaluate value');
    assertEqual(
        harness.fake.written[5],
        '6-data-evaluate-expression "sizeof(int) + 5"\n',
        'evaluate command',
    );
    await harness.session.disconnect();
}

async function testStopsAndInterrupt(): Promise<void> {
    const harness = createHarness((command, token) => {
        if (command === '-exec-continue') {
            return `${token}^running\n*running,thread-id="all"\n*stopped,reason="breakpoint-hit",bkptno="1",frame={addr="0x08000100",func="main",line="42"},thread-id="1"\n`;
        }
        if (command === '-exec-interrupt') {
            return `${token}^done\n*stopped,reason="signal-received",signal-name="SIGINT",thread-id="1"\n`;
        }
        return standardResponse(command, token);
    });
    await harness.session.connect('localhost:3333');
    await harness.session.continue();
    const breakpointStop: MiStopEvent = await harness.session.waitForStop(100);
    assertEqual(breakpointStop.class, 'stopped', 'stop class');
    assertEqual(breakpointStop.results.reason, 'breakpoint-hit', 'stop reason');
    const frame = breakpointStop.results.frame;
    assert(frame !== null && typeof frame === 'object' && !Array.isArray(frame), 'stop frame');
    assertEqual((frame as { func: string }).func, 'main', 'stop frame function');

    await harness.session.interrupt();
    const interruptStop = await harness.session.waitForStop(100);
    assertEqual(interruptStop.results.reason, 'signal-received', 'interrupt stop reason');
    assertEqual(interruptStop.results['signal-name'], 'SIGINT', 'interrupt signal name');
    await harness.session.disconnect();

    const noStop = createHarness((command, token) => {
        if (command === '-exec-continue') {
            return `${token}^running\n`;
        }
        return standardResponse(command, token);
    });
    await noStop.session.connect('localhost:3333');
    await noStop.session.continue();
    const started = Date.now();
    const stopTimeout = await captureReject(noStop.session.waitForStop(30), 'waitForStop timeout');
    assertEqual(stopTimeout.code, 'timeout', 'waitForStop timeout code');
    assert(Date.now() - started < 1000, 'waitForStop timeout is bounded');
    await noStop.session.disconnect();

    const exitWhileWaiting = createHarness((command, token, fake) => {
        if (command === '-exec-continue') {
            setTimeout(() => fake.emitExit(1), 10);
            return `${token}^running\n`;
        }
        return standardResponse(command, token);
    });
    await exitWhileWaiting.session.connect('localhost:3333');
    await exitWhileWaiting.session.continue();
    const exitWaitFailure = await captureReject(
        exitWhileWaiting.session.waitForStop(1000),
        'process exit while waiting for stop',
    );
    assertEqual(exitWaitFailure.code, 'exited', 'process exit rejects stop wait');
}

async function testCommandFailureModes(): Promise<void> {
    const exitDuringCommand = createHarness((command, token, fake) => {
        if (command.startsWith('-data-evaluate-expression ')) {
            fake.emitExit(3);
            return undefined;
        }
        return standardResponse(command, token);
    });
    await exitDuringCommand.session.connect('localhost:3333');
    const exitFailure = await captureReject(
        exitDuringCommand.session.evaluate('1'),
        'process exit during command',
    );
    assertEqual(exitFailure.code, 'exited', 'process exit error code');

    let evaluations = 0;
    const timeoutRecovery = createHarness((command, token, fake) => {
        if (command.startsWith('-data-evaluate-expression ')) {
            evaluations++;
            if (evaluations === 1) {
                setTimeout(() => fake.emitStdout(`${token}^done,value="late"\n`), 80);
                return undefined;
            }
            return `${token}^done,value="2"\n`;
        }
        return standardResponse(command, token);
    }, { commandTimeoutMs: 30 });
    await timeoutRecovery.session.connect('localhost:3333');
    const timeoutFailure = await captureReject(
        timeoutRecovery.session.evaluate('first'),
        'command timeout',
    );
    assertEqual(timeoutFailure.code, 'timeout', 'command timeout code');
    const recovered = await timeoutRecovery.session.evaluate('second');
    assertEqual(recovered, '2', 'command after timeout succeeds');
    await timeoutRecovery.session.disconnect();

    const protocolHarness = createHarness((command, token) => {
        if (command.startsWith('-data-evaluate-expression ')) {
            return 'garbage\n';
        }
        return standardResponse(command, token);
    });
    await protocolHarness.session.connect('localhost:3333');
    const protocolFailure = await captureReject(
        protocolHarness.session.evaluate('1'),
        'protocol failure',
    );
    assertEqual(protocolFailure.code, 'protocol', 'protocol failure code');
    assertEqual(protocolHarness.fake.killCount, 1, 'protocol failure kills GDB');

    const stderrHarness = createHarness((command, token, fake) => {
        if (command.startsWith('-data-evaluate-expression ')) {
            fake.emitStderr('target not responding');
            return undefined;
        }
        return standardResponse(command, token);
    }, { commandTimeoutMs: 30 });
    await stderrHarness.session.connect('localhost:3333');
    const stderrFailure = await captureReject(
        stderrHarness.session.evaluate('1'),
        'command timeout with stderr',
    );
    assert(stderrFailure.message.includes('target not responding'), 'command timeout includes stderr');
}

async function run(): Promise<void> {
    await testConnectAndDisconnect();
    await testConnectErrors();
    await testRegisterAndMemory();
    await testBreakpointsAndEvaluation();
    await testStopsAndInterrupt();
    await testCommandFailureModes();
    console.log('debug-mi-session tests passed');
}

run().catch(error => {
    console.error('FAIL:', error);
    process.exit(1);
});
