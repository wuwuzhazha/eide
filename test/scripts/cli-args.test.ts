const {
    parseCliArgs,
    CliUsageError,
    cliHelp
} = require('../../../src/cli/args') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

function expectUsageError(argv: string[], msg: string): void {
    try {
        parseCliArgs(argv);
    } catch (error) {
        assert(error instanceof CliUsageError, msg);
        return;
    }
    assert(false, msg);
}

const parsed = parseCliArgs([
    'build',
    '-p', 'E:/demo',
    '-t', 'Debug',
    '--workspace', 'demo.code-workspace',
    '--mode', 'incremental',
    '--dry-run',
    '-D', 'A=1',
    '--define', 'B=2',
    '--include', 'inc',
    '--lib', 'lib',
    '--cflag', '-O2',
    '--cflag', '-g',
    '--cxxflag', '-std=c++17',
    '--asmflag', '-g',
    '--ldflag', '-Wl,--gc-sections',
    '--resources', 'E:/eide/res',
    '--toolchain-path', 'D:/gcc',
    '--timeout', '90000',
    '--threads', '8'
]);
assert(parsed.kind === 'run', 'args: returns run command');
assert(parsed.options.command === 'build', 'args: command');
assert(parsed.options.projectPath === 'E:/demo', 'args: project path');
assert(parsed.options.target === 'Debug', 'args: target');
assert(parsed.options.workspaceFile === 'demo.code-workspace', 'args: workspace file');
assert(parsed.options.mode === 'incremental', 'args: mode');
assert(parsed.options.timeoutMs === 90000, 'args: timeout');
assert(parsed.options.threads === 8, 'args: threads');
assert(parsed.options.dryRun === true, 'args: dry run');
assert(parsed.options.overrides.defines.join('|') === 'A=1|B=2', 'args: defines');
assert(parsed.options.overrides.includeDirs.join('|') === 'inc', 'args: include dirs');
assert(parsed.options.overrides.libDirs.join('|') === 'lib', 'args: lib dirs');
assert(parsed.options.overrides.cFlags === '-O2 -g', 'args: cflags concatenated');
assert(parsed.options.overrides.cxxFlags === '-std=c++17', 'args: cxxflags');
assert(parsed.options.overrides.asmFlags === '-g', 'args: asmflags');
assert(parsed.options.overrides.ldFlags === '-Wl,--gc-sections', 'args: ldflags');
assert(parsed.options.resourcesDir === 'E:/eide/res', 'args: resources dir');
assert(parsed.options.toolchainPath === 'D:/gcc', 'args: toolchain path');

const rebuild = parseCliArgs(['rebuild', '--project', 'E:/demo']);
assert(rebuild.options.mode === 'rebuild', 'args: rebuild command sets mode');
assert(rebuild.options.dryRun === false, 'args: rebuild is not dry run');
assert(rebuild.options.timeoutMs === 1800000, 'args: default timeout');

const plan = parseCliArgs(['plan', '--project', 'E:/demo']);
assert(plan.options.dryRun === true, 'args: plan defaults to dry run');

const clean = parseCliArgs(['clean', '--project', 'E:/demo']);
assert(clean.options.command === 'clean', 'args: clean command');

const flash = parseCliArgs(['flash', '--project', 'E:/demo', '--flasher-exe', 'E:/JLink.exe',
    '--verify', '--artifact', 'fw.bin,0x08000000']);
assert(flash.options.command === 'flash', 'args: flash command');
assert(flash.options.flasherExecutable === 'E:/JLink.exe', 'args: flasher executable');
assert(flash.options.verify === true, 'args: flash verify');
assert(flash.options.artifact === 'fw.bin,0x08000000', 'args: flash artifact');
assert(flash.options.timeoutMs === 120000, 'args: flash default timeout');

const erase = parseCliArgs(['flash', '--project', 'E:/demo', '--erase-all']);
assert(erase.options.eraseAll === true, 'args: erase all');

const noVerify = parseCliArgs(['flash', '--project', 'E:/demo', '--no-verify']);
assert(noVerify.options.verify === false, 'args: no verify');

const help = parseCliArgs(['--help']);
assert(help.kind === 'help', 'args: help command');
assert(cliHelp.includes('--project'), 'args: help text mentions project');

expectUsageError([], 'args: empty argv is rejected');
expectUsageError(['build'], 'args: missing project is rejected');
expectUsageError(['build', '--project'], 'args: missing value is rejected');
expectUsageError(['build', '--project', 'E:/demo', '--mode', 'fast'],
    'args: invalid mode is rejected');
expectUsageError(['build', '--project', 'E:/demo', '--timeout', '0'],
    'args: invalid timeout is rejected');
expectUsageError(['build', '--project', 'E:/demo', '--unknown'],
    'args: unknown option is rejected');
expectUsageError(['unknown', '--project', 'E:/demo'], 'args: unknown command is rejected');
expectUsageError(['build', '--project', 'E:/demo', '--erase-all'],
    'args: flash options require flash command');
expectUsageError(['flash', '--project', 'E:/demo', '-D', 'A=1'],
    'args: build overrides are rejected for flash');
expectUsageError(['flash', '--project', 'E:/demo', '--mode', 'rebuild'],
    'args: mode is rejected for flash');
expectUsageError(['flash', '--project', 'E:/demo', '--verify', '--no-verify'],
    'args: conflicting verify flags are rejected');
expectUsageError(['flash', '--project', 'E:/demo', '--erase-all', '--artifact', 'fw.hex'],
    'args: erase all cannot use an artifact');
expectUsageError(['flash', '--project', 'E:/demo', '--threads', '8'],
    'args: threads are rejected for flash');
expectUsageError(['build', '--project', 'E:/demo', '--threads', '0'],
    'args: invalid thread count is rejected');

console.log('All CLI args tests passed.');
export {};
