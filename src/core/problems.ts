export type BuildProblemSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface BuildProblem {
    file: string;
    line: number;
    column: number;
    severity: BuildProblemSeverity;
    code?: string;
    message: string;
}

export interface ParsedProblem extends BuildProblem {
    rangeLength: number;
    source: string;
}

export function severityFromText(text: string): BuildProblemSeverity {
    const value = text.toLowerCase();
    if (value.startsWith('err') || value.startsWith('fatal') || value.includes('error')) {
        return 'error';
    }
    if (value.startsWith('warn') || value.includes('warning')) {
        return 'warning';
    }
    return 'info';
}

function toOneBased(value: number): number {
    return value > 0 ? value : 1;
}

function extractSection(lines: string[], marker: string): string[] {
    const section: string[] = [];
    let started = false;
    for (const line of lines) {
        if (!started) {
            if (line.startsWith(marker)) {
                started = true;
            }
            continue;
        }
        if (line.startsWith('>>>')) {
            break;
        }
        section.push(line);
    }
    return section;
}

export function extractCompilerLogLines(logText: string): string[] {
    const lines = logText.split(/\r\n|\n/);
    return extractSection(lines, '>>> cc').concat(extractSection(lines, '>>> ld'));
}

const gccPattern = /^(.+):(\d+):(\d+):([^:]+):\s+(.*)$/i;

function gccSource(toolchain: string): string {
    switch (toolchain) {
        case 'AC6':
            return 'armclang';
        case 'GCC':
            return 'arm-none-eabi-gcc';
        case 'RISCV_GCC':
            return 'riscv-gcc';
        default:
            return 'gcc';
    }
}

export function parseGccProblems(logText: string, toolchain: string): ParsedProblem[] {
    const problems: ParsedProblem[] = [];
    for (const line of extractCompilerLogLines(logText)) {
        const m = gccPattern.exec(line);
        if (!m) {
            continue;
        }
        const message = m[5].trim();
        let code: string | undefined;
        if (message.includes('[')) {
            const codeMatch = /\[([\w-]+)\]\s*$/.exec(message);
            if (codeMatch) {
                code = codeMatch[1].trim();
            }
        }
        problems.push({
            file: m[1],
            line: toOneBased(parseInt(m[2])),
            column: toOneBased(parseInt(m[3])),
            rangeLength: 10,
            severity: severityFromText(m[4].trim()),
            code,
            message,
            source: gccSource(toolchain)
        });
    }
    return problems;
}

const armccPatterns: { regexp: RegExp; hasCode: boolean }[] = [
    { regexp: /^"([^"]+)", line (\d+): (Error|Warning):\s+#([^\s]+):\s+(.+)$/i, hasCode: true },
    { regexp: /^"([^"]+)", line (\d+): (Error|Warning|\w+):\s+(.+)$/i, hasCode: false }
];

export function parseArmccProblems(logText: string): ParsedProblem[] {
    const problems: ParsedProblem[] = [];
    for (const line of extractCompilerLogLines(logText)) {
        for (const pattern of armccPatterns) {
            const m = pattern.regexp.exec(line);
            if (!m) {
                continue;
            }
            problems.push({
                file: m[1],
                line: toOneBased(parseInt(m[2])),
                column: 1,
                rangeLength: 10,
                severity: severityFromText(m[3]),
                code: pattern.hasCode ? m[4].trim() : undefined,
                message: (pattern.hasCode ? m[5] : m[4]).trim(),
                source: 'armcc'
            });
            break;
        }
    }
    return problems;
}

const sdccPattern = /^(.{2}[^:]+):(\d+(?::\d+)?):\s([^:]+):\s+(.*)$/i;

