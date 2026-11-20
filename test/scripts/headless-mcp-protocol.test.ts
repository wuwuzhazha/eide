const fs = require('fs');
const os = require('os');
const NodePath = require('path');
const yaml = require('yaml');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

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

function parse(result: any): any {
    return JSON.parse(result.content[0].text);
}

const root = NodePath.join(os.tmpdir(), `eide-mcp-protocol-${process.pid}-${Date.now()}`);

async function run(): Promise<void> {
    write(NodePath.join(root, '.eide', 'eide.yml'), yaml.stringify({
        version: '4.1',
        name: 'demo',
        type: 'ARM',
        srcDirs: ['src'],
        outDir: 'build',
        dependenceList: [],
        miscInfo: { uid: 'protocol-uid' },
        targets: {
            Debug: {
                toolchain: 'GCC',
                toolchainConfigMap: { GCC: { options: {} } },
                uploader: 'pyOCD',
                uploadConfigMap: { pyOCD: {} },
                excludeList: [],
                cppPreprocessAttrs: { name: 'default', incList: [], libList: [], defineList: [] },
                settings: {}
            }
        }
    }));
    const resources = NodePath.join(root, 'resources');
    const toolchain = NodePath.join(root, 'toolchain');
    const schemaDir = NodePath.join(root, 'lang');
    fs.mkdirSync(resources, { recursive: true });
    fs.mkdirSync(toolchain, { recursive: true });
    fs.mkdirSync(schemaDir, { recursive: true });

    const serverPath = NodePath.resolve(__dirname, '../../../src/mcp/headless_main.js');
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
            serverPath,
            '--project', root,
            '--resources', resources,
            '--toolchain-path', toolchain,
            '--schema-dir', schemaDir
        ],
        cwd: root,
        stderr: 'pipe'
    });
    const client = new Client({ name: 'eide-test', version: '1.0.0' });
    try {
        await client.connect(transport);

        const tools = await client.listTools();
        assert(tools.tools.length === 35, 'protocol: exposes 35 tools');
        assert(tools.tools.some((tool: any) => tool.name === 'eide_debug_connect'),
            'protocol: debug tools are exposed');
        assert(tools.tools.some((tool: any) => tool.name === 'eide_debug_backtrace'),
            'protocol: debug backtrace tool is exposed');
        assert(tools.tools.some((tool: any) => tool.name === 'eide_debug_list_breakpoints'),
            'protocol: debug breakpoint list tool is exposed');
        assert(tools.tools.some((tool: any) => tool.name === 'eide_build'),
            'protocol: build tool is exposed');

        let result = await client.callTool({
            name: 'eide_get_targets',
            arguments: { uid: 'protocol-uid' }
        });
        let data = parse(result);
        assert(data.actived === 'Debug' && data.targets.join('|') === 'Debug',
            'protocol: get targets');

        result = await client.callTool({
            name: 'eide_set_defines',
            arguments: { uid: 'protocol-uid', defines: ['A=1', 'B=2'] }
        });
        assert(result.isError !== true, 'protocol: set defines');

        result = await client.callTool({
            name: 'eide_get_defines',
            arguments: { uid: 'protocol-uid' }
        });
        assert(parse(result).join('|') === 'A=1|B=2', 'protocol: get defines');

        result = await client.callTool({
            name: 'eide_get_src_dirs',
            arguments: { uid: 'protocol-uid' }
        });
        assert(parse(result).join('|') === 'src', 'protocol: get source dirs');
    } finally {
        await client.close();
    }
}

run()
    .then(() => {
        console.log('All headless MCP protocol tests passed.');
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });
export {};
