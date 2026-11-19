const {
    applyBuildOverrides,
    validateBuildOverrides
} = require('../../../src/core/build_overrides') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

function baseParams() {
    return {
        name: 'demo',
        target: 'Debug',
        toolchain: 'GCC',
        toolchainCfgFile: 'model.json',
        toolchainLocation: 'toolchain',
        buildMode: 'fast',
        dumpPath: 'build/Debug',
        outDir: 'build/Debug',
        rootDir: 'E:/demo',
        sourceList: ['src/main.c', 'src/debug.c', 'hal/gpio.c'],
        incDirs: ['src'],
        libDirs: [],
        defines: ['BASE=1'],
        options: {
            'c/cpp-compiler': {
                C_FLAGS: '-Wall',
                CXX_FLAGS: '',
                optimization: 'level-debug'
            },
            'asm-compiler': { ASM_FLAGS: '' },
            linker: { LD_FLAGS: '' },
            afterBuildTasks: [{ name: 'old' }]
        },
        env: { A: '1' }
    };
}

const params = baseParams();
const result = applyBuildOverrides(params, {
    defines: ['BASE=1', 'FEATURE=1'],
    includeDirs: ['lib/x/include'],
    libDirs: ['lib/x'],
    cFlags: '-O2',
    cxxFlags: '-std=c++17',
    asmFlags: '-g',
    ldFlags: '-Wl,--gc-sections',
    options: {
        'c/cpp-compiler': { optimization: 'level-size' },
        afterBuildTasks: [{ name: 'new' }]
    },
    source: { exclude: ['src/debug.c'] },
    env: { B: '2' }
});

assert(params.defines.length === 1 && params.defines[0] === 'BASE=1',
    'overrides: original params are not mutated');
assert(params.options['c/cpp-compiler'].C_FLAGS === '-Wall',
    'overrides: original options are not mutated');
assert(result.defines.join('|') === 'BASE=1|FEATURE=1',
    'overrides: appends unique defines');
assert(result.incDirs.join('|') === 'src|lib/x/include', 'overrides: appends include dirs');
assert(result.libDirs.join('|') === 'lib/x', 'overrides: appends lib dirs');
assert(result.sourceList.join('|') === 'src/main.c|hal/gpio.c',
    'overrides: applies source exclude');
assert(result.options['c/cpp-compiler'].C_FLAGS === '-Wall -O2',
    'overrides: appends C flags');
assert(result.options['c/cpp-compiler'].CXX_FLAGS === '-std=c++17',
    'overrides: appends CXX flags');
assert(result.options['asm-compiler'].ASM_FLAGS === '-g', 'overrides: appends ASM flags');
assert(result.options.linker.LD_FLAGS === '-Wl,--gc-sections',
    'overrides: appends LD flags');
assert(result.options['c/cpp-compiler'].optimization === 'level-size',
    'overrides: patches nested options');
assert(result.options['c/cpp-compiler'].C_FLAGS === '-Wall -O2',
    'overrides: options patch keeps sibling flags');
assert(result.options.afterBuildTasks.length === 1
    && result.options.afterBuildTasks[0].name === 'new',
    'overrides: options arrays are replaced');
assert(result.env.A === '1' && result.env.B === '2', 'overrides: merges env');

const included = applyBuildOverrides(baseParams(), {
    source: { include: ['src/**'] }
});
assert(included.sourceList.join('|') === 'src/main.c|src/debug.c',
    'overrides: applies source include');

const unchanged = applyBuildOverrides(baseParams(), undefined);
assert(unchanged !== params, 'overrides: missing overrides returns a clone');
assert(unchanged.defines.join('|') === 'BASE=1', 'overrides: clone preserves values');

assert(validateBuildOverrides(undefined) === undefined, 'validate: undefined is valid');
assert(validateBuildOverrides({}) === undefined, 'validate: empty object is valid');
assert(validateBuildOverrides({ defines: 'A=1' }) !== undefined,
    'validate: defines must be an array');
assert(validateBuildOverrides({ defines: [''] }) !== undefined,
    'validate: defines must not be empty');
assert(validateBuildOverrides({ env: { A: 1 } }) !== undefined,
    'validate: env values must be strings');
assert(validateBuildOverrides({ options: [] }) !== undefined,
    'validate: options must be an object');
assert(validateBuildOverrides({ source: { exclude: [1] } }) !== undefined,
    'validate: source patterns must be strings');

console.log('All build override tests passed.');
export {};
