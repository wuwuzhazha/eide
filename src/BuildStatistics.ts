import { CallgraphVcg, VcgEdge, VcgNode } from './GccCallgraphParser';
import { FunctionStackUsageEntry, StackUsageDocument } from './GccStackUsageParser';

export interface BuildStatistics {
    callgraph: CallgraphVcg[];
    stackusage: StackUsageDocument[];
}

export interface StackUsageSummary {
    available: boolean;
    reason?: string;
    sumBytes: number;
    functions: FunctionStackUsageEntry[];
}

export function summarizeStackUsage(
    documents: StackUsageDocument[], topN: number): StackUsageSummary {
    const entries: FunctionStackUsageEntry[] = [];
    for (const doc of documents) {
        entries.push(...doc.entries);
    }
    if (entries.length === 0) {
        return {
            available: false,
            reason: 'No stack usage data. Build with -fstack-usage enabled and try again.',
            sumBytes: 0,
            functions: []
        };
    }
    entries.sort((a, b) => b.stackBytes - a.stackBytes);
    return {
        available: true,
        sumBytes: entries.reduce((sum, entry) => sum + entry.stackBytes, 0),
        functions: entries.slice(0, topN)
    };
}

export interface CallgraphNodeRef {
    title: string;
    label: string;
    file?: string;
    line?: number;
    column?: number;
    depth: number;
    parent?: string;
}

export interface CallgraphQueryResult {
    available: boolean;
    reason?: string;
    matches: CallgraphNodeRef[];
    callees: CallgraphNodeRef[];
    callers: CallgraphNodeRef[];
    truncated: boolean;
}

function nodeRef(node: VcgNode | undefined, title: string, depth: number, parent?: string): CallgraphNodeRef {
    return {
        title,
        label: node ? node.label : title,
        file: node?.location?.file,
        line: node?.location?.line,
        column: node?.location?.column,
        depth,
        parent
    };
}

function edgeKey(edge: VcgEdge): string {
    return `${edge.sourcename}\u0000${edge.targetname}\u0000${edge.label || ''}`;
}

function collectNodes(graphs: CallgraphVcg[]): Map<string, VcgNode> {
    const nodes = new Map<string, VcgNode>();
    for (const graph of graphs) {
        for (const node of graph.nodes) {
            if (!nodes.has(node.title)) {
                nodes.set(node.title, node);
            }
        }
    }
    return nodes;
}

function collectEdges(graphs: CallgraphVcg[]): VcgEdge[] {
    const seen = new Set<string>();
    const edges: VcgEdge[] = [];
    for (const graph of graphs) {
        for (const edge of graph.edges) {
            const key = edgeKey(edge);
            if (!seen.has(key)) {
                seen.add(key);
                edges.push(edge);
            }
        }
    }
    return edges;
}

function walk(
    seeds: string[],
    edges: VcgEdge[],
    nodes: Map<string, VcgNode>,
    useTarget: boolean,
    maxDepth: number,
    maxNodes: number
): { refs: CallgraphNodeRef[]; truncated: boolean } {
    const next = new Map<string, VcgEdge[]>();
    for (const edge of edges) {
        const key = useTarget ? edge.targetname : edge.sourcename;
        const list = next.get(key);
        if (list) {
            list.push(edge);
        } else {
            next.set(key, [edge]);
        }
    }
    const seen = new Set(seeds);
    const queue = seeds.map(title => ({ title, depth: 0 }));
    const refs: CallgraphNodeRef[] = [];
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth >= maxDepth) {
            continue;
        }
        for (const edge of next.get(current.title) || []) {
            const title = useTarget ? edge.sourcename : edge.targetname;
            if (seen.has(title)) {
                continue;
            }
            seen.add(title);
            refs.push(nodeRef(nodes.get(title), title, current.depth + 1, current.title));
            if (refs.length >= maxNodes) {
                return { refs, truncated: true };
            }
            queue.push({ title, depth: current.depth + 1 });
        }
    }
    return { refs, truncated: false };
}

export function queryCallgraph(
    graphs: CallgraphVcg[], symbol: string, depth: number, maxNodes = 200): CallgraphQueryResult {
    const nodes = collectNodes(graphs);
    const edges = collectEdges(graphs);
    if (nodes.size === 0) {
        return {
            available: false,
            reason: 'No callgraph data. Build with -fcallgraph-info enabled and try again.',
            matches: [],
            callees: [],
            callers: [],
            truncated: false
        };
    }
    const matches: string[] = [];
    for (const node of nodes.values()) {
        if (node.label === symbol || node.title === symbol || node.title.endsWith(`:${symbol}`)) {
            matches.push(node.title);
        }
    }
    const matchRefs = matches.map(title => nodeRef(nodes.get(title), title, 0));
    const callees = walk(matches, edges, nodes, false, depth, maxNodes);
    const callers = walk(matches, edges, nodes, true, depth, maxNodes);
    return {
        available: true,
        matches: matchRefs,
        callees: callees.refs,
        callers: callers.refs,
        truncated: callees.truncated || callers.truncated
    };
}
