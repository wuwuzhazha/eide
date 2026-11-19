import * as fs from 'fs';
import * as os from 'os';
import * as NodePath from 'path';
import * as yaml from 'yaml';
import * as mock from 'mock-require';

mock.default('vscode', {
    env: { language: 'en-us' },
    workspace: { getConfiguration: () => ({ get: () => undefined }) },
    window: {},
    languages: {},
    commands: {},
    Uri: { file: (p: string) => ({ fsPath: p }) },
    ThemeIcon: class { },
    TreeItem: class { },
    TreeItemCollapsibleState: { None: 0 },
    EventEmitter: class {
        event() { return () => undefined; }
        fire() { }
        dispose() { }
    },
    ConfigurationTarget: { Global: 1 },
    QuickPickItemKind: { Separator: -1 },
    ProgressLocation: { Notification: 15 }
});

const { File } = require('../../../lib/node-utility/File') as any;
const { ProjectConfiguration } = require('../../../src/EIDETypeDefine') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

function baseConfig() {
    return {
        version: '4.1',
        name: 'demo',
        type: 'ARM',
        srcDirs: ['src'],
        outDir: 'build',
        miscInfo: { uid: 'test-uid' },
        targets: {
            Debug: {
                toolchain: 'GCC',
                toolchainConfigMap: { GCC: {} },
                uploader: 'JLink',
                uploadConfigMap: { JLink: {} },
                excludeList: [],
                cppPreprocessAttrs: {
                    name: 'default',
                    incList: [],
                    libList: [],
                    defineList: []
                },
                settings: { debugger: 'cortex-debug' }
            }
        }
    };
}

const baseDir = NodePath.join(os.tmpdir(), `eide-hot-reload-${process.pid}-${Date.now()}`);
const eideDir = NodePath.join(baseDir, '.eide');
fs.mkdirSync(eideDir, { recursive: true });
const cfgFile = NodePath.join(eideDir, 'eide.yml');

const workspaceState = {
    get: () => undefined,
    update: () => Promise.resolve()
};

assert(ProjectConfiguration.parseProjectFile('version: 4.1\nname: demo').version === '4.1',
    'parseProjectFile: numeric version is normalized to string');
assert(ProjectConfiguration.parseProjectFile('version: "4.1"\nname: demo').version === '4.1',
    'parseProjectFile: string version is preserved');

let conf: any;
const writeConfig = (modify?: (cfg: any) => void) => {
    const cfg = baseConfig();
    modify?.(cfg);
    fs.writeFileSync(cfgFile, yaml.stringify(cfg));
};

try {
    writeConfig();
    conf = new ProjectConfiguration(new File(cfgFile), workspaceState as any);
    conf.load();
    assert(conf.config.name === 'demo', 'load: reads project config');
    assert(conf.config.mode === 'Debug', 'load: recovers current target');
    assert(conf.hasExternalChange() === false, 'load: disk content is in sync');

    writeConfig(cfg => {
        cfg.name = 'demo-reloaded';
        cfg.srcDirs = ['src', 'src2'];
    });
    assert(conf.hasExternalChange() === true, 'external edit: detected by content');
    assert(conf.ReloadFromFile() === true, 'external edit: reloads in place');
    assert(conf.config.name === 'demo-reloaded', 'external edit: applies new content');
    assert(conf.config.srcDirs.some((p: string) => p.endsWith('src2')), 'external edit: applies new source dirs');
    assert(conf.config.toolchainConfig === conf.toolchainConfigModel.data,
        'external edit: rebinds toolchain config model');
    assert(conf.hasExternalChange() === false, 'external edit: sync state updated');

    writeConfig(cfg => { cfg.name = 'demo-external'; });
    conf.Save();
    const onDisk = yaml.parse(fs.readFileSync(cfgFile, 'utf8'));
    assert(onDisk.name === 'demo-external', 'save guard: external content is not overwritten');

    writeConfig(cfg => {
        cfg.name = 'demo-reloaded';
        cfg.targets.Debug.toolchain = 'AC6';
        cfg.targets.Debug.toolchainConfigMap = { AC6: {} };
    });
    assert(conf.ReloadFromFile() === false, 'identity change: falls back to reopen');
    assert(conf.config.name === 'demo-reloaded', 'identity change: keeps current in-memory config');

    fs.writeFileSync(cfgFile, 'invalid: [');
    let parseError = false;
    try {
        conf.ReloadFromFile();
    } catch {
        parseError = true;
    }
    assert(parseError, 'invalid yaml: reload throws');
    assert(conf.config.name === 'demo-reloaded', 'invalid yaml: keeps current in-memory config');
} finally {
    conf?.Dispose();
    fs.rmSync(baseDir, { recursive: true, force: true });
}
