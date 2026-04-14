"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
function findCli() {
    const custom = process.env.FREECLAUDE_PATH;
    if (custom)
        return custom;
    const local = path.join(os.homedir(), '.freeclaude', 'bin', 'freeclaude');
    if ((0, fs_1.existsSync)(local))
        return local;
    return 'npx';
}
function getCliArgs(args) {
    const cli = findCli();
    return cli === 'npx' ? ['freeclaude', ...args] : args;
}
function getWorkspacePath() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
function truncateForPrompt(value, maxLength = 12000) {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n\n[truncated]`;
}
function runCliTextOnce(args) {
    return new Promise((resolve, reject) => {
        const cli = findCli();
        const child = (0, child_process_1.spawn)(cli, getCliArgs(args), {
            cwd: getWorkspacePath(),
            env: { ...process.env },
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (data) => { stdout += data.toString(); });
        child.stderr?.on('data', (data) => { stderr += data.toString(); });
        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout.trim());
                return;
            }
            reject(new Error(stderr.trim() || `FreeClaude exited ${code}`));
        });
        child.on('error', (error) => reject(error));
    });
}
async function runCliText(args, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await runCliTextOnce(args);
        }
        catch (error) {
            if (attempt === retries) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
    throw new Error('unreachable');
}
async function runCliJson(args) {
    const output = await runCliText(args);
    return JSON.parse(output);
}
function renderTask(task) {
    return [
        `Task ${task.id}`,
        `Status: ${task.status}`,
        `Created: ${task.createdAt}`,
        task.completedAt ? `Completed: ${task.completedAt}` : '',
        task.templateId ? `Template: ${task.templateId}` : '',
        task.scheduleId ? `Schedule: ${task.scheduleId}` : '',
        '',
        'Prompt:',
        task.prompt,
        '',
        'Output:',
        task.output?.trim() || '(no output captured yet)',
        '',
    ].filter(Boolean);
}
async function queueTask(prompt, label, outputChannel) {
    const task = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `FreeClaude: queueing ${label}`,
        cancellable: false,
    }, () => runCliJson(['task', 'run', '--json', prompt]));
    outputChannel.appendLine(`Queued task ${task.id} — ${label}`);
    outputChannel.appendLine(`Prompt: ${task.prompt}`);
    outputChannel.appendLine('');
    vscode.window.showInformationMessage(`FreeClaude task ${task.id} queued. Use "FreeClaude: Show Tasks" or the desktop app to inspect it.`);
    return task;
}
async function showTasks(outputChannel) {
    const payload = await runCliJson(['task', 'list', '--json']);
    const items = payload.tasks.map(task => ({
        label: `${task.id} · ${task.status}`,
        description: task.prompt.slice(0, 72),
        detail: task.completedAt ? `Completed ${task.completedAt}` : `Created ${task.createdAt}`,
        task,
    }));
    if (items.length === 0) {
        vscode.window.showInformationMessage('FreeClaude: no tasks yet.');
        return;
    }
    const selected = await vscode.window.showQuickPick(items, {
        title: 'FreeClaude Tasks',
        placeHolder: 'Choose a task to inspect',
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!selected)
        return;
    const task = await runCliJson(['task', 'resume', '--json', selected.task.id]);
    outputChannel.show(true);
    outputChannel.appendLine(renderTask(task).join('\n'));
}
function buildExplainPrompt(editor) {
    const selection = editor.document.getText(editor.selection);
    const isSelection = !editor.selection.isEmpty;
    const code = truncateForPrompt(selection || editor.document.getText());
    const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
    return isSelection
        ? `Explain this ${editor.document.languageId} selection from ${relativePath}:\n\n${code}`
        : `Explain this ${editor.document.languageId} file (${relativePath}):\n\n${code}`;
}
function buildDiagnosticsPrompt() {
    const diagnostics = vscode.languages.getDiagnostics();
    const errors = [];
    for (const [uri, entries] of diagnostics) {
        for (const diagnostic of entries) {
            if (diagnostic.severity !== vscode.DiagnosticSeverity.Error)
                continue;
            const line = diagnostic.range.start.line + 1;
            const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
            const text = document?.lineAt(diagnostic.range.start.line).text.trim() ?? '';
            errors.push(`${uri.fsPath}:${line}: ${diagnostic.message}\n  ${text}`);
        }
    }
    if (errors.length === 0)
        return null;
    return `Investigate and propose fixes for these diagnostics:\n\n${truncateForPrompt(errors.join('\n\n'), 10000)}`;
}
async function refreshStatus(statusBar) {
    try {
        const payload = await runCliJson(['task', 'list', '--json']);
        const running = payload.tasks.filter(task => task.status === 'running').length;
        statusBar.text = running > 0
            ? `$(rocket) FreeClaude ${running} running`
            : '$(check) FreeClaude tasks';
        statusBar.tooltip = 'Show FreeClaude tasks';
    }
    catch (error) {
        statusBar.text = '$(warning) FreeClaude unavailable';
        statusBar.tooltip = error instanceof Error ? error.message : 'FreeClaude unavailable';
    }
    statusBar.show();
}
function activate(context) {
    const outputChannel = vscode.window.createOutputChannel('FreeClaude Tasks');
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.command = 'freeclaude.tasks';
    const queuePromptDisposable = vscode.commands.registerCommand('freeclaude.chat', async () => {
        const input = await vscode.window.showInputBox({
            prompt: 'Queue a FreeClaude task',
            placeHolder: 'Describe the task you want FreeClaude to run',
            title: 'FreeClaude: Queue Prompt Task',
        });
        if (!input?.trim())
            return;
        await queueTask(input.trim(), 'prompt task', outputChannel);
        void refreshStatus(statusBar);
    });
    const explainDisposable = vscode.commands.registerCommand('freeclaude.explain', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('FreeClaude: open a file or select code first.');
            return;
        }
        await queueTask(buildExplainPrompt(editor), 'explain task', outputChannel);
        void refreshStatus(statusBar);
    });
    const fixDisposable = vscode.commands.registerCommand('freeclaude.fix', async () => {
        const prompt = buildDiagnosticsPrompt();
        if (!prompt) {
            vscode.window.showInformationMessage('FreeClaude: no diagnostics errors found.');
            return;
        }
        await queueTask(prompt, 'diagnostics task', outputChannel);
        void refreshStatus(statusBar);
    });
    const tasksDisposable = vscode.commands.registerCommand('freeclaude.tasks', async () => {
        await showTasks(outputChannel);
        void refreshStatus(statusBar);
    });
    const refreshTimer = setInterval(() => {
        void refreshStatus(statusBar);
    }, 15000);
    context.subscriptions.push(outputChannel, statusBar, queuePromptDisposable, explainDisposable, fixDisposable, tasksDisposable, { dispose: () => clearInterval(refreshTimer) });
    void refreshStatus(statusBar);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map