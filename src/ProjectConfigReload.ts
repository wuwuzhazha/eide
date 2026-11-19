export function hasExternalConfigChange(
    current: string,
    synced: string | undefined,
    compare: (a: string, b: string) => boolean
): boolean {
    if (synced === undefined) {
        return true;
    }
    if (current === synced) {
        return false;
    }
    try {
        return !compare(current, synced);
    } catch {
        return true;
    }
}

export interface ProjectReloadIdentity {
    type: string;
    toolchain: string;
    uploader: string;
    uid: string | undefined;
    version: string | undefined;
}

export function canApplyProjectConfigInPlace(
    oldCfg: ProjectReloadIdentity,
    newCfg: ProjectReloadIdentity
): boolean {
    return oldCfg.type === newCfg.type
        && oldCfg.toolchain === newCfg.toolchain
        && oldCfg.uploader === newCfg.uploader
        && oldCfg.uid === newCfg.uid
        && oldCfg.version === newCfg.version;
}
