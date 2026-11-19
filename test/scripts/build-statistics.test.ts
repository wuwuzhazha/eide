const {
    summarizeStackUsage,
    queryCallgraph
} = require('../../../src/BuildStatistics') as any;

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

const stackDocs = [{
    entries: [
        {
            location: { file: 'src/a.c', line: 10, column: 1 },
            functionName: 'small',
            stackBytes: 16,
            allocationType: 'static'
        },
        {
            location: { file: 'src/b.c', line: 20, column: 2 },
            functionName: 'large',
            stackBytes: 256,
            allocationType: 'static'
        },
        {
            location: { file: 'src/c.c', line: 30, column: 3 },
            functionName: 'medium',
            stackBytes: 64,
            allocationType: 'dynamic,bounded'
        }
    ]
}];

const top2 = summarizeStackUsage(stackDocs, 2);
assert(top2.available === true, 'stack: available');
assert(top2.sumBytes === 336, 'stack: sums all function frames');
assert(top2.functions.length === 2, 'stack: applies topN');
assert(top2.functions[0].functionName === 'large' && top2.functions[1].functionName === 'medium',
    'stack: sorted descending');
assert(summarizeStackUsage([], 20).available === false, 'stack: empty is unavailable');
assert(summarizeStackUsage([], 20).reason.includes('-fstack-usage'),
    'stack: reason names the required flag');

const graph = {
    graph: { title: 'demo' },
    nodes: [
        { title: 'src/main.o:main', label: 'main', location: { file: 'src/main.c', line: 10 } },
        { title: 'src/foo.o:foo', label: 'foo', location: { file: 'src/foo.c', line: 20 } },
        { title: 'src/bar.o:bar', label: 'bar' },
        { title: 'src/other.o:other', label: 'other' }
    ],
    edges: [
        { sourcename: 'src/main.o:main', targetname: 'src/foo.o:foo' },
        { sourcename: 'src/foo.o:foo', targetname: 'src/bar.o:bar' },
        { sourcename: 'src/bar.o:bar', targetname: 'src/main.o:main' },
        { sourcename: 'src/main.o:main', targetname: 'src/foo.o:foo' }
    ]
};

const result = queryCallgraph([graph], 'main', 2);
assert(result.available === true, 'callgraph: available');
assert(result.matches.length === 1 && result.matches[0].label === 'main',
    'callgraph: matches symbol by label');
assert(result.callees.length === 2, 'callgraph: finds direct and indirect callees');
assert(result.callees[0].label === 'foo' && result.callees[0].depth === 1,
    'callgraph: first callee depth 1');
assert(result.callees[1].label === 'bar' && result.callees[1].depth === 2,
    'callgraph: second callee depth 2');
assert(result.callers.length === 2, 'callgraph: finds direct and indirect callers');
assert(result.callers[0].label === 'bar' && result.callers[0].depth === 1,
    'callgraph: first caller depth 1');
assert(result.callers[1].label === 'foo' && result.callers[1].depth === 2,
    'callgraph: second caller depth 2');
assert(result.truncated === false, 'callgraph: not truncated');

const direct = queryCallgraph([graph], 'main', 1);
assert(direct.callees.length === 1 && direct.callees[0].label === 'foo',
    'callgraph: depth 1 keeps direct callees only');

const byTitle = queryCallgraph([graph], 'src/main.o:main', 1);
assert(byTitle.matches.length === 1, 'callgraph: matches full node title');

const missing = queryCallgraph([graph], 'not_exists', 2);
assert(missing.available === true && missing.matches.length === 0,
    'callgraph: unknown symbol is an empty result');

const empty = queryCallgraph([], 'main', 2);
assert(empty.available === false && empty.reason.includes('-fcallgraph-info'),
    'callgraph: empty graph names the required flag');

const truncated = queryCallgraph([graph], 'main', 2, 1);
assert(truncated.truncated === true, 'callgraph: reports truncation');

console.log('All build statistics tests passed.');

export {};
