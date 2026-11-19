import * as fs from 'fs';
import * as os from 'os';
import * as NodePath from 'path';
import * as mock from 'mock-require';

mock.default('vscode', {
    Position: class {
        constructor(public line: number, public character: number) { }
    },
    Range: class {
        constructor(public start: any, public end: any) { }
    },
    Diagnostic: class {
        source?: string;
        code?: unknown;
        constructor(public range: any, public message: string, public severity: number) { }
    },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 }
});

const { parseGccCompilerLog, parseArmccCompilerLog } = require('../../../src/ProblemMatcher') as any;
const { toBuildProblems } = require('../../../src/BuildReport') as any;
const { File } = require('../../../lib/node-utility/File') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

const baseDir = NodePath.join(os.tmpdir(), `eide-problem-matcher-${process.pid}-${Date.now()}`);
fs.mkdirSync(baseDir, { recursive: true });
const logFile = NodePath.join(baseDir, 'compiler.log');
fs.writeFileSync(logFile, [
    '>>> cc',
    '',
    "./src/main.c:17:25: error: expected expression before ';' token",
    './src/main.c:40:9: warning: implicit declaration of function \'delay\' [-Wimplicit-function-declaration]',
    '',
    '>>> ld',
    ''
].join('\r\n'));

const prj = {
    toolchainName: () => 'GCC',
    toAbsolutePath: (p: string) => p.replace(/\\/g, '/')
};

try {
    const diags = parseGccCompilerLog(prj, new File(logFile));
    const list = diags['./src/main.c'];
    assert(list !== undefined && list.length === 2, 'gcc: parses error and warning');
    assert(list[0].range.start.line === 16, 'gcc: line is 0-based in vscode range');
    assert(list[0].range.start.character === 24, 'gcc: 1-based column is converted to 0-based');
    assert(list[0].severity === 0, 'gcc: error severity');
    assert(list[1].code === '-Wimplicit-function-declaration', 'gcc: keeps warning code');

    const problems = toBuildProblems(diags);
    assert(problems[0].line === 17, 'gcc: report line is 1-based');
    assert(problems[0].column === 25, 'gcc: report column matches compiler output');
    assert(problems[1].severity === 'warning', 'gcc: report warning severity');

    const armccLog = NodePath.join(baseDir, 'armcc.log');
    fs.writeFileSync(armccLog, [
        '>>> cc',
        '".\\source\\main.c", line 68: Error: #67: expected a "}"'
    ].join('\r\n'));
    const armcc = parseArmccCompilerLog(prj, new File(armccLog));
    const armccDiags = armcc['./source/main.c'];
    assert(armccDiags[0].range.start.character === 0,
        'armcc: missing column stays at character 0');
} finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
}

console.log('All problem matcher tests passed.');
export {};
