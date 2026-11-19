import {
    MiAsyncRecord,
    MiParseError,
    MiRecord,
    MiRecordParser,
    MiResultRecord,
    MiStreamRecord,
    MiValue,
} from '../../src/core/debug/mi';

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
    console.log('OK:', message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
    assert(actual === expected, `${message} (expected ${String(expected)}, got ${String(actual)})`);
}

function asResult(record: MiRecord): MiResultRecord {
    assert(record.type === 'result', `record is result (got ${record.type})`);
    return record as MiResultRecord;
}

function asAsync(record: MiRecord): MiAsyncRecord {
    assert(record.type === 'async', `record is async (got ${record.type})`);
    return record as MiAsyncRecord;
}

function asStream(record: MiRecord): MiStreamRecord {
    assert(record.type === 'stream', `record is stream (got ${record.type})`);
    return record as MiStreamRecord;
}

function tupleValue(value: MiValue | undefined): MiTupleView {
    assert(value !== undefined && typeof value === 'object' && !Array.isArray(value), 'value is a tuple');
    return value as MiTupleView;
}

interface MiTupleView {
    [key: string]: MiValue;
}

function parseOne(line: string): MiRecord {
    const records = new MiRecordParser().feed(line);
    assertEqual(records.length, 1, 'one record parsed');
    return records[0];
}

const done = asResult(parseOne('123^done,value="0x20000000"\n'));
assertEqual(done.token, 123, 'result token');
assertEqual(done.class, 'done', 'result class');
assertEqual(done.results.value, '0x20000000', 'result string value');

const error = asResult(parseOne('^error,msg="No symbol table is loaded.  Use the \\"file\\" command."\n'));
assertEqual(error.token, undefined, 'untokened error record');
assertEqual(error.class, 'error', 'error class');
assertEqual(
    error.results.msg,
    'No symbol table is loaded.  Use the "file" command.',
    'escaped quotes decoded',
);

const stopped = asAsync(
    parseOne(
        '*stopped,reason="breakpoint-hit",disp="keep",bkptno="1",frame={addr="0x00401557",func="tick",args=[{name="v",value="0"}],line="2"},thread-id="1",stopped-threads="all"\n',
    ),
);
assertEqual(stopped.kind, '*', 'async kind');
assertEqual(stopped.class, 'stopped', 'async class');
assertEqual(stopped.results.reason, 'breakpoint-hit', 'async reason');
const frame = tupleValue(stopped.results.frame);
assertEqual(frame.func, 'tick', 'nested frame function');
const args = frame.args as MiValue[];
assert(Array.isArray(args) && args.length === 1, 'nested args list length');
const arg = tupleValue(args[0]);
assertEqual(arg.name, 'v', 'nested list tuple name');

const notification = asAsync(parseOne('=library-loaded,id="C:\\\\Windows\\\\a.dll",ranges=[{from="0x1000",to="0x1fff"}]\n'));
assertEqual(notification.kind, '=', 'notification kind');
assertEqual(notification.class, 'library-loaded', 'notification class');
assertEqual(notification.results.id, 'C:\\Windows\\a.dll', 'notification escaped path');
const ranges = notification.results.ranges as MiValue[];
assertEqual(tupleValue(ranges[0]).to, '0x1fff', 'bare tuple in list');

const status = asAsync(parseOne('+download,section=".text",size=4096\n'));
assertEqual(status.kind, '+', 'status kind');
assertEqual(status.results.size, 4096, 'bare integer in results');

const consoleStream = asStream(parseOne('~"Thread 1 hit Breakpoint 1, tick (v=0) at probe.c:2\\n"\n'));
assertEqual(consoleStream.kind, '~', 'console stream kind');
assertEqual(consoleStream.text, 'Thread 1 hit Breakpoint 1, tick (v=0) at probe.c:2\n', 'console stream text');

const logStream = asStream(parseOne('&"warning: source file is newer\\n"\n'));
assertEqual(logStream.kind, '&', 'log stream kind');
assertEqual(logStream.text, 'warning: source file is newer\n', 'log stream text');

const targetStream = asStream(parseOne('@"hello"\n'));
assertEqual(targetStream.kind, '@', 'target stream kind');
assertEqual(targetStream.text, 'hello', 'target stream text');

const prompt = parseOne('(gdb) \n');
assertEqual(prompt.type, 'prompt', 'prompt record');

const memory = asResult(parseOne('^done,memory=[{begin="0x20000000",offset="0x0",end="0x20000004",contents="deadbeef"}]\n'));
const blocks = memory.results.memory as MiValue[];
assertEqual(tupleValue(blocks[0]).contents, 'deadbeef', 'memory contents');

