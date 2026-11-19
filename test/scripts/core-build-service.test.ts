const fs = require('fs');
const os = require('os');
const NodePath = require('path');
const yaml = require('yaml');
const { HeadlessBuildService } = require('../../../src/core/build_service') as any;
const { ProcessTimeoutError } = require('../../../src/core/process_runner') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

function write(path: string, content = ''): void {
    fs.mkdirSync(NodePath.dirname(path), { recursive: true });
    fs.writeFileSync(path, content);
}

const root = NodePath.join(os.tmpdir(), `eide-build-service-${process.pid}-${Date.now()}`);
const exe = process.platform === 'win32' ? '.exe' : '';
const outDir = NodePath.join(root, 'build', 'Debug');

function projectConfig(): any {
    return {
        version: '4.1',
        name: 'demo',
        type: 'ARM',
        srcDirs: ['src'],
        outDir: 'build',
        dependenceList: [],
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
                            'c/cpp-compiler': { C_FLAGS: '-Wall', CXX_FLAGS: '', optimization: 'level-debug' },
                            'asm-compiler': { ASM_FLAGS: '' },
                            global: { 'output-debug-info': 'enable' },
                            linker: { LD_FLAGS: '', LIB_FLAGS: '-lm', 'output-format': 'elf' }
                        }
                    }
                },
                uploadConfigMap: { JLink: {} },
                uploader: 'JLink',
                excludeList: [],
                cppPreprocessAttrs: { name: 'default', incList: ['src'], libList: [], defineList: ['DEMO=1'] },
                settings: {}
            }
        }
    };
}

class FakeRunner {
    constructor(private readonly action: (args: string[]) => any) {}
    async run(file: string, args: string[]): Promise<any> {
        return this.action(args);
    }
}

async function main(): Promise<void> {
    write(NodePath.join(root, 'src', 'main.c'), 'int main(void) { return 0; }');
    write(NodePath.join(root, '.eide', 'eide.yml'), yaml.stringify(projectConfig()));
    write(NodePath.join(root, 'link.ld'));
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

    const successLog = [
        '>>> cc',
        "src/main.c: In function 'main':",
        "src/main.c:3:9: warning: unused variable 'x' [Wunused-variable]",
        '>>> ld',
        'Memory region         Used Size  Region Size  %age Used',
        '           FLASH:       1234 B        64 KB      1.88%',
        '             RAM:        567 B        20 KB      2.77%'
    ].join('\n');

    const successService = new HeadlessBuildService({
        resourcesDir: resources,
        toolchainPath: toolchain,
        runner: new FakeRunner(args => {
            assert(args.includes('-p'), 'service: builder receives params path');
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(NodePath.join(outDir, 'compiler.log'), successLog);
            fs.writeFileSync(NodePath.join(outDir, 'demo.elf'), 'elf');
            return { code: 0, stdout: 'done', stderr: '' };
        }),
        timeoutMs: 5000
    });
    const result = await successService.build({
        projectPath: root,
        target: 'Debug',
        overrides: { cFlags: '-O2' }
    });
    assert(result.success === true, 'service: successful build');
    assert(result.buildId.length === 64, 'service: build id');
    assert(result.stage === 'link', 'service: stage');
    assert(result.problems.length === 1 && result.problems[0].severity === 'warning',
        'service: parses warning');
    assert(result.problems[0].line === 3 && result.problems[0].column === 9,
        'service: problem location');
    assert(result.memory.FLASH.used === 1234 && result.memory.FLASH.size === 65536,
        'service: memory usage');
    assert(result.artifacts.length === 1 && result.artifacts[0].endsWith('demo.elf'),
        'service: artifacts');
    assert(result.effectiveConfig.cFlags === '-Wall -O2', 'service: effective config');
    assert(fs.existsSync(NodePath.join(outDir, 'build-manifest.json')), 'service: manifest written');
    assert(result.logTail === undefined, 'service: no log tail on success');

    const failureLog = [
        '>>> cc',
        'src/main.c:7:3: error: expected expression before end of input'
    ].join('\n');
    const failureService = new HeadlessBuildService({
        resourcesDir: resources,
        toolchainPath: toolchain,
        runner: new FakeRunner(() => {
            fs.writeFileSync(NodePath.join(outDir, 'compiler.log'), failureLog);
            return { code: 1, stdout: '', stderr: 'build failed' };
        }),
        timeoutMs: 5000
    });
    const failed = await failureService.build({ projectPath: root, mode: 'rebuild' });
    assert(failed.success === false, 'service: failed build');
    assert(failed.stage === 'compile', 'service: failure stage');
    assert(failed.problems[0].severity === 'error', 'service: parses error');
    assert(failed.logTail.includes('expected expression'), 'service: log tail');

    const timeoutService = new HeadlessBuildService({
        resourcesDir: resources,
        toolchainPath: toolchain,
        runner: new FakeRunner(() => {
            throw new ProcessTimeoutError(42, 'partial', '');
        }),
        timeoutMs: 42
    });
    const timedOut = await timeoutService.build({ projectPath: root });
    assert(timedOut.success === false && timedOut.analysisError.includes('timed out'),
        'service: timeout is reported');
    assert(timedOut.logTail.includes('partial'), 'service: timeout log tail');

    const cleaned = await successService.clean({ projectPath: root });
    assert(cleaned.success === true && !fs.existsSync(outDir), 'service: clean removes output');
    const cleanedAgain = await successService.clean({ projectPath: root });
    assert(cleanedAgain.success === true && cleanedAgain.message.includes('does not exist'),
        'service: clean is idempotent');

    let profileRejected = false;
    try {
        await successService.plan({ projectPath: root, profile: 'release' });
    } catch {
        profileRejected = true;
    }
    assert(profileRejected, 'service: unsupported profile fails explicitly');
}

main()
    .then(() => {
        console.log('All build service tests passed.');
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });
export {};
