const {
    extractCompilerLogLines,
    parseArmccProblems,
    parseCosmicStm8Problems,
    parseGccProblems,
    parseIarProblems,
    parseKeilc51Problems,
    parseSdccProblems,
    severityFromText
} = require('../../../src/core/problems') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

function log(...lines: string[]): string {
    return lines.join('\r\n');
}

const sections = extractCompilerLogLines(log(
    '>>> cc',
    'cc-line',
    '>>> ld',
    'ld-line',
    '>>> postbuild',
    'ignored-line'
));
assert(sections.join('|') === 'cc-line|ld-line', 'headless: extracts cc and ld log sections');

assert(severityFromText('ERROR') === 'error', 'headless: maps error text');
assert(severityFromText('fatal error') === 'error', 'headless: maps fatal error text');
assert(severityFromText('Warning') === 'warning', 'headless: maps warning text');
assert(severityFromText('note') === 'info', 'headless: maps note text to info');

const gcc = parseGccProblems(log(
    '>>> cc',
    "./src/main.c:17:25: error: expected expression before ';' token",
    "./src/main.c:40:9: warning: implicit declaration of function 'delay' [-Wimplicit-function-declaration]",
    './include/cfg.h:3:1: note: expected declaration'
), 'GCC');
assert(gcc.length === 3, 'headless gcc: parses all severities');
assert(gcc[0].file === './src/main.c', 'headless gcc: keeps raw file path');
assert(gcc[0].line === 17 && gcc[0].column === 25, 'headless gcc: keeps 1-based line and column');
assert(gcc[0].severity === 'error' && gcc[0].message === "expected expression before ';' token",
    'headless gcc: error severity and message');
assert(gcc[0].code === undefined, 'headless gcc: error has no code');
assert(gcc[0].rangeLength === 10 && gcc[0].source === 'arm-none-eabi-gcc',
    'headless gcc: keeps range length and source');
assert(gcc[1].severity === 'warning' && gcc[1].code === '-Wimplicit-function-declaration',
    'headless gcc: warning code');
assert(gcc[2].severity === 'info', 'headless gcc: note maps to info');
assert(parseGccProblems(log('>>> cc', './a.c:1:2: error: bad'), 'AC6')[0].source === 'armclang',
    'headless gcc: AC6 source');
assert(parseGccProblems(log('>>> cc', './a.c:1:2: error: bad'), 'RISCV_GCC')[0].source === 'riscv-gcc',
    'headless gcc: RISCV source');

const armcc = parseArmccProblems(log(
    '>>> cc',
    '".\\source\\main.c", line 68: Error: #67: expected a "}"',
    '".\\source\\main.c", line 69: Warning: suspicious declaration'
));
assert(armcc.length === 2, 'headless armcc: parses both patterns');
assert(armcc[0].file === '.\\source\\main.c' && armcc[0].line === 68 && armcc[0].column === 1,
    'headless armcc: 1-based line with implicit first column');
assert(armcc[0].severity === 'error' && armcc[0].code === '67'
    && armcc[0].message === 'expected a "}"', 'headless armcc: severity, code, message');
assert(armcc[0].source === 'armcc', 'headless armcc: source');
assert(armcc[1].code === undefined && armcc[1].severity === 'warning',
    'headless armcc: pattern without code');

const sdcc = parseSdccProblems(log(
    '>>> cc',
    ".\\src\\main.c:46: syntax error: token -> '}' ; column 11",
    '.\\src\\main.c:12:19: fatal error: reg52.h: No such file or directory',
    ".\\libraries\\stm8s_itc.c:61: warning 59: function 'ITC_GetCPUCC' must return value"
));
assert(sdcc.length === 3, 'headless sdcc: parses all lines');
assert(sdcc[0].line === 46 && sdcc[0].column === 11 && sdcc[0].severity === 'error',
    'headless sdcc: column from message');
assert(sdcc[0].message === "syntax error: token -> '}' ; column 11",
    'headless sdcc: keeps severity prefix in message');
assert(sdcc[1].line === 12 && sdcc[1].column === 19 && sdcc[1].severity === 'error',
    'headless sdcc: explicit line:column');
assert(sdcc[2].line === 61 && sdcc[2].column === 1 && sdcc[2].severity === 'warning'
    && sdcc[2].code === '59', 'headless sdcc: numeric code and implicit column');
assert(sdcc[0].source === 'sdcc', 'headless sdcc: source');

const keil = parseKeilc51Problems(log(
    '>>> cc',
    "*** ERROR C202 IN LINE 42 OF ..\\src\\main.c: 'x': undefined identifier"
));
assert(keil.length === 1, 'headless keil c51: parses line');
assert(keil[0].file === '..\\src\\main.c' && keil[0].line === 42 && keil[0].column === 1,
    'headless keil c51: 1-based line and implicit column');
assert(keil[0].severity === 'error' && keil[0].code === 'C202'
    && keil[0].message === "'x': undefined identifier", 'headless keil c51: fields');
assert(keil[0].source === 'keil-c51 compiler', 'headless keil c51: source');

const iar = parseIarProblems(log(
    '>>> cc',
    '"c:\\src\\main.c",65  Error[Pe065]:',
    '         expected a ";"',
    '"c:\\src\\main.c",107  Warning[Pe223]: function "LCD_2004_Init" declared implicitly'
), 'IAR_ARM');
assert(iar.length === 2, 'headless iar: parses both entries');
assert(iar[0].line === 65 && iar[0].column === 1 && iar[0].severity === 'error'
    && iar[0].code === 'Pe065' && iar[0].message === 'expected a ";"',
    'headless iar: continuation message line');
assert(iar[1].message === 'function "LCD_2004_Init" declared implicitly',
    'headless iar: inline message');
assert(iar[0].source === 'iccarm', 'headless iar: arm source');
assert(parseIarProblems(log('>>> cc', '"c:\\src\\main.c",5  Error[Pe065]: bad'), 'IAR_STM8')[0].source === 'iccstm8',
    'headless iar: stm8 source');

const cosmic = parseCosmicStm8Problems(log(
    '>>> cc',
    '#error cpstm8 .\\src\\main.c:54(14+3) bad struct/union operand',
    '#error cpstm8 .\\src\\main.c:33(25) incompatible compare types',
    '#error clnk acia.lkf:1 symbol f_recept not defined (vector.o )'
));
assert(cosmic.length === 3, 'headless cosmic: parses all lines');
assert(cosmic[0].line === 54 && cosmic[0].column === 14 && cosmic[0].rangeLength === 3,
    'headless cosmic: column range');
assert(cosmic[0].severity === 'error' && cosmic[0].message === 'bad struct/union operand',
    'headless cosmic: severity and message');
assert(cosmic[0].source === 'cosmic-stm8: cpstm8', 'headless cosmic: source with tool name');
assert(cosmic[1].column === 25 && cosmic[1].rangeLength === 1,
    'headless cosmic: single column');
assert(cosmic[2].line === 1 && cosmic[2].column === 1 && cosmic[2].rangeLength === 1
    && cosmic[2].source === 'cosmic-stm8: clnk', 'headless cosmic: linker entry without column');

console.log('All headless problem matcher tests passed.');
export {};