const stack = asResult(parseOne('^done,stack=[frame={level="0",addr="0x1"},frame={level="1",addr="0x2"}]\n'));
const stackFrames = stack.results.stack as MiValue[];
assertEqual(tupleValue(tupleValue(stackFrames[1]).frame).level, '1', 'named entries in list');

const tokenedAsync = asAsync(parseOne('77*stopped,reason="exited-normally"\n'));
assertEqual(tokenedAsync.token, 77, 'async token');
assertEqual(tokenedAsync.results.reason, 'exited-normally', 'async exit reason');

const escaped = asStream(parseOne('~"A\\101\\x42\\t\\e"\n'));
assertEqual(escaped.text, 'AAB\t\u001b', 'octal, hex, tab, and escape decoding');

const localized = asResult(
    parseOne(
        '^error,msg="localhost:1: \\347\\224\\261\\344\\272\\216\\347\\233\\256\\346\\240\\207\\350\\256\\241\\347\\256\\227\\346\\234\\272\\347\\247\\257\\346\\236\\201\\346\\213\\222\\347\\273\\235\\357\\274\\214\\346\\227\\240\\346\\263\\225\\350\\277\\236\\346\\216\\245\\343\\200\\202\\r\\n."\n',
    ),
);
assertEqual(
    localized.results.msg,
    'localhost:1: 由于目标计算机积极拒绝，无法连接。\r\n.',
    'octal escaped UTF-8 message decoded',
);

const parser = new MiRecordParser();
const firstChunk = parser.feed('1^do');
assertEqual(firstChunk.length, 0, 'partial chunk yields no record');
const secondChunk = parser.feed('ne,value="0x12\\');
assertEqual(secondChunk.length, 0, 'chunk split inside escape yields no record');
const thirdChunk = parser.feed('n34"\r');
assertEqual(thirdChunk.length, 0, 'CR without LF yields no record');
const fourthChunk = parser.feed('\n(gdb) \n*stop');
assertEqual(fourthChunk.length, 2, 'split CRLF prompt and partial async');
const splitResult = asResult(fourthChunk[0]);
assertEqual(splitResult.token, 1, 'split result token');
assertEqual(splitResult.results.value, '0x12\n34', 'split escape decoded');
assertEqual(fourthChunk[1].type, 'prompt', 'split CRLF prompt parsed');
const fifthChunk = parser.feed('ped,reason="signal-received"\n');
assertEqual(fifthChunk.length, 1, 'remaining async record completed');
assertEqual(asAsync(fifthChunk[0]).results.reason, 'signal-received', 'split async reason');

const blankParser = new MiRecordParser();
assertEqual(blankParser.feed('\r\n\n  \n(gdb) \n').length, 1, 'blank lines are ignored');

const asyncChunks = new MiRecordParser();
const asyncRecords = asyncChunks.feed('=thread-group-added,id="i1"\n(gdb) \n^done,x=1\n*stopped,reason="exited-normally"\n');
assertEqual(asyncRecords.length, 4, 'concatenated records');
assertEqual(asyncRecords[0].type, 'async', 'first concatenated record');
assertEqual(asyncRecords[1].type, 'prompt', 'second concatenated record');
assertEqual(asResult(asyncRecords[2]).results.x, 1, 'third concatenated record value');
assertEqual(asAsync(asyncRecords[3]).results.reason, 'exited-normally', 'fourth concatenated record reason');

let malformedThrew = false;
try {
    new MiRecordParser().feed('^done,value=oops\n');
} catch (err) {
    malformedThrew = err instanceof MiParseError;
}
assert(malformedThrew, 'malformed bare value throws MiParseError');

let unknownThrew = false;
try {
    new MiRecordParser().feed('not an MI record\n');
} catch (err) {
    unknownThrew = err instanceof MiParseError;
}
assert(unknownThrew, 'unknown record throws MiParseError');

let unterminatedThrew = false;
try {
    new MiRecordParser().feed('~"unterminated\n');
} catch (err) {
    unterminatedThrew = err instanceof MiParseError;
}
assert(unterminatedThrew, 'unterminated string throws MiParseError');

let duplicateThrew = false;
try {
    new MiRecordParser().feed('^done,x=1,x=2\n');
} catch (err) {
    duplicateThrew = err instanceof MiParseError;
}
assert(duplicateThrew, 'duplicate result field throws MiParseError');

let tokenStreamThrew = false;
try {
    new MiRecordParser().feed('1~"not allowed"\n');
} catch (err) {
    tokenStreamThrew = err instanceof MiParseError;
}
assert(tokenStreamThrew, 'token on stream record throws MiParseError');

let octalByteThrew = false;
try {
    new MiRecordParser().feed('~"\\777"\n');
} catch (err) {
    octalByteThrew = err instanceof MiParseError;
}
assert(octalByteThrew, 'octal escape above one byte throws MiParseError');

console.log('debug-mi-parser tests passed');
