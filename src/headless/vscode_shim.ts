import type * as VSCode from 'vscode';

export interface HeadlessMemento {
    get<T>(key: string, defaultValue?: T): T | undefined;
    update(key: string, value: unknown): Promise<void>;
    keys(): readonly string[];
    setKeysForSync?(keys: readonly string[]): void;
}

export interface HeadlessVscodeConfig {
    settings: { [key: string]: unknown };
    workspaceRoot?: string;
    workspaceFile?: string;
    workspaceState: HeadlessMemento;
    globalState: HeadlessMemento;
    language?: string;
}

let config: HeadlessVscodeConfig | undefined;
const configurationListeners = new Set<(event: VSCode.ConfigurationChangeEvent) => void>();

function changedSettingKeys(
    previous: { [key: string]: unknown },
    next: { [key: string]: unknown }
): string[] {
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    const changed: string[] = [];
    for (const key of keys) {
        if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
            changed.push(key);
        }
    }
    return changed;
}

function notifyConfigurationChanged(changed: string[]): void {
    if (changed.length === 0 || configurationListeners.size === 0) {
        return;
    }
    const event = {
        affectsConfiguration(section: string): boolean {
            if (section === 'EIDE') {
                return changed.length > 0;
            }
            const key = section.startsWith('EIDE.') ? section.slice('EIDE.'.length) : section;
            return changed.some(setting => setting === key || setting.startsWith(`${key}.`));
        }
    };
    for (const listener of Array.from(configurationListeners)) {
        listener(event as VSCode.ConfigurationChangeEvent);
    }
}

export function configureHeadlessVscode(next: HeadlessVscodeConfig): void {
    const changed = config === undefined
        ? []
        : changedSettingKeys(config.settings, next.settings);
    config = next;
    notifyConfigurationChanged(changed);
}

function requireConfig(): HeadlessVscodeConfig {
    if (!config) {
        throw new Error('Headless VS Code host is not configured.');
    }
    return config;
}

function unsupported(name: string): never {
    throw new Error(`'${name}' is not available in headless mode.`);
}

function disposable(): { dispose(): void } {
    return { dispose() { /* no resources */ } };
}

function uri(path: string): any {
    return {
        scheme: 'file',
        fsPath: path,
        path: path.replace(/\\/g, '/'),
        toString: () => `file:///${path.replace(/\\/g, '/')}`
    };
}

const env = {
    get language(): string {
        return config?.language ?? 'en';
    },
    get shell(): string {
        return process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    },
    appName: 'eide-headless',
    machineId: 'eide-headless',
    sessionId: 'eide-headless',
    uiKind: 1
};

const workspaceConfiguration = {
    get<T>(key: string, defaultValue?: T): T | undefined {
        const settings = requireConfig().settings;
        return Object.prototype.hasOwnProperty.call(settings, key)
            ? settings[key] as T
            : defaultValue;
    },
    has(key: string): boolean {
        return Object.prototype.hasOwnProperty.call(requireConfig().settings, key);
    },
    inspect(): undefined {
        return undefined;
    },
    update(): Thenable<void> {
        return Promise.reject(new Error('Headless mode does not write VS Code settings.'));
    }
};

const workspace = {
    get workspaceFile(): any {
        const path = requireConfig().workspaceFile;
        return path === undefined ? undefined : uri(path);
    },
    get workspaceFolders(): any {
        const root = requireConfig().workspaceRoot;
        return root === undefined
            ? undefined
            : [{
                uri: uri(root),
                name: root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root,
                index: 0
            }];
    },
    get rootPath(): string | undefined {
        return requireConfig().workspaceRoot;
    },
    getConfiguration(): typeof workspaceConfiguration {
        return workspaceConfiguration;
    },
    onDidChangeConfiguration(
        listener: (event: VSCode.ConfigurationChangeEvent) => void
    ): { dispose(): void } {
        configurationListeners.add(listener);
        return {
            dispose: () => {
                configurationListeners.delete(listener);
            }
        };
    },
    onDidChangeWorkspaceFolders(): { dispose(): void } {
        return disposable();
    },
    onDidSaveTextDocument(): { dispose(): void } {
        return disposable();
    },
    onDidOpenTextDocument(): { dispose(): void } {
        return disposable();
    },
    onDidCloseTextDocument(): { dispose(): void } {
        return disposable();
    },
    onDidCreateFiles(): { dispose(): void } {
        return disposable();
    },
    onDidDeleteFiles(): { dispose(): void } {
        return disposable();
    },
    onDidRenameFiles(): { dispose(): void } {
        return disposable();
    },
    openTextDocument(): Thenable<never> {
        return Promise.reject(new Error('Opening documents is not available in headless mode.'));
    },
    findFiles(): Thenable<never> {
        return Promise.reject(new Error('Workspace file search is not available in headless mode.'));
    },
    applyEdit(): Thenable<never> {
        return Promise.reject(new Error('Workspace edits are not available in headless mode.'));
    },
    getWorkspaceFolder(): undefined {
        return undefined;
    }
};

