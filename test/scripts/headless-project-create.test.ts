const fs = require('fs');
const os = require('os');
const NodePath = require('path');
const yaml = require('yaml');
const { main } = require('../../../src/cli/main') as any;
const { HEADLESS_TEMPLATES } = require('../../../src/headless/project_creator') as any;
const { compareVersion, migrateProjectConfig, needsProjectConfigMigration } =
    require('../../../src/core/project_config_migration') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

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

const root = NodePath.join(os.tmpdir(), `eide-create-${process.pid}-${Date.now()}`);
const resources = NodePath.join(process.cwd(), 'res');

async function run(): Promise<void> {
    assert(compareVersion('4.1', '4.0') > 0, 'migration: version compare');
    assert(compareVersion('3.5', '4.0') < 0, 'migration: old version detected');
    const oldConfig: any = {
        version: '3.5',
        targets: {
            Debug: {
                toolchain: 'GCC',
                uploader: 'JLink',
                compileConfig: { cpuType: 'Cortex-M3' },
                builderOptions: { GCC: { version: 5 } },
                uploadConfig: { bin: '' },
                custom_dep: { name: 'default', incList: [] }
            }
        }
    };
    assert(needsProjectConfigMigration(oldConfig), 'migration: old config needs migration');
    migrateProjectConfig(oldConfig);
    assert(oldConfig.targets.Debug.toolchainConfigMap.GCC.cpuType === 'Cortex-M3',
        'migration: compileConfig renamed');
    assert(oldConfig.targets.Debug.toolchainConfigMap.GCC.options.version === 5,
        'migration: builder options moved');
    assert(oldConfig.targets.Debug.uploadConfigMap.JLink.bin === '',
        'migration: upload config moved');
    assert(oldConfig.targets.Debug.cppPreprocessAttrs.name === 'default',
        'migration: custom_dep renamed');

    const currentConfig = { version: '4.1', targets: {} };
    assert(!needsProjectConfigMigration(currentConfig), 'migration: current config unchanged');

    const help = io();
    assert(await main(['--help'], help) === 0 && help.out().includes('eide-cli create'),
        'create: help shows create usage');

    assert(HEADLESS_TEMPLATES.some((t: any) => t.name === 'stm32f1xx_gcc'),
        'create: STM32 GCC template is available');
    assert(HEADLESS_TEMPLATES.some((t: any) => t.name === 'gd32vf103_riscv'),
        'create: RISC-V template is available');

    let text = io();
    let code = await main(['create', '--name', 'missing', '--template', 'nope',
        '--output', root, '--resources', resources], text);
    assert(code === 3 && text.err().includes('Unknown template'),
        'create: unknown template is a usage error');

    text = io();
    code = await main(['create', '--name', 'bad name', '--template', 'stm32f1xx_gcc',
        '--output', root, '--resources', resources], text);
    assert(code === 3 && text.err().includes('whitespace'),
        'create: invalid project name is rejected');

    text = io();
    code = await main(['create', '--template', 'stm32f1xx_gcc', '--output', root], text);
    assert(code === 3 && text.err().includes('--name'),
        'create: missing name is a usage error');

    text = io();
    code = await main(['create', '--name', 'demo-fw', '--template', 'stm32f1xx_gcc',
        '--output', root, '--resources', resources, '--project-name', 'Display Name'], text);
    assert(code === 0, `create: command succeeds\n${text.err()}`);
    const result = JSON.parse(text.out());
    assert(result.success === true && result.command === 'create', 'create: JSON result');
    assert(result.projectPath === NodePath.join(root, 'demo-fw'), 'create: project path');
    assert(result.workspaceFile === NodePath.join(root, 'demo-fw', 'Display Name.code-workspace'),
        'create: workspace file uses project name');
    assert(result.template === 'stm32f1xx_gcc' && result.type === 'ARM', 'create: template metadata');
    assert(/^[0-9a-f]{32}$/.test(result.uid), 'create: unique uid');
    assert(result.files > 50, 'create: extracts template files');

    const configPath = NodePath.join(root, 'demo-fw', '.eide', 'eide.yml');
    const config = yaml.parse(fs.readFileSync(configPath, 'utf8'));
    assert(config.version === '4.1', 'create: config version is current');
    assert(config.name === 'Display Name', 'create: config project name');
    assert(config.miscInfo.uid === result.uid, 'create: config uid');
    assert(!fs.existsSync(NodePath.join(root, 'demo-fw', '.eide', 'eide.json')),
        'create: old eide.json removed');
    assert(!fs.existsSync(NodePath.join(root, 'demo-fw', '.eide.usr.ctx.json')),
        'create: stale user context removed');
    assert(fs.existsSync(NodePath.join(root, 'demo-fw', 'src', 'main.c')),
        'create: source files present');
    assert(!fs.existsSync(NodePath.join(root, 'demo-fw', 'stm32f1xx_gcc.code-workspace')),
        'create: original workspace file renamed');

    text = io();
    code = await main(['create', '--name', 'demo-fw', '--template', 'stm32f1xx_gcc',
        '--output', root, '--resources', resources], text);
    assert(code === 3 && text.err().includes('already exists'),
        'create: existing directory is rejected');
}

run()
    .then(() => console.log('All headless project create tests passed.'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => fs.rmSync(root, { recursive: true, force: true }));
export {};