export function parseSdccProblems(logText: string): ParsedProblem[] {
    const problems: ParsedProblem[] = [];
    for (const line of extractCompilerLogLines(logText)) {
        const m = sdccPattern.exec(line);
        if (!m) {
            continue;
        }
        const lineCol = m[2].trim();
        const severityText = m[3].trim();
        const message = m[4].trim();
        const codeMatch = /\s+(\d+)$/.exec(severityText);
        let lineNo: number;
        let column: number | undefined;
        if (lineCol.includes(':')) {
            const parts = lineCol.split(':');
            lineNo = parseInt(parts[0]);
            column = parseInt(parts[1]);
        } else {
            lineNo = parseInt(lineCol);
            const columnMatch = /column\s+(\d+)$/.exec(message);
            if (columnMatch) {
                column = parseInt(columnMatch[1]);
            }
        }
        problems.push({
            file: m[1],
            line: toOneBased(lineNo),
            column: toOneBased(column === undefined ? 0 : column),
            rangeLength: 10,
            severity: severityFromText(severityText),
            code: codeMatch ? codeMatch[1] : undefined,
            message: `${severityText}: ${message}`,
            source: 'sdcc'
        });
    }
    return problems;
}

const keilC51Pattern = /(ERROR|WARNING) (\w+) IN LINE (\d+) OF ([^:]+): (.+)/i;

export function parseKeilc51Problems(logText: string): ParsedProblem[] {
    const problems: ParsedProblem[] = [];
    for (const line of extractCompilerLogLines(logText)) {
        const m = keilC51Pattern.exec(line);
        if (!m) {
            continue;
        }
        problems.push({
            file: m[4],
            line: toOneBased(parseInt(m[3])),
            column: 1,
            rangeLength: 10,
            severity: severityFromText(m[1]),
            code: m[2].trim(),
            message: m[5].trim(),
            source: 'keil-c51 compiler'
        });
    }
    return problems;
}

const iarPattern = /^\s*"([^"]+)",(\d+)\s+([a-z\s]+)\[(\w+)\]:(.+)?/i;

export function parseIarProblems(logText: string, toolchain: string): ParsedProblem[] {
    const lines = extractCompilerLogLines(logText);
    const problems: ParsedProblem[] = [];
    for (let index = 0; index < lines.length; index++) {
        const m = iarPattern.exec(lines[index]);
        if (!m) {
            continue;
        }
        let message = m[5]?.trim();
        if (!message) {
            message = lines[++index].trim();
        }
        problems.push({
            file: m[1],
            line: toOneBased(parseInt(m[2])),
            column: 1,
            rangeLength: 10,
            severity: severityFromText(m[3].trim()),
            code: m[4].trim(),
            message,
            source: toolchain === 'IAR_STM8' ? 'iccstm8' : 'iccarm'
        });
    }
    return problems;
}

const cosmicPattern = /^\s*#(\w+) (\w+) (.+?):(\d+)(\(\d+(?:\+\d+)?\))? (.+)/i;

export function parseCosmicStm8Problems(logText: string): ParsedProblem[] {
    const problems: ParsedProblem[] = [];
    for (const line of extractCompilerLogLines(logText)) {
        const m = cosmicPattern.exec(line);
        if (!m) {
            continue;
        }
        const toolname = m[2].trim();
        const columnText = m[5]?.trim();
        let column = 0;
        let rangeLength = 1;
        if (columnText && columnText.length > 2) {
            if (columnText.includes('+')) {
                const columnMatch = /(\d+)\+(\d+)/.exec(columnText);
                if (columnMatch) {
                    column = parseInt(columnMatch[1]);
                    rangeLength = parseInt(columnMatch[2]);
                }
            } else {
                column = parseInt(columnText.substring(1, columnText.length - 1));
            }
        }
        problems.push({
            file: m[3],
            line: toOneBased(parseInt(m[4])),
            column: toOneBased(column),
            rangeLength,
            severity: severityFromText(m[1]),
            message: m[6].trim(),
            source: `cosmic-stm8: ${toolname}`
        });
    }
    return problems;
}
