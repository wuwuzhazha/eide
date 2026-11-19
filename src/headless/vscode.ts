let installed = false;

export function installVscodeShim(): void {
    if (installed) {
        return;
    }
    const format = require('util').format as (...args: unknown[]) => string;
    console.log = (...args: unknown[]) => process.stderr.write(format(...args) + '\n');
    console.info = console.log;
    const Module = require('module') as {
        _load(request: string, parent: unknown, isMain: boolean): unknown;
    };
    const original = Module._load;
    Module._load = function (request: string, parent: unknown, isMain: boolean): unknown {
        if (request === 'vscode') {
            return require('./vscode_shim').default;
        }
        return original.call(this, request, parent, isMain);
    };
    installed = true;
}