const windowApi = {
    get activeTextEditor(): undefined {
        return undefined;
    },
    get terminals(): never[] {
        return [];
    },
    showWarningMessage(): Thenable<undefined> {
        return Promise.resolve(undefined);
    },
    showErrorMessage(): Thenable<undefined> {
        return Promise.resolve(undefined);
    },
    showInformationMessage(): Thenable<undefined> {
        return Promise.resolve(undefined);
    },
    showQuickPick(): Thenable<never> {
        return Promise.reject(new Error('Quick pick is not available in headless mode.'));
    },
    showInputBox(): Thenable<never> {
        return Promise.reject(new Error('Input boxes are not available in headless mode.'));
    },
    showOpenDialog(): Thenable<never> {
        return Promise.reject(new Error('File dialogs are not available in headless mode.'));
    },
    showSaveDialog(): Thenable<never> {
        return Promise.reject(new Error('File dialogs are not available in headless mode.'));
    },
    withProgress(_options: unknown, task: (progress: any) => Thenable<unknown>): Thenable<unknown> {
        return task({ report() { /* no progress UI */ } });
    },
    createOutputChannel(): any {
        return {
            append() { /* no output panel */ },
            appendLine() { /* no output panel */ },
            replace() { /* no output panel */ },
            clear() { /* no output panel */ },
            show() { /* no output panel */ },
            hide() { /* no output panel */ },
            dispose() { /* no resources */ }
        };
    },
    createStatusBarItem(): any {
        return {
            text: '',
            tooltip: '',
            command: '',
            show() { /* no status bar */ },
            hide() { /* no status bar */ },
            dispose() { /* no resources */ }
        };
    },
    createTerminal(): never {
        return unsupported('window.createTerminal');
    },
    showTextDocument(): Thenable<never> {
        return Promise.reject(new Error('Showing documents is not available in headless mode.'));
    },
    createTreeView(): any {
        return { dispose() { /* no resources */ }, onDidChangeSelection: () => disposable() };
    },
    registerTreeDataProvider(): any {
        return disposable();
    },
    registerWebviewViewProvider(): any {
        return disposable();
    },
    createWebviewPanel(): never {
        return unsupported('window.createWebviewPanel');
    }
};

const commands = {
    registerCommand(): any {
        return disposable();
    },
    executeCommand(): Thenable<never> {
        return Promise.reject(new Error('Executing VS Code commands is not available in headless mode.'));
    },
    getCommands(): Thenable<string[]> {
        return Promise.resolve([]);
    }
};

const languages = {
    createDiagnosticCollection(): any {
        return {
            clear() { /* no diagnostics UI */ },
            set() { /* no diagnostics UI */ },
            delete() { /* no diagnostics UI */ },
            dispose() { /* no resources */ }
        };
    },
    registerCodeActionsProvider(): any {
        return disposable();
    },
    registerHoverProvider(): any {
        return disposable();
    },
    registerCompletionItemProvider(): any {
        return disposable();
    }
};

class Position {
    constructor(public line: number, public character: number) { }
}

class Range {
    constructor(public start: Position, public end: Position) { }
}

class Diagnostic {
    constructor(public range: Range, public message: string, public severity: number) { }
}

class EventEmitter<T = unknown> {
    event = (_listener: (value: T) => void) => disposable();
    fire(_value?: T): void { /* no listeners */ }
    dispose(): void { /* no resources */ }
}

class Disposable {
    constructor(private readonly callback?: () => void) { }
    dispose(): void {
        this.callback?.();
    }
}

class ThemeIcon {
    constructor(public id: string) { }
}

class TreeItem {
    constructor(public label: string) { }
}

class MarkdownString {
    value = '';
}

class Task {
    constructor(public definition?: unknown, public scope?: unknown, public name?: string) { }
}

class ShellExecution {
    constructor(public command?: string) { }
}

const tasks = {
    executeTask(): Thenable<never> {
        return Promise.reject(new Error('VS Code tasks are not available in headless mode.'));
    }
};

const api = {
    version: '1.90.0',
    env,
    workspace,
    window: windowApi,
    commands,
    languages,
    tasks,
    Uri: {
        file: (path: string) => uri(path),
        parse: (value: string) => uri(value.replace(/^file:\/\/\//, '')),
        joinPath: (base: any, ...parts: string[]) =>
            uri([base.fsPath, ...parts].join('/'))
    },
    Position,
    Range,
    Diagnostic,
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    EventEmitter,
    Disposable,
    ThemeIcon,
    ThemeColor: class { constructor(public id: string) { } },
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    MarkdownString,
    Task,
    TaskScope: { Global: 1, Workspace: 2 },
    ShellExecution,
    TaskGroup: { Build: { id: 'build' }, Test: { id: 'test' } },
    TaskRevealKind: { Always: 1, Silent: 2, Never: 3 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
    DecorationRangeBehavior: { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 },
    OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    LogLevel: { Off: 0, Trace: 1, Debug: 2, Info: 3, Warning: 4, Error: 5 },
    CodeAction: class { constructor(public title: string, public kind?: unknown) { } },
    CodeActionKind: { QuickFix: { value: 'quickfix' }, Refactor: { value: 'refactor' } },
    CompletionItem: class { constructor(public label: string) { } },
    CompletionItemKind: { Text: 0, Method: 1, Function: 2, Field: 3, Variable: 4 },
    Hover: class { constructor(public contents: unknown) { } },
    SnippetString: class { constructor(public value: string) { } }
};

export default api as unknown as typeof VSCode;
