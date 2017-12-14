
import * as fs from "fs-extra";
import * as path from "path";
import { Uri, window } from "vscode";
import { Archetype } from "./model/Archetype";
import { Utils } from "./Utils";
import { VSCodeUI } from "./VSCodeUI";
// tslint:disable-next-line:no-http-string
const REMOTE_ARCHETYPE_CATALOG_URL: string = "http://repo.maven.apache.org/maven2/archetype-catalog.xml";

const MENUITEM_COMMON_ARCHETYPES: string = "Select from common archetypes ...";
const MENUITEM_NEW_ARCHETYPE: string = "Manually specify archetype ... ";
const ERROR_MSG_REGEXP_NOT_MATCH: string = "Invalid value.";

export namespace ArchetypeModule {
    const groupIdPrompt: string = "Please specify <GroupId> of the archetype.";
    const artifactIdPrompt: string = "Please specify <ArtifactId> of the archetype.";
    const versionPrompt: string = "Please specify <Version> of the archetype.";
    const groupIdPlaceHolder: string = "e.g. org.apache.maven.archetypes";
    const artifactIdPlaceHolder: string = "e.g. maven-archetype-quickstart";
    const versionPlaceHolder: string = "e.g. RELEASE";
    const groupIdRegExp: string = "^[A-Za-z0-9_\\-.]+$";
    const artifactIdRegExp: string = "^[A-Za-z0-9_\\-.]+$";
    const versionRegExp: string = "^[A-Za-z0-9_\\-.]+$";

    let groupIdValue: string = "org.apache.maven.archetypes";
    let artifactIdValue: string = "maven-archetype-quickstart";
    let versionValue: string = "RELEASE";

    export async function generateFromArchetype(entry: Uri | undefined): Promise<void> {
        let cwd: string = null;
        const result: Uri = await VSCodeUI.openDialogForFolder({
            defaultUri: entry && entry.fsPath ? Uri.file(entry.fsPath) : undefined,
            openLabel: "Select Destination Folder"
        });
        if (result && result.fsPath) {
            cwd = result.fsPath;
        } else {
            return Promise.resolve();
        }
        await selectArchetypesSteps(cwd);
    }

    export async function updateArchetypeCatalog(): Promise<void> {
        const xml: string = await Utils.httpGetContent(REMOTE_ARCHETYPE_CATALOG_URL);
        const archetypes: Archetype[] = await Utils.listArchetypeFromXml(xml);
        const targetFilePath: string = path.join(Utils.getExtensionRootPath(), "resources", "archetypes.json");
        await fs.ensureFile(targetFilePath);
        await fs.writeJSON(targetFilePath, archetypes);
    }

    async function showQuickPickForArchetypes(options?: {all: boolean}): Promise<Archetype> {
        return await VSCodeUI.getQuickPick<Archetype>(
            loadArchetypePickItems(options),
            (item: Archetype) => item.artifactId ? `$(package) ${item.artifactId} ` : "More ...",
            (item: Archetype) => item.groupId ? `${item.groupId}` : "",
            (item: Archetype) => item.description,
            { matchOnDescription: true, placeHolder: "Select archetype with <groupId>:<artifactId> ..." }
        );
    }

    async function selectArchetypesSteps(cwd: string): Promise<void> {
        let selectedArchetype: Archetype = await showQuickPickForArchetypes();
        if (selectedArchetype === undefined) {
            return;
        } else if (!selectedArchetype.artifactId) {
            selectedArchetype = await showQuickPickForArchetypes({all : true});
        }

        if (selectedArchetype) {
            const { artifactId, groupId } = selectedArchetype;
            const cmd: string = [
                Utils.getMavenExecutable(),
                "archetype:generate",
                `-DarchetypeArtifactId="${artifactId}"`,
                `-DarchetypeGroupId="${groupId}"`
            ].join(" ");
            VSCodeUI.runInTerminal(cmd, { cwd, name: "Maven-Archetype" });
        }
    }

    async function addArcheTypeSteps(cwd: string): Promise<void> {
        const groupId: string = await VSCodeUI.getFromInputBox({
            placeHolder: groupIdPlaceHolder,
            prompt: groupIdPrompt,
            value: groupIdValue,
            validateInput: (text: string): string => new RegExp(groupIdRegExp).test(text) ? null : ERROR_MSG_REGEXP_NOT_MATCH
        });
        if (groupId) {
            groupIdValue = groupId;
        } else {
            return;
        }

        const artifactId: string = await VSCodeUI.getFromInputBox({
            placeHolder: artifactIdPlaceHolder,
            prompt: artifactIdPrompt,
            value: artifactIdValue,
            validateInput: (text: string): string => new RegExp(artifactIdRegExp).test(text) ? null : ERROR_MSG_REGEXP_NOT_MATCH
        });
        if (artifactId) {
            artifactIdValue = artifactId;
        } else {
            return;
        }

        const version: string = await VSCodeUI.getFromInputBox({
            placeHolder: versionPlaceHolder,
            prompt: versionPrompt,
            value: versionValue,
            validateInput: (text: string): string => new RegExp(versionRegExp).test(text) ? null : ERROR_MSG_REGEXP_NOT_MATCH
        });
        if (version) {
            versionValue = version;
        } else {
            return;
        }

        const cmd: string = ["mvn archetype:generate",
            `-DarchetypeArtifactId="${artifactId}"`,
            `-DarchetypeGroupId="${groupId}"`,
            `-DarchetypeVersion="${version}"`].join(" ");
        VSCodeUI.runInTerminal(cmd, { cwd, name: "Maven-Archetype" });
    }

    async function getArchetypeList(url?: string): Promise<Archetype[]> {
        let nonLocalXml: string = null;
        if (url) {
            nonLocalXml = await Utils.httpGetContent(url);
        } else {
            const providedXmlPath: string = Utils.getProvidedArchetypeCatalogFilePath();
            if (await fs.pathExists(providedXmlPath)) {
                nonLocalXml = await fs.readFile(providedXmlPath, "utf8");
            }
        }
        let localXml: string = null;
        const localXmlPath: string = Utils.getLocalArchetypeCatalogFilePath();
        if (await fs.pathExists(localXmlPath)) {
            localXml = await fs.readFile(localXmlPath, "utf8");
        }

        const lists: Archetype[][] = await Promise.all([Utils.listArchetypeFromXml(nonLocalXml), Utils.listArchetypeFromXml(localXml)]);
        return Promise.resolve([].concat.apply([], lists));
    }

    async function loadArchetypePickItems(options?: {all: boolean}): Promise<Archetype[]> {
        const contentPath: string = path.join(Utils.getExtensionRootPath(), "resources", "archetypes.json");
        if (await fs.pathExists(contentPath)) {
            const allItems: Archetype[] = await fs.readJSON(contentPath);
            if (options && options.all) {
                return allItems;
            } else {
                const preferredGroupIds: string[] = ["com.microsoft", "org.apache.maven.archetypes"];
                const items: Archetype[][] = preferredGroupIds.map((gid: string) => allItems.filter((item: Archetype) => item.groupId.startsWith(gid)));
                return [].concat.apply([new Archetype(null, null, null, "Find more archetypes available in remote catalog.")], items);
            }
        }
        return [];
    }
}
