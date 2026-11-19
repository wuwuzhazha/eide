const fs = require('fs');
const os = require('os');
const NodePath = require('path');
const yaml = require('yaml');
const { loadProjectSnapshot } = require('../../../src/core/project_snapshot') as any;
const { createBuildPlan } = require('../../../src/core/build_plan') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

const root = NodePath.join(os.tmpdir(), `eide-build-plan-${process.pid}-${Date.now()}`);
const exe = process.platform === 'win32' ? '.exe' : '';

function write(path: string, content = ''): void {
    fs.mkdirSync(NodePath.dirname(path), { recursive: true });
    fs.writeFileSync(path, content);
}

try {
    fs.mkdirSync(NodePath.join(root, 'src'), { recursive: true });
    write(NodePath.join(root, 'src', 'main.c'), 'int main(void) { return 0; }');
    write(NodePath.join(root, 'src', 'startup.s'), '');
    write(NodePath.join(root, 'src', 'skip.c'), '');

    const config = {
        version: '4.1',
        name: 'demo',
        type: 'ARM',
        srcDirs: ['src'],
        outDir: 'build',
        dependenceList: [],
        virtualFolder: { name: '<virtual_root>', files: [], folders: [] },
        targets: {
            Debug: {
                toolchain: 'GCC',
                toolchainConfigMap: {
                    GCC: {
                        cpuType: 'Cortex-M3',
                        floatingPointHardware: 'default',
                        archExtensions: '',
                        scatterFilePath: 'link.ld',
                        useCustomScatterFile: true,
                        options: {
                            version: 5,
                            'c/cpp-compiler': {
                                C_FLAGS: '-Wall',
                                CXX_FLAGS: '',
                                'language-c': 'c11',
                                optimization: 'level-debug'
                            },
                            'asm-compiler': { ASM_FLAGS: '' },
                            global: { 'misc-control': '', 'output-debug-info': 'enable' },
                            linker: { LD_FLAGS: '', LIB_FLAGS: '-lm', 'output-format': 'elf' }
                        }
                    }
                },
                uploadConfigMap: { JLink: {} },
                uploader: 'JLink',
                excludeList: ['src/skip.c'],
                cppPreprocessAttrs: {
                    name: 'default',
                    incList: ['src'],
                    libList: [],
                    defineList: ['DEMO=1']
                },
                settings: {}
            }
        }
    };
    write(NodePath.join(root, '.eide', 'eide.yml'), yaml.stringify(config));
    write(NodePath.join(root, 'link.ld'), '');

    const resources = NodePath.join(root, 'resources');
    write(NodePath.join(resources, 'data', 'models', 'arm.gcc.model.json'), '{}');
    if (process.platform === 'win32') {
        write(NodePath.join(resources, 'tools', 'win32', 'unify_builder', 'unify_builder.exe'));
    } else if (process.platform === 'linux') {
        write(NodePath.join(resources, 'tools', 'linux', 'unify_builder', 'unify_builder'));
    } else {
        const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
        write(NodePath.join(resources, 'tools', 'darwin', 'unify_builder', arch, 'unify_builder'));
    }
    const toolchain = NodePath.join(root, 'toolchain');
    write(NodePath.join(toolchain, 'bin', `arm-none-eabi-gcc${exe}`));

    const snapshot = loadProjectSnapshot(root);
    const request = {
        projectPath: root,
        target: 'Debug',
        overrides: {
            defines: ['FEATURE=1'],
            includeDirs: ['extra-inc'],
            libDirs: ['extra-lib'],
            cFlags: '-O2',
            ldFlags: '-Wl,--gc-sections',
            options: { 'c/cpp-compiler': { warnings: 'all-warnings' } },
            source: { exclude: ['src/skip.c'] }
        }
    };
    const plan = createBuildPlan(snapshot, request, {
        resourcesDir: resources,
        toolchainPath: toolchain,
        threadNum: 8,
        useMultithread: true
    });

    assert(plan.file.endsWith(`unify_builder${exe}`), 'build plan: builder executable');
    assert(plan.args.includes('--rebuild'), 'build plan: overrides default to rebuild');
    assert(plan.args.includes('--no-color'), 'build plan: no-color arguments');
    assert(fs.existsSync(plan.paramsPath), 'build plan: writes builder.params');
    assert(plan.buildId.length === 64, 'build plan: build id');
    assert(plan.params.name === 'demo' && plan.params.target === 'Debug', 'build plan: identity');
    assert(plan.params.buildMode === 'fast|multhread', 'build plan: build mode');
    assert(plan.params.threadNum === 8, 'build plan: thread count');
    assert(plan.params.sourceList.map((p: string) => p.replace(/\\/g, '/')).join('|')
        === 'src/main.c|src/startup.s', 'build plan: source list and excludes');
    assert(plan.params.defines.join('|') === 'DEMO=1|FEATURE=1', 'build plan: defines');
    assert(plan.params.incDirs.join('|') === 'src|extra-inc', 'build plan: include dirs');
    assert(plan.params.libDirs.join('|') === 'extra-lib', 'build plan: lib dirs');
    assert(plan.params.options.global.toolPrefix === 'arm-none-eabi-',
        'build plan: toolchain prefix');
    assert(plan.params.options.global['microcontroller-cpu'] === 'cortex-m3',
        'build plan: cpu option');
    assert(plan.params.options.global['arm-thumb-mode'] === 'thumb',
        'build plan: thumb mode');
    assert(plan.params.options.linker['$toolName'] === 'gcc', 'build plan: linker driver');
    assert(plan.params.options.linker['link-scatter'][0].endsWith('link.ld'),
        'build plan: linker script');
    assert(plan.params.options['c/cpp-compiler'].C_FLAGS === '-Wall -O2',
        'build plan: appends C flags');
    assert(plan.params.options['c/cpp-compiler'].warnings === 'all-warnings',
        'build plan: patches options');
    assert(plan.params.options.linker.LD_FLAGS === '-Wl,--gc-sections',
        'build plan: appends linker flags');
    assert(plan.params.env.ProjectName === 'demo', 'build plan: builtin env');

    const written = JSON.parse(fs.readFileSync(plan.paramsPath, 'utf8'));
    assert(written.defines.join('|') === 'DEMO=1|FEATURE=1', 'build plan: persists overrides');

    const incremental = createBuildPlan(snapshot, { projectPath: root }, {
        resourcesDir: resources,
        toolchainPath: toolchain
    });
    assert(!incremental.args.includes('--rebuild'), 'build plan: no overrides defaults to incremental');

    let unsupportedType = false;
    try {
        const wrong = JSON.parse(JSON.stringify(snapshot));
        wrong.toolchain = 'AC6';
        createBuildPlan(wrong, { projectPath: root }, {
            resourcesDir: resources,
            toolchainPath: toolchain
        });
    } catch {
        unsupportedType = true;
    }
    assert(unsupportedType, 'build plan: unsupported toolchain fails explicitly');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('All build plan tests passed.');
export {};
