
import { exec } from "child_process";
import * as path from "path";
import { Event, EventEmitter, ExtensionContext, TextDocument, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, workspace, WorkspaceConfiguration, WorkspaceFolder } from "vscode";
import { ProjectItem } from "./ProjectItem";
import { Utils } from "./Utils";
import { VSCodeUI } from "./VSCodeUI";
import { IPomModule, IPomModules, IPomRoot } from "./XmlSchema";

const ENTRY_NEW_GOALS: string = "New ...";
const ENTRY_OPEN_HIST: string = "Edit ...";

export class ProjectDataProvider implements TreeDataProvider<TreeItem> {

    public _onDidChangeTreeData: EventEmitter<TreeItem> = new EventEmitter<TreeItem>();
    public readonly onDidChangeTreeData: Event<TreeItem> = this._onDidChangeTreeData.event;
    protected context: ExtensionContext;
    private cachedItems: ProjectItem[] = [];

    constructor(context: ExtensionContext) {
        this.context = context;
    }

    public getTreeItem(element: TreeItem): TreeItem {
        return element;
    }

    public async getChildren(node?: TreeItem): Promise<TreeItem[]> {
        const element: ProjectItem = <ProjectItem>node;
        if (element === undefined) {
            this.cachedItems = [];
            const ret: TreeItem[] = [];
            if (workspace.workspaceFolders) {
                workspace.workspaceFolders.forEach((wf: WorkspaceFolder) => {
                    const item: ProjectItem = new ProjectItem(wf.name, wf.uri.fsPath, "WorkspaceItem");
                    ret.push(item);
                });
            }
            return ret;
        } else if (element.contextValue === "WorkspaceItem") {
            const todolist: Promise<ProjectItem>[] = [];
            const depth: number = workspace.getConfiguration("maven.projects").get<number>("maxDepthOfPom") || -1;
            const foundPomXmls: string[] = await Utils.findAllInDir(element.abosolutePath, "pom.xml", depth);
            foundPomXmls.forEach((pomXmlFilePath: string) => {
                todolist.push(Utils.getProject(pomXmlFilePath, this.context.asAbsolutePath(path.join("resources", "project.svg"))));
            });
            const items: ProjectItem[] = (await Promise.all(todolist)).filter((x: ProjectItem) => x);
            this.cachedItems = this.cachedItems.concat(items);
            return items;
        } else if (element.contextValue === "mavenProject") {
            const items: ProjectItem[] = [];
            // sub modules
            const pom: IPomRoot = element.params.pom;
            if (pom.project && pom.project.modules) {
                const item: ProjectItem = new ProjectItem(
                    "Modules",
                    element.abosolutePath,
                    "Modules",
                    { ...element.params, modules: pom.project.modules }
                );
                item.iconPath = this.context.asAbsolutePath(path.join("resources", "folder.svg"));
                items.push(item);
            }
            return Promise.resolve(items);
        } else if (element.contextValue === "Modules") {
            const todolist: Promise<ProjectItem>[] = [];
            const pomXmlFilePaths: string[] = [];
            element.params.modules.forEach((modules: IPomModules) => {
                if (modules.module) {
                    modules.module.forEach((mod: IPomModule) => {
                        const pomxml: string = path.join(path.dirname(element.abosolutePath), mod.toString(), "pom.xml");
                        pomXmlFilePaths.push(pomxml);
                    });
                }
            });
            pomXmlFilePaths.forEach((pomXmlFilePath: string) => {
                todolist.push(Utils.getProject(pomXmlFilePath, this.context.asAbsolutePath(path.join("resources", "project.svg"))));
            });

            const items: ProjectItem[] = (await Promise.all(todolist)).filter((x: ProjectItem) => x);
            this.cachedItems = this.cachedItems.concat(items.filter(
                (item: ProjectItem) => !this.cachedItems.find((value: ProjectItem) => value.abosolutePath === item.abosolutePath)
            ));
            return items;

        }
    }

    public refreshTree(): void {
        this._onDidChangeTreeData.fire();
    }

