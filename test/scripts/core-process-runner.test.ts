const { NodeProcessRunner, ProcessTimeoutError } = require('../../../src/core/process_runner') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

async function main(): Promise<void> {
    const runner = new NodeProcessRunner();

    const ok = await runner.run(process.execPath, [
        '-e',
        'console.log("out-line"); console.error("err-line"); process.exit(3);'
    ]);
    assert(ok.code === 3, 'process: exit code is preserved');
    assert(ok.stdout.includes('out-line'), 'process: captures stdout');
    assert(ok.stderr.includes('err-line'), 'process: captures stderr');

    const tempDir = require('os').tmpdir();
    const cwdResult = await runner.run(process.execPath, [
        '-e',
        'console.log(process.cwd()); console.log(process.env.EIDE_TEST_ENV);'
    ], {
        cwd: tempDir,
        env: { ...process.env, EIDE_TEST_ENV: 'env-value' }
    });
    assert(cwdResult.stdout.toLowerCase().includes(tempDir.toLowerCase()),
        'process: applies cwd');
    assert(cwdResult.stdout.includes('env-value'), 'process: applies env');

    let timedOut = false;
    try {
        await runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 5000);'], {
            timeoutMs: 150
        });
    } catch (error) {
        timedOut = error instanceof ProcessTimeoutError;
    }
    assert(timedOut, 'process: timeout rejects with ProcessTimeoutError');

    let invalidTimeout = false;
    try {
        await runner.run(process.execPath, ['-e', 'console.log("x")'], { timeoutMs: 0 });
    } catch {
        invalidTimeout = true;
    }
    assert(invalidTimeout, 'process: invalid timeout is rejected');

    console.log('All process runner tests passed.');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});

export {};
