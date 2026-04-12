import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';

function findCli(): string {
  const custom = process.env.FREECLAUDE_PATH;
  if (custom) return custom;
  const local = path.join(os.homedir(), '.freeclaude', 'bin', 'freeclaude');
  if (require('fs').existsSync(local)) return local;
  return 'npx';
}

function getCliArgs(): string[] {
  const cli = findCli();
  return cli === 'npx' ? ['freeclaude', '--print'] : ['--print'];
}

function runFreeClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cli = findCli();
    const args = [...getCliArgs(), prompt];
    const child = spawn(cli, args, {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`FreeClaude exited ${code}: ${stderr.trim()}`));
    });

    child.on('error', (err) => reject(err));
  });
}

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('FreeClaude');

  // Chat command
  const chatDisposable = vscode.commands.registerCommand('freeclaude.chat', async () => {
    const input = await vscode.window.showInputBox({
      prompt: 'FreeClaude',
      placeHolder: 'Ask anything... (or /help for commands)',
      title: 'FreeClaude Chat',
    });

    if (!input) return;

    outputChannel.show(true);
    outputChannel.appendLine(`❯ ${input}\n`);

    try {
      const result = await runFreeClaude(input);
      outputChannel.appendLine(result);
      outputChannel.appendLine('');
    } catch (err: any) {
      outputChannel.appendLine(`❌ ${err.message}`);
      vscode.window.showErrorMessage(`FreeClaude: ${err.message}`);
    }
  });

  // Explain code
  const explainDisposable = vscode.commands.registerCommand('freeclaude.explain', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No file open');
      return;
    }

    const selection = editor.document.getText(editor.selection);
    const code = selection || editor.document.getText();
    const lang = editor.document.languageId;

    const prompt = selection
      ? `Explain this ${lang} code:\n\n${code}`
      : `Explain this ${lang} file:\n\n${code}`;

    outputChannel.show(true);
    outputChannel.appendLine(`❯ Explain ${lang} code\n`);

    try {
      const result = await runFreeClaude(prompt);
      outputChannel.appendLine(result);
      outputChannel.appendLine('');
    } catch (err: any) {
      vscode.window.showErrorMessage(`FreeClaude: ${err.message}`);
    }
  });

  // Fix error
  const fixDisposable = vscode.commands.registerCommand('freeclaude.fix', async () => {
    const diagnostics = vscode.languages.getDiagnostics();
    const errors: string[] = [];

    for (const [uri, diags] of diagnostics) {
      for (const d of diags) {
        if (d.severity === vscode.DiagnosticSeverity.Error) {
          const line = d.range.start.line + 1;
          const text = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString())
            ?.lineAt(d.range.start.line).text ?? '';
          errors.push(`${uri.fsPath}:${line}: ${d.message}\n  ${text.trim()}`);
        }
      }
    }

    if (errors.length === 0) {
      vscode.window.showInformationMessage('No errors found!');
      return;
    }

    const prompt = `Fix these errors:\n\n${errors.join('\n\n')}`;

    outputChannel.show(true);
    outputChannel.appendLine(`❯ Fix ${errors.length} errors\n`);

    try {
      const result = await runFreeClaude(prompt);
      outputChannel.appendLine(result);
      outputChannel.appendLine('');
    } catch (err: any) {
      vscode.window.showErrorMessage(`FreeClaude: ${err.message}`);
    }
  });

  context.subscriptions.push(chatDisposable, explainDisposable, fixDisposable);
}

export function deactivate() {}
