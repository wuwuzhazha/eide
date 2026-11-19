const fs = require('fs');
const os = require('os');
const NodePath = require('path');
const yaml = require('yaml');
const { EideBuildService } = require('../../../src/headless/build_service') as any;

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

function builderOptions(): any {
    return {
        version: 5,
        beforeBuildTasks: [],
        afterBuildTasks: [],
        global: {},
        'c/cpp-compiler': { C_FLAGS: '', CXX_FLAGS: '' },
        'asm-compiler': { ASM_FLAGS: '' },
        linker: { LD_FLAGS: '', LIB_FLAGS: '', 'output-format': 'elf' }
    };
}

function toolchainConfig(type: string): any {
    if (type === 'ARM') {
        return {
            cpuType: 'Cortex-M3',
            floatingPointHardware: 'default',
            archExtensions: '',
            scatterFilePath: 'link.ld',
            options: builderOptions()
        };
    }
    if (type === 'C51') {
        return { linkerScript: '', options: builderOptions() };
    }
    return { linkerScriptPath: 'link.ld', options: builderOptions() };
}

function projectConfig(type: string, toolchain: string): any {
    return {
        version: '4.1',
        name: 'demo',
        type,
        srcDirs: ['src'],
        outDir: 'build',
        dependenceList: [],
        miscInfo: { uid: 'toolchain-matrix-uid' },
        targets: {
            Debug: {
                toolchain,
                toolchainConfigMap: { [toolchain]: toolchainConfig(type) },
                uploader: 'Custom',
                uploadConfigMap: { Custom: {} },
                excludeList: [],
                cppPreprocessAttrs: { name: 'default', incList: [], libList: [], defineList: [] },
                settings: {}
            }
        }
    };
}

function toolchainLayout(root: string, toolchain: string): string {
    const dir = NodePath.join(root, 'toolchain');
    if (toolchain === 'Keil_C51') {
        const keil = NodePath.join(dir, 'keil');
        write(NodePath.join(keil, 'BIN', 'keil'));
        const ini = NodePath.join(dir, 'TOOLS.INI');
        write(ini, `[C51]\nPATH="${keil.replace(/\\/g, '/')}"\n`);
        return ini;
    }
    if (toolchain === 'IAR_STM8') {
        write(NodePath.join(dir, 'stm8', 'bin', 'iccstm8'));
    } else if (toolchain === 'COSMIC_STM8') {
        fs.mkdirSync(dir, { recursive: true });
    } else {
        write(NodePath.join(dir, 'bin', 'compiler'));
    }
    return dir;
}

const cases: Array<[string, string, string]> = [
    ['C51', 'SDCC', 'sdcc.model.json'],
    ['C51', 'GNU_SDCC_MCS51', 'sdcc.mcs51.model.json'],
    ['C51', 'IAR_STM8', 'stm8.iar.model.json'],
    ['C51', 'COSMIC_STM8', 'stm8.cosmic.model.json'],
    ['ARM', 'GCC', 'arm.gcc.model.json'],
    ['ARM', 'AC5', 'arm.v5.model.json'],
    ['ARM', 'AC6', 'arm.v6.model.json'],
    ['ARM', 'LLVM_ARM', 'arm.llvm.model.json'],
    ['ARM', 'IAR_ARM', 'arm.iar.model.json'],
    ['RISC-V', 'RISCV_GCC', 'riscv.gcc.model.json'],
    ['ANY-GCC', 'ANY_GCC', 'any.gcc.model.json'],
    ['MIPS', 'MTI_GCC', 'mips.mti.gcc.model.json'],
    ['C51', 'Keil_C51', '8051.keil.model.json']
];

const base = NodePath.join(os.tmpdir(), `eide-toolchain-matrix-${process.pid}-${Date.now()}`);
const resources = NodePath.join(process.cwd(), 'res');

async function run(): Promise<void> {
    try {
        for (const [type, toolchain, modelName] of cases) {
            const root = NodePath.join(base, type.replace(/[^a-z0-9]/gi, '_'), toolchain);
            write(NodePath.join(root, 'src', 'main.c'), 'int main(void) { return 0; }');
            write(NodePath.join(root, 'link.ld'));
            write(NodePath.join(root, '.eide', 'eide.yml'),
                yaml.stringify(projectConfig(type, toolchain)));
            const toolchainPath = toolchainLayout(root, toolchain);
            const service = new EideBuildService({
                resourcesDir: resources,
                extensionRoot: process.cwd(),
                toolchainPath,
                runner: { run: async () => ({ code: 0, stdout: '', stderr: '' }) },
                timeoutMs: 5000
            });
            const plan = await service.plan({ projectPath: root, target: 'Debug' });
            const params = plan.params;
            assert(params.toolchain === toolchain, `matrix: ${type}/${toolchain} toolchain`);
            assert(params.toolchainCfgFile.endsWith(modelName),
                `matrix: ${type}/${toolchain} model`);
            assert(params.sourceList.includes('src/main.c'),
                `matrix: ${type}/${toolchain} sources`);
        }
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }

    const xpackRoot = NodePath.join(base, 'xpack');
    write(NodePath.join(xpackRoot, 'src', 'main.c'), 'int main(void) { return 0; }');
    write(NodePath.join(xpackRoot, 'link.ld'));
    write(NodePath.join(xpackRoot, '.eide', 'eide.yml'),
        yaml.stringify(projectConfig('ARM', 'GCC')));
    write(NodePath.join(xpackRoot, 'package.json'), JSON.stringify({
        name: 'demo',
        xpack: {
            devDependencies: {
                '@xpack-dev-tools/arm-none-eabi-gcc': { specifier: '14.2.1-1.1.1' }
            }
        }
    }));
    write(NodePath.join(
        xpackRoot, 'xpacks', '@xpack-dev-tools', 'arm-none-eabi-gcc', 'package.json'),
    JSON.stringify({
        name: '@xpack-dev-tools/arm-none-eabi-gcc',
        version: '14.2.1-1.1.1',
        xpack: { binaries: { destination: './.content' } }
    }));
    write(NodePath.join(xpackRoot, 'xpacks', '@xpack-dev-tools', 'arm-none-eabi-gcc',
        '.content', 'bin', 'arm-none-eabi-gcc'));
    const xpackService = new EideBuildService({
        resourcesDir: resources,
        extensionRoot: process.cwd(),
        runner: { run: async () => ({ code: 0, stdout: '', stderr: '' }) },
        timeoutMs: 5000
    });
    const xpackPlan = await xpackService.plan({ projectPath: xpackRoot, target: 'Debug' });
    assert(xpackPlan.params.toolchainLocation.replace(/\\/g, '/').endsWith(
        'xpacks/@xpack-dev-tools/arm-none-eabi-gcc/.content'),
    'matrix: xpack toolchain location');
    assert(xpackPlan.params.sourceList.includes('src/main.c'), 'matrix: xpack sources');
    fs.rmSync(base, { recursive: true, force: true });
}

run()
    .then(() => {
        console.log('All toolchain matrix tests passed.');
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
export {};
