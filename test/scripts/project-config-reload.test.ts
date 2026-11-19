import { canApplyProjectConfigInPlace, hasExternalConfigChange } from '../../src/ProjectConfigReload';

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

const compareJson = (a: string, b: string): boolean => JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));

assert(hasExternalConfigChange('{"a":1}', '{"a":1}', compareJson) === false,
    'hasExternalConfigChange: identical content is not a change');
assert(hasExternalConfigChange('{\n  "a": 1\n}', '{"a":1}', compareJson) === false,
    'hasExternalConfigChange: format-only difference is not a change');
assert(hasExternalConfigChange('{"a":2}', '{"a":1}', compareJson) === true,
    'hasExternalConfigChange: semantic difference is a change');
assert(hasExternalConfigChange('{"a":1}', undefined, compareJson) === true,
    'hasExternalConfigChange: missing sync state is a change');
assert(hasExternalConfigChange('{bad', '{"a":1}', compareJson) === true,
    'hasExternalConfigChange: unparsable content is a change');

const base = {
    type: 'ARM',
    toolchain: 'GCC',
    uploader: 'JLink',
    uid: 'project-uid',
    version: '4.1'
};

assert(canApplyProjectConfigInPlace(base, { ...base }) === true,
    'canApplyProjectConfigInPlace: identical identity can reload in place');
assert(canApplyProjectConfigInPlace(base, { ...base, type: 'C51' }) === false,
    'canApplyProjectConfigInPlace: type change requires reopen');
assert(canApplyProjectConfigInPlace(base, { ...base, toolchain: 'AC6' }) === false,
    'canApplyProjectConfigInPlace: toolchain change requires reopen');
assert(canApplyProjectConfigInPlace(base, { ...base, uploader: 'STLink' }) === false,
    'canApplyProjectConfigInPlace: uploader change requires reopen');
assert(canApplyProjectConfigInPlace(base, { ...base, uid: 'other-uid' }) === false,
    'canApplyProjectConfigInPlace: uid change requires reopen');
assert(canApplyProjectConfigInPlace(base, { ...base, version: '4.0' }) === false,
    'canApplyProjectConfigInPlace: version change requires reopen');
