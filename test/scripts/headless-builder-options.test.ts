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
        miscInfo: { uid: `builder-options-${toolchain}` },
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
    ['C51', 'SDCC', 'sdcc.verify.json'],
    ['C51', 'GNU_SDCC_MCS51', 'sdcc.mcs51.verify.json'],
    ['C51', 'IAR_STM8', 'stm8.iar.verify.json'],
    ['C51', 'COSMIC_STM8', 'stm8.cosmic.verify.json'],
    ['ARM', 'GCC', 'arm.gcc.verify.json'],
    ['ARM', 'AC5', 'arm.v5.verify.json'],
    ['ARM', 'AC6', 'arm.v6.verify.json'],
    ['ARM', 'LLVM_ARM', 'arm.llvm.verify.json'],
    ['ARM', 'IAR_ARM', 'arm.iar.verify.json'],
    ['RISC-V', 'RISCV_GCC', 'riscv.gcc.verify.json'],
    ['ANY-GCC', 'ANY_GCC', 'any.gcc.verify.json'],
    ['MIPS', 'MTI_GCC', 'mips.mti.gcc.verify.json'],
    ['C51', 'Keil_C51', '8051.keil.verify.json']
];

const base = NodePath.join(os.tmpdir(), `eide-builder-options-${process.pid}-${Date.now()}`);
const resources = NodePath.join(process.cwd(), 'res');
const langDir = NodePath.join(process.cwd(), 'lang');

async function run(): Promise<void> {
    for (const [type, toolchain, schemaFile] of cases) {
        const root = NodePath.join(base, type.replace(/[^a-z0-9]/gi, '_'), toolchain);
        const configPath = NodePath.join(root, '.eide', 'eide.yml');
        write(NodePath.join(root, 'src', 'main.c'), 'int main(void) { return 0; }');
        write(NodePath.join(root, 'link.ld'));
        write(configPath, yaml.stringify(projectConfig(type, toolchain)));
        const toolchainPath = toolchainLayout(root, toolchain);
        const service = new EideBuildService({
            resourcesDir: resources,
            extensionRoot: process.cwd(),
            toolchainPath,
            runner: { run: async () => ({ code: 0, stdout: '', stderr: '' }) },
            timeoutMs: 5000
        });
        const request = { projectPath: root, target: 'Debug' };

        const schema = await service.getBuilderOptionsSchema(request);
        const expected = JSON.parse(fs.readFileSync(NodePath.join(langDir, schemaFile), 'utf8'));
        assert(JSON.stringify(schema) === JSON.stringify(expected),
            `builder options: ${type}/${toolchain} schema is ${schemaFile}`);

        const options = await service.getBuilderOptions(request);
        assert(options && typeof options === 'object'
            && options.global && typeof options.global === 'object',
        `builder options: ${type}/${toolchain} options are readable`);

        await service.setBuilderOptions(request, {
            version: 5,
            global: { toolPrefix: `matrix-${toolchain}` },
            linker: { 'linker-config': '' }
        });

        const reloaded = await service.getBuilderOptions(request);
        assert(reloaded.global.toolPrefix === `matrix-${toolchain}`,
            `builder options: ${type}/${toolchain} options round trip`);

        const config = yaml.parse(fs.readFileSync(configPath, 'utf8'));
        const persisted = config.targets.Debug.toolchainConfigMap[toolchain].options;
        assert(persisted.global.toolPrefix === `matrix-${toolchain}`,
            `builder options: ${type}/${toolchain} options are saved to eide.yml`);
    }
}

run()
    .then(() => {
        console.log('All headless builder options tests passed.');
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => {
        fs.rmSync(base, { recursive: true, force: true });
    });
export {};
