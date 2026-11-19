export type MiValue = string | number | MiValue[] | MiTuple;

export interface MiTuple {
    [key: string]: MiValue;
}

export interface MiPromptRecord {
    type: 'prompt';
}

export interface MiResultRecord {
    type: 'result';
    token?: number;
    class: string;
    results: MiTuple;
}

export interface MiAsyncRecord {
    type: 'async';
    token?: number;
    kind: '*' | '=' | '+';
    class: string;
    results: MiTuple;
}

export interface MiStreamRecord {
    type: 'stream';
    kind: '~' | '@' | '&';
    text: string;
}

export type MiRecord = MiPromptRecord | MiResultRecord | MiAsyncRecord | MiStreamRecord;

export class MiParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MiParseError';
    }
}

export class MiRecordParser {
    private buffered = '';

    feed(chunk: string): MiRecord[] {
        this.buffered += chunk;
        const records: MiRecord[] = [];
        let newline = this.buffered.indexOf('\n');
        while (newline >= 0) {
            let line = this.buffered.slice(0, newline);
            this.buffered = this.buffered.slice(newline + 1);
            if (line.endsWith('\r')) {
                line = line.slice(0, -1);
            }
            const record = parseMiLine(line);
            if (record !== undefined) {
                records.push(record);
            }
            newline = this.buffered.indexOf('\n');
        }
        return records;
    }
}

function parseMiLine(line: string): MiRecord | undefined {
    const trimmed = line.trim();
    if (trimmed === '') {
        return undefined;
    }
    if (trimmed === '(gdb)') {
        return { type: 'prompt' };
    }

    let cursor = 0;
    let token: number | undefined;
    const tokenMatch = /^\d+/.exec(line);
    if (tokenMatch !== null) {
        token = Number(tokenMatch[0]);
        if (!Number.isSafeInteger(token)) {
            throw new MiParseError(`token is not a safe integer: ${tokenMatch[0]}`);
        }
        cursor = tokenMatch[0].length;
    }

    const kind = line[cursor];
    if (kind === '~' || kind === '@' || kind === '&') {
        if (token !== undefined) {
            throw new MiParseError('stream record cannot carry a token');
        }
        const stream = parseCString(line, cursor + 1);
        const end = skipSpaces(line, stream.next);
        if (end !== line.length) {
            throw new MiParseError(`unexpected data after stream record: ${line.slice(end)}`);
        }
        return { type: 'stream', kind, text: stream.value };
    }

    if (kind === '^') {
        const body = parseRecordBody(line, cursor + 1);
        return { type: 'result', token, class: body.class, results: body.results };
    }

    if (kind === '*' || kind === '=' || kind === '+') {
        const body = parseRecordBody(line, cursor + 1);
        return { type: 'async', token, kind, class: body.class, results: body.results };
    }

    throw new MiParseError(`unknown MI record: ${line}`);
}

function parseRecordBody(line: string, index: number): { class: string; results: MiTuple } {
    const classMatch = /^[A-Za-z][A-Za-z0-9_.-]*/.exec(line.slice(index));
    if (classMatch === null) {
        throw new MiParseError(`missing MI record class: ${line}`);
    }
    let cursor = index + classMatch[0].length;
    cursor = skipSpaces(line, cursor);
    let results: MiTuple = {};
    if (line[cursor] === ',') {
        const parsed = parseResults(line, cursor + 1);
        results = parsed.value;
        cursor = parsed.next;
    }
    cursor = skipSpaces(line, cursor);
    if (cursor !== line.length) {
        throw new MiParseError(`unexpected data after MI record: ${line.slice(cursor)}`);
    }
    return { class: classMatch[0], results };
}

function parseResults(text: string, index: number): { value: MiTuple; next: number } {
    const value: MiTuple = {};
    let cursor = skipSpaces(text, index);
    for (;;) {
        const entry = parseKeyValue(text, cursor);
        if (Object.prototype.hasOwnProperty.call(value, entry.key)) {
            throw new MiParseError(`duplicate MI result field: ${entry.key}`);
        }
        value[entry.key] = entry.value;
        cursor = skipSpaces(text, entry.next);
        if (cursor >= text.length) {
            return { value, next: cursor };
        }
        if (text[cursor] !== ',') {
            throw new MiParseError(`expected ',' between MI results: ${text.slice(cursor)}`);
        }
        cursor = skipSpaces(text, cursor + 1);
        if (cursor >= text.length) {
            throw new MiParseError('trailing comma in MI results');
        }
    }
}

function parseTuple(text: string, index: number): { value: MiTuple; next: number } {
    const value: MiTuple = {};
    let cursor = skipSpaces(text, index + 1);
    if (text[cursor] === '}') {
        return { value, next: cursor + 1 };
    }
    for (;;) {
        const entry = parseKeyValue(text, cursor);
        if (Object.prototype.hasOwnProperty.call(value, entry.key)) {
            throw new MiParseError(`duplicate MI tuple field: ${entry.key}`);
        }
        value[entry.key] = entry.value;
        cursor = skipSpaces(text, entry.next);
        if (text[cursor] === '}') {
            return { value, next: cursor + 1 };
        }
        if (text[cursor] !== ',') {
            throw new MiParseError(`expected ',' between MI tuple fields: ${text.slice(cursor)}`);
        }
        cursor = skipSpaces(text, cursor + 1);
        if (text[cursor] === '}') {
            throw new MiParseError('trailing comma in MI tuple');
        }
    }
}

