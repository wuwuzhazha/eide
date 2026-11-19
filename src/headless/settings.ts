import * as fs from 'fs';
import * as NodePath from 'path';
import * as jsonc from 'jsonc-parser';

export interface HeadlessSettings {
    values: { [key: string]: unknown };
    language: string;
}

function normalizeKey(key: string): string {
    return key.startsWith('EIDE.') ? key.slice('EIDE.'.length) : key;
}

function mergeSettings(target: { [key: string]: unknown }, source: unknown): void {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return;
    }
    for (const key of Object.keys(source as object)) {
        target[normalizeKey(key)] = (source as { [key: string]: unknown })[key];
    }
}

function readJsonFile(path: string): any {
    const text = fs.readFileSync(path, 'utf8');
    const errors: jsonc.ParseError[] = [];
    const value = jsonc.parse(text, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
        throw new Error(`Invalid JSON in ${path}.`);
    }
    return value;
}

function readPackageDefaults(extensionRoot: string): { [key: string]: unknown } {
    const packageFile = NodePath.join(extensionRoot, 'package.json');
    if (!fs.existsSync(packageFile)) {
        throw new Error(`Extension package.json not found: ${packageFile}`);
    }
    const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    const defaults: { [key: string]: unknown } = {};
    const configurations = packageJson.contributes?.configuration;
    if (Array.isArray(configurations)) {
        for (const section of configurations) {
            if (!section || typeof section !== 'object') {
                continue;
            }
            for (const key of Object.keys(section.properties || {})) {
                const property = section.properties[key];
                if (property && Object.prototype.hasOwnProperty.call(property, 'default')) {
                    defaults[normalizeKey(key)] = property.default;
                }
            }
        }
    }
    return defaults;
}

export function loadHeadlessSettings(
    extensionRoot: string,
    workspaceFile: string | undefined,
    settingsFile: string | undefined
): HeadlessSettings {
    const values = readPackageDefaults(extensionRoot);
    if (workspaceFile && fs.existsSync(workspaceFile)) {
        const workspace = readJsonFile(workspaceFile);
        mergeSettings(values, workspace?.settings);
    }
    if (settingsFile) {
        const settings = readJsonFile(settingsFile);
        mergeSettings(values, settings);
    }
    const languageSetting = values['DisplayLanguage'];
    const language = languageSetting === 'zh-cn' ? 'zh-cn' : 'en';
    return { values, language };
}

export function findExtensionRoot(resourcesDir: string): string {
    const resolved = NodePath.resolve(resourcesDir);
    if (NodePath.basename(resolved).toLowerCase() !== 'res') {
        throw new Error(
            `EIDE resources directory must be the extension's 'res' folder: ${resolved}`);
    }
    return NodePath.dirname(resolved);
}
