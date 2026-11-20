import * as NodePath from "path";
import * as os from "os";
import * as fs from "fs";
import { File } from "../lib/node-utility/File";
import { ProjectConfiguration } from "./EIDETypeDefine";
import { migrateProjectConfig, needsProjectConfigMigration } from "./core/project_config_migration";
import { view_str$prompt$migrationFailed } from "./StringTable";
import { GlobalEvent } from "./GlobalEvents";
import { getGlobalState } from "./Platform";

export function detectProject(dir: File): boolean {
    if (File.IsExist(NodePath.join(dir.path, '.eide', 'eide.yml')))
        return true;
    if (File.IsExist(NodePath.join(dir.path, '.eide', 'eide.json')))
        return true;
    return false;
}

async function _doMigration(projectRootDir: File) {

    // move eide.json to eide.yml
    const eideJsonFile = File.from(projectRootDir.path, '.eide', 'eide.json');
    const projCfgFile = File.from(projectRootDir.path, '.eide', 'eide.yml');
    if (eideJsonFile.IsExist()) {
        const obj = ProjectConfiguration.parseProjectFile(eideJsonFile.Read());
        projCfgFile.Write(ProjectConfiguration.dumpProjectFile(obj));
    }

    const prjCfg = ProjectConfiguration.parseProjectFile(projCfgFile.Read());
    const sourceVersion = String(prjCfg.version);
    if (needsProjectConfigMigration(prjCfg)) {
        const migrated = migrateProjectConfig(prjCfg);
        GlobalEvent.log_info(`migration ${projCfgFile.path} from ${sourceVersion} to ${migrated.version}`);
        projCfgFile.Write(ProjectConfiguration.dumpProjectFile(migrated));
    }

    // rm .eide.usr.ctx.json
    const p = NodePath.join(projectRootDir.path, '.eide.usr.ctx.json');
    if (File.IsFile(p)) {
        try {
            if (prjCfg.miscInfo && prjCfg.miscInfo.uid) {
                const ctx = JSON.parse(fs.readFileSync(p, 'utf8'));
                const key = `project.${prjCfg.miscInfo.uid}`;
                const val = getGlobalState().get<string>(key);
                const saveVal = JSON.stringify(ctx);
                if (val !== saveVal)
                    getGlobalState().update(key, saveVal);
            }
            fs.unlinkSync(p);
        } catch (error) {
            const errMsg = `${(<Error>error).name} ${(<Error>error).message}`;
            GlobalEvent.log_warn(`Fail to migrate user context '${p}'. msg: ${errMsg}`);
            GlobalEvent.log_show();
        }
    }
}

export async function doMigration(projectRootDir: File) {
    try {
        await _doMigration(projectRootDir);
    } catch (error) {
        GlobalEvent.log_error(view_str$prompt$migrationFailed.replace('{}', projectRootDir.path));
        GlobalEvent.log_error(error);
        GlobalEvent.log_show();
        throw error;
    }
}
