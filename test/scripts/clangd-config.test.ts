import * as yaml from 'yaml';
import { updateClangdConfigText } from '../../src/ClangdConfig';

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

const multiFragment = `CompileFlags:
  Add:
    - -Wall
Diagnostics:
  Suppress: "*"
---
If:
  PathMatch: tests/.*
Index:
  Background: Skip
`;

const updated = updateClangdConfigText(multiFragment, cfg => {
    cfg['CompileFlags']['CompilationDatabase'] = './build';
    cfg['Diagnostics'] = { Suppress: '*' };
});
const docs = yaml.parseAllDocuments(updated);
assert(docs.length === 2, 'multi fragment: keeps both fragments');
const first: any = docs[0].toJS();
const second: any = docs[1].toJS();
assert(first.CompileFlags.CompilationDatabase === './build', 'multi fragment: updates unconditional fragment');
assert(first.CompileFlags.Add[0] === '-Wall', 'multi fragment: keeps existing flags');
assert(second.If.PathMatch === 'tests/.*', 'multi fragment: keeps If condition');
assert(second.Index.Background === 'Skip', 'multi fragment: keeps conditional fragment content');

const conditionalOnly = `If:
  PathMatch: tests/.*
Index:
  Background: Skip
`;
const updatedConditional = updateClangdConfigText(conditionalOnly, cfg => {
    cfg['CompileFlags'] = { Add: ['-Wall'] };
});
const conditionalDocs = yaml.parseAllDocuments(updatedConditional);
assert(conditionalDocs.length === 2, 'conditional only: adds unconditional fragment');
assert(conditionalDocs[0].has('If') === false, 'conditional only: new fragment is unconditional');
assert((conditionalDocs[0].toJS() as any).CompileFlags.Add[0] === '-Wall',
    'conditional only: applies project config to new fragment');
assert((conditionalDocs[1].toJS() as any).If.PathMatch === 'tests/.*',
    'conditional only: keeps original conditional fragment');

const updatedEmpty = updateClangdConfigText('', cfg => {
    cfg['CompileFlags'] = { Add: ['-Wall'] };
});
const emptyDocs = yaml.parseAllDocuments(updatedEmpty);
assert(emptyDocs.length === 1, 'empty file: creates one fragment');
assert((emptyDocs[0].toJS() as any).CompileFlags.Add[0] === '-Wall',
    'empty file: applies project config');

let parseError = false;
try {
    updateClangdConfigText('CompileFlags: [', () => undefined);
} catch {
    parseError = true;
}
assert(parseError, 'invalid yaml: propagates parse error');
