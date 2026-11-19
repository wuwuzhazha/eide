import * as yaml from 'yaml';

export function updateClangdConfigText(text: string, apply: (cfg: any) => void): string {
    const docs: yaml.Document[] = yaml.parseAllDocuments(text);

    for (const doc of docs) {
        if (doc.errors.length > 0) {
            throw doc.errors[0];
        }
    }

    let target = docs.find(doc => !doc.has('If'));
    if (!target) {
        target = new yaml.Document({});
        docs.unshift(target);
    }

    const cfg: any = target.toJS() ?? {};
    apply(cfg);
    target.contents = target.createNode(cfg);

    return docs
        .map(doc => doc.toString().replace(/^---\r?\n/, '').trimEnd())
        .join('\n---\n') + '\n';
}
