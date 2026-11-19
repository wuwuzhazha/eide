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

const {
    parseGccCompilerLog,
    parseArmccCompilerLog,
    parseSdccCompilerLog,
    parseKeilc51CompilerLog,
    parseIarCompilerLog,
    parseCosmicStm8CompilerLog
} = require('../../../src/ProblemMatcher') as any;
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

    const sdccLog = NodePath.join(baseDir, 'sdcc.log');
    fs.writeFileSync(sdccLog, [
        '>>> cc',
        '.\\src\\main.c:12:19: fatal error: reg52.h: No such file or directory',
        ".\\libraries\\stm8s_itc.c:61: warning 59: function 'ITC_GetCPUCC' must return value"
    ].join('\r\n'));
    const sdcc = parseSdccCompilerLog(prj, new File(sdccLog));
    const sdccDiags = sdcc['./src/main.c'];
    assert(sdccDiags[0].range.start.line === 11 && sdccDiags[0].range.start.character === 18,
        'sdcc: converts 1-based line and column to 0-based');
    assert(sdccDiags[0].range.end.character === 28, 'sdcc: keeps ten character range length');
    assert(sdccDiags[0].severity === 0
        && sdccDiags[0].message === 'fatal error: reg52.h: No such file or directory',
        'sdcc: fatal error severity and prefixed message');
    assert(sdccDiags[0].source === 'sdcc', 'sdcc: source');
    const sdccWarning = sdcc['./libraries/stm8s_itc.c'][0];
    assert(sdccWarning.range.start.character === 0 && sdccWarning.code === '59'
        && sdccWarning.severity === 1, 'sdcc: implicit column and numeric code');

    const keilLog = NodePath.join(baseDir, 'keil.log');
    fs.writeFileSync(keilLog, [
        '>>> cc',
        "*** ERROR C202 IN LINE 42 OF ..\\src\\main.c: 'x': undefined identifier"
    ].join('\r\n'));
    const keil = parseKeilc51CompilerLog(prj, new File(keilLog));
    const keilDiag = keil['../src/main.c'][0];
    assert(keilDiag.range.start.line === 41 && keilDiag.range.start.character === 0,
        'keil c51: 0-based line and first column');
    assert(keilDiag.severity === 0 && keilDiag.code === 'C202'
        && keilDiag.source === 'keil-c51 compiler', 'keil c51: severity, code and source');

    const iarLog = NodePath.join(baseDir, 'iar.log');
    fs.writeFileSync(iarLog, [
        '>>> cc',
        '"c:\\src\\main.c",65  Error[Pe065]:',
        '         expected a ";"'
    ].join('\r\n'));
    const iar = parseIarCompilerLog({ ...prj, toolchainName: () => 'IAR_ARM' }, new File(iarLog));
    const iarDiag = iar['c:/src/main.c'][0];
    assert(iarDiag.range.start.line === 64 && iarDiag.message === 'expected a ";"',
        'iar: 0-based line and continuation message');
    assert(iarDiag.code === 'Pe065' && iarDiag.source === 'iccarm',
        'iar: code and source');

    const cosmicLog = NodePath.join(baseDir, 'cosmic.log');
    fs.writeFileSync(cosmicLog, [
        '>>> cc',
        '#error cpstm8 .\\src\\main.c:54(14+3) bad struct/union operand'
    ].join('\r\n'));
    const cosmic = parseCosmicStm8CompilerLog(prj, new File(cosmicLog));
    const cosmicDiag = cosmic['./src/main.c'][0];
    assert(cosmicDiag.range.start.line === 53 && cosmicDiag.range.start.character === 13
        && cosmicDiag.range.end.character === 16, 'cosmic: 1-based column and range width');
    assert(cosmicDiag.source === 'cosmic-stm8: cpstm8',
        'cosmic: source includes tool name');
} finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
}

console.log('All problem matcher tests passed.');
export {};