function parseList(text: string, index: number): { value: MiValue[]; next: number } {
    const value: MiValue[] = [];
    let cursor = skipSpaces(text, index + 1);
    if (text[cursor] === ']') {
        return { value, next: cursor + 1 };
    }
    for (;;) {
        const named = parseNamedEntry(text, cursor);
        if (named !== undefined) {
            value.push({ [named.key]: named.value });
            cursor = named.next;
        } else {
            const parsed = parseValue(text, cursor);
            value.push(parsed.value);
            cursor = parsed.next;
        }
        cursor = skipSpaces(text, cursor);
        if (text[cursor] === ']') {
            return { value, next: cursor + 1 };
        }
        if (text[cursor] !== ',') {
            throw new MiParseError(`expected ',' between MI list values: ${text.slice(cursor)}`);
        }
        cursor = skipSpaces(text, cursor + 1);
        if (text[cursor] === ']') {
            throw new MiParseError('trailing comma in MI list');
        }
    }
}

function parseNamedEntry(
    text: string,
    index: number,
): { key: string; value: MiValue; next: number } | undefined {
    const named = /^[A-Za-z_][A-Za-z0-9_.-]*\s*=/.exec(text.slice(index));
    if (named === null) {
        return undefined;
    }
    return parseKeyValue(text, index);
}

function parseKeyValue(
    text: string,
    index: number,
): { key: string; value: MiValue; next: number } {
    const cursor = skipSpaces(text, index);
    const keyMatch = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(text.slice(cursor));
    if (keyMatch === null) {
        throw new MiParseError(`missing MI result name: ${text.slice(cursor)}`);
    }
    let next = skipSpaces(text, cursor + keyMatch[0].length);
    if (text[next] !== '=') {
        throw new MiParseError(`expected '=' after MI result name: ${keyMatch[0]}`);
    }
    const parsed = parseValue(text, next + 1);
    return { key: keyMatch[0], value: parsed.value, next: parsed.next };
}

function parseValue(text: string, index: number): { value: MiValue; next: number } {
    const cursor = skipSpaces(text, index);
    const kind = text[cursor];
    if (kind === '"') {
        return parseCString(text, cursor);
    }
    if (kind === '{') {
        return parseTuple(text, cursor);
    }
    if (kind === '[') {
        return parseList(text, cursor);
    }
    return parseIntegerValue(text, cursor);
}

function parseIntegerValue(text: string, index: number): { value: number; next: number } {
    let cursor = index;
    while (cursor < text.length && text[cursor] !== ',' && text[cursor] !== '}' && text[cursor] !== ']') {
        cursor++;
    }
    const raw = text.slice(index, cursor).trim();
    if (!/^-?\d+$/.test(raw)) {
        throw new MiParseError(`invalid MI value: ${raw}`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) {
        throw new MiParseError(`MI integer is not a safe integer: ${raw}`);
    }
    return { value, next: cursor };
}

function parseCString(text: string, index: number): { value: string; next: number } {
    if (text[index] !== '"') {
        throw new MiParseError(`expected MI string: ${text.slice(index)}`);
    }
    let value = '';
    let cursor = index + 1;
    while (cursor < text.length) {
        const ch = text[cursor++];
        if (ch === '"') {
            return { value, next: cursor };
        }
        if (ch !== '\\') {
            value += ch;
            continue;
        }
        if (cursor >= text.length) {
            throw new MiParseError('unterminated MI string escape');
        }
        const escape = text[cursor++];
        switch (escape) {
            case 'a':
                value += '\u0007';
                break;
            case 'b':
                value += '\b';
                break;
            case 'e':
                value += '\u001b';
                break;
            case 'f':
                value += '\f';
                break;
            case 'n':
                value += '\n';
                break;
            case 'r':
                value += '\r';
                break;
            case 't':
                value += '\t';
                break;
            case 'v':
                value += '\v';
                break;
            case '"':
                value += '"';
                break;
            case '\'':
                value += '\'';
                break;
            case '?':
                value += '?';
                break;
            case '\\':
                value += '\\';
                break;
            case 'x': {
                let digits = '';
                while (digits.length < 2 && cursor < text.length && /[0-9a-fA-F]/.test(text[cursor])) {
                    digits += text[cursor++];
                }
                if (digits.length === 0) {
                    throw new MiParseError('invalid hexadecimal MI string escape');
                }
                value += String.fromCharCode(parseInt(digits, 16));
                break;
            }
            default: {
                if (escape < '0' || escape > '7') {
                    throw new MiParseError(`unsupported MI string escape: \\${escape}`);
                }
                let digits = escape;
                while (digits.length < 3 && cursor < text.length && text[cursor] >= '0' && text[cursor] <= '7') {
                    digits += text[cursor++];
                }
                value += String.fromCharCode(parseInt(digits, 8));
            }
        }
    }
    throw new MiParseError('unterminated MI string');
}

function skipSpaces(text: string, index: number): number {
    let cursor = index;
    while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t')) {
        cursor++;
    }
    return cursor;
}