    public async executeGoal(item: ProjectItem | undefined, goal?: string): Promise<void> {
        if (!item) {
            item = await VSCodeUI.getQuickPick<ProjectItem>(
                this.cachedItems,
                (x: ProjectItem) => x.label,
                (x: ProjectItem) => x.abosolutePath
            );
        }
        if (item) {
            const cmd: string = `mvn ${goal || item.label} -f "${item.abosolutePath}"`;
            const name: string = `Maven-${item.params.artifactId}`;
            VSCodeUI.runInTerminal(cmd, { name });
        }
    }

    public async effectivePom(item: Uri | ProjectItem | undefined): Promise<void> {
        if (!item) {
            item = await VSCodeUI.getQuickPick<ProjectItem>(
                this.cachedItems,
                (x: ProjectItem) => x.label,
                (x: ProjectItem) => x.abosolutePath
            );
        }
        let pomXmlFilePath: string = null;
        if (item instanceof Uri) {
            pomXmlFilePath = item.fsPath;
        } else if (item instanceof ProjectItem) {
            pomXmlFilePath = item.abosolutePath;
        }
        if (!pomXmlFilePath) {
            return Promise.resolve();
        }
        const promise: Promise<string> = new Promise<string>(
            (resolve: (value: string) => void, reject: (e: Error) => void): void => {
                const filepath: string = Utils.getEffectivePomOutputPath(pomXmlFilePath);
                const cmd: string = `mvn help:effective-pom -f "${pomXmlFilePath}" -Doutput="${filepath}"`;
                exec(cmd, (error: Error, stdout: string, stderr: string): void => {
                    if (error || stderr) {
                        return resolve(null);
                    }
                    resolve(filepath);
                });
            }
        );
        window.setStatusBarMessage("Generating effective pom ... ", promise);
        const ret: string = await promise;
        const pomxml: string = Utils.readFileIfExists(ret);
        if (pomxml) {
            const document: TextDocument = await workspace.openTextDocument({ language: "xml", content: pomxml });
            window.showTextDocument(document);
        } else {
            window.showErrorMessage("Error occurred in generating effective pom.");
        }
    }

    public async customGoal(item: ProjectItem | undefined): Promise<void> {
        if (!item) {
            item = await VSCodeUI.getQuickPick<ProjectItem>(
                this.cachedItems,
                (x: ProjectItem) => x.label,
                (x: ProjectItem) => x.abosolutePath);
        }
        if (!item || !item.abosolutePath) {
            return Promise.resolve();
        }
        const cmdlist: string[] = Utils.loadCmdHistory(item.abosolutePath);
        const selectedGoal: string = await window.showQuickPick(cmdlist.concat([ENTRY_NEW_GOALS, ENTRY_OPEN_HIST]), {
            placeHolder: "Select the custom command ... "
        });
        if (selectedGoal === ENTRY_NEW_GOALS) {
            const inputGoals: string = await window.showInputBox({ placeHolder: "e.g. clean package -DskipTests" });
            const trimedGoals: string = inputGoals && inputGoals.trim();
            if (trimedGoals) {
                Utils.saveCmdHistory(item.abosolutePath, Utils.withLRUItemAhead(cmdlist, trimedGoals));
                VSCodeUI.runInTerminal(
                    `mvn ${trimedGoals} -f "${item.abosolutePath}"`,
                    { name: `Maven-${item.params.artifactId}` }
                );
            }
        } else if (selectedGoal === ENTRY_OPEN_HIST) {
            const historicalFilePath: string = Utils.getCommandHistoryCachePath(item.abosolutePath);
            window.showTextDocument(Uri.file(historicalFilePath));
        } else if (selectedGoal) {
            Utils.saveCmdHistory(item.abosolutePath, Utils.withLRUItemAhead(cmdlist, selectedGoal));
            VSCodeUI.runInTerminal(
                `mvn ${selectedGoal} -f "${item.abosolutePath}"`,
                { name: `Maven-${item.params.artifactId}` }
            );
        }
    }
}
