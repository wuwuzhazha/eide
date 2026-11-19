const fs = require('fs');
const os = require('os');
const NodePath = require('path');
const yaml = require('yaml');
const { main } = require('../../../src/cli/main') as any;

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

const root = NodePath.join(os.tmpdir(), `eide-cli-main-${process.pid}-${Date.now()}`);
const exe = process.platform === 'win32' ? '.exe' : '';

function io(): any {
    const out: string[] = [];
    const err: string[] = [];
    return {
        stdout: (text: string) => out.push(text),
        stderr: (text: string) => err.push(text),
        out: () => out.join(''),
        err: () => err.join('')
    };
}

function projectConfig(type: string, toolchain: string): any {
    return {
        version: '4.1',
        name: 'demo',
        type,
        srcDirs: ['src'],
        outDir: 'build',
        dependenceList: [],
        targets: {
            Debug: {
                toolchain,
                toolchainConfigMap: {
                    [toolchain]: {
                        cpuType: 'Cortex-M3',
                        floatingPointHardware: 'default',
                        archExtensions: '',
                        scatterFilePath: 'link.ld',
                        options: {
                            version: 5,
                            'c/cpp-compiler': { C_FLAGS: '-Wall', CXX_FLAGS: '' },
                            'asm-compiler': { ASM_FLAGS: '' },
                            global: {},
                            linker: { LD_FLAGS: '', LIB_FLAGS: '' }
                        }
                    }
                },
                uploadConfigMap: { JLink: {} },
                uploader: 'JLink',
                excludeList: [],
                cppPreprocessAttrs: { name: 'default', incList: [], libList: [], defineList: [] },
                settings: {}
            }
        }
    };
}

async function run(): Promise<void> {
    write(NodePath.join(root, 'src', 'main.c'), 'int main(void) { return 0; }');
    write(NodePath.join(root, '.eide', 'eide.yml'), yaml.stringify(projectConfig('ARM', 'GCC')));
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

    let text = io();
    let code = await main(['--help'], text);
    assert(code === 0 && text.out().includes('Usage:'), 'cli: help');

    text = io();
    code = await main(['build', '--project', root], text);
    assert(code === 3 && text.err().includes('--resources'), 'cli: missing environment is a usage error');

    text = io();
    code = await main(['plan', '--project', root, '--resources', resources,
        '--toolchain-path', toolchain], text);
    const plan = JSON.parse(text.out());
    assert(code === 0 && plan.success === true && plan.command === 'plan', 'cli: plan succeeds');
    assert(plan.args.includes('--no-color'), 'cli: plan args');
    assert(fs.existsSync(plan.paramsFile), 'cli: plan writes builder params');
    assert(plan.params.name === 'demo', 'cli: plan includes params');

    const outDir = NodePath.join(root, 'build', 'Debug');
    write(NodePath.join(outDir, 'old.elf'), 'elf');
    text = io();
    code = await main(['clean', '--project', root], text);
    const cleaned = JSON.parse(text.out());
    assert(code === 0 && cleaned.success === true, 'cli: clean succeeds');
    assert(!fs.existsSync(outDir), 'cli: clean removes output');

    text = io();
    code = await main(['clean', '--project', root, '--dry-run'], text);
    assert(code === 3 && text.err().includes('not supported'), 'cli: clean dry-run is rejected');

    const wrongRoot = NodePath.join(root, 'wrong');
    write(NodePath.join(wrongRoot, 'src', 'main.c'), '');
    write(NodePath.join(wrongRoot, '.eide', 'eide.yml'),
        yaml.stringify(projectConfig('ARM', 'AC6')));
    text = io();
    code = await main(['plan', '--project', wrongRoot, '--resources', resources,
        '--toolchain-path', toolchain], text);
    const failed = JSON.parse(text.out());
    assert(code === 3 && failed.success === false && failed.error.message.includes('ARM GCC'),
        'cli: unsupported toolchain fails explicitly');
}

run()
    .then(() => {
        console.log('All CLI main tests passed.');
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });
export {};
