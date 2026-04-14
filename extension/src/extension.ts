import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

type TaskRecord = {
  id: string;
  prompt: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  output?: string;
  templateId?: string | null;
  scheduleId?: string | null;
};

type TaskListPayload = {
  tasks: TaskRecord[];
};

function findCli(): string {
  const custom = process.env.FREECLAUDE_PATH;
  if (custom) return custom;
  const local = path.join(os.homedir(), '.freeclaude', 'bin', 'freeclaude');
  if (existsSync(local)) return local;
  return 'npx';
}

function getCliArgs(args: string[]): string[] {
  const cli = findCli();
  return cli === 'npx' ? ['freeclaude', ...args] : args;
}

function getWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function truncateForPrompt(value: string, maxLength = 12000): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n\n[truncated]`;
}

function runCliText(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const cli = findCli();
    const child = spawn(cli, getCliArgs(args), {
      cwd: getWorkspacePath(),
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

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

async function runCliJson<T>(args: string[]): Promise<T> {
  const output = await runCliText(args);
  return JSON.parse(output) as T;
}

function renderTask(task: TaskRecord): string[] {
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

async function queueTask(prompt: string, label: string, outputChannel: vscode.OutputChannel): Promise<TaskRecord> {
  const task = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `FreeClaude: queueing ${label}`,
      cancellable: false,
    },
    () => runCliJson<TaskRecord>(['task', 'run', '--json', prompt]),
  );

  outputChannel.appendLine(`Queued task ${task.id} — ${label}`);
  outputChannel.appendLine(`Prompt: ${task.prompt}`);
  outputChannel.appendLine('');

  vscode.window.showInformationMessage(
    `FreeClaude task ${task.id} queued. Use "FreeClaude: Show Tasks" or the desktop app to inspect it.`,
  );

  return task;
}

async function showTasks(outputChannel: vscode.OutputChannel): Promise<void> {
  const payload = await runCliJson<TaskListPayload>(['task', 'list', '--json']);
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

  if (!selected) return;

  const task = await runCliJson<TaskRecord>(['task', 'resume', '--json', selected.task.id]);
  outputChannel.show(true);
  outputChannel.appendLine(renderTask(task).join('\n'));
}

function buildExplainPrompt(editor: vscode.TextEditor): string {
  const selection = editor.document.getText(editor.selection);
  const isSelection = !editor.selection.isEmpty;
  const code = truncateForPrompt(selection || editor.document.getText());
  const relativePath = vscode.workspace.asRelativePath(editor.document.uri);

  return isSelection
    ? `Explain this ${editor.document.languageId} selection from ${relativePath}:\n\n${code}`
    : `Explain this ${editor.document.languageId} file (${relativePath}):\n\n${code}`;
}

function buildDiagnosticsPrompt(): string | null {
  const diagnostics = vscode.languages.getDiagnostics();
  const errors: string[] = [];

  for (const [uri, entries] of diagnostics) {
    for (const diagnostic of entries) {
      if (diagnostic.severity !== vscode.DiagnosticSeverity.Error) continue;
      const line = diagnostic.range.start.line + 1;
      const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
      const text = document?.lineAt(diagnostic.range.start.line).text.trim() ?? '';
      errors.push(`${uri.fsPath}:${line}: ${diagnostic.message}\n  ${text}`);
    }
  }

  if (errors.length === 0) return null;

  return `Investigate and propose fixes for these diagnostics:\n\n${truncateForPrompt(errors.join('\n\n'), 10000)}`;
}

async function refreshStatus(statusBar: vscode.StatusBarItem): Promise<void> {
  try {
    const payload = await runCliJson<TaskListPayload>(['task', 'list', '--json']);
    const running = payload.tasks.filter(task => task.status === 'running').length;
    statusBar.text = running > 0
      ? `$(rocket) FreeClaude ${running} running`
      : '$(check) FreeClaude tasks';
    statusBar.tooltip = 'Show FreeClaude tasks';
  } catch (error) {
    statusBar.text = '$(warning) FreeClaude unavailable';
    statusBar.tooltip = error instanceof Error ? error.message : 'FreeClaude unavailable';
  }
  statusBar.show();
}

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('FreeClaude Tasks');
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'freeclaude.tasks';

  const queuePromptDisposable = vscode.commands.registerCommand('freeclaude.chat', async () => {
    const input = await vscode.window.showInputBox({
      prompt: 'Queue a FreeClaude task',
      placeHolder: 'Describe the task you want FreeClaude to run',
      title: 'FreeClaude: Queue Prompt Task',
    });

    if (!input?.trim()) return;
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

  context.subscriptions.push(
    outputChannel,
    statusBar,
    queuePromptDisposable,
    explainDisposable,
    fixDisposable,
    tasksDisposable,
    { dispose: () => clearInterval(refreshTimer) },
  );

  void refreshStatus(statusBar);
}

export function deactivate() {}
