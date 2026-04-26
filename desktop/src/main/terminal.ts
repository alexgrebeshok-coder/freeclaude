import { EventEmitter } from 'events';
import * as pty from 'node-pty';
import os from 'os';

interface Terminal {
  id: string;
  pty: pty.IPty;
  cwd: string;
}

interface TerminalOptions {
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
}

export class TerminalManager extends EventEmitter {
  private terminals = new Map<string, Terminal>();
  private idCounter = 0;

  private getDefaultShell(): string {
    if (process.platform === 'darwin') {
      return process.env.SHELL || '/bin/zsh';
    }
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  createTerminal(options: TerminalOptions = {}): string {
    const id = `terminal-${++this.idCounter}`;
    const shell = options.shell || this.getDefaultShell();
    const cwd = options.cwd || os.homedir();
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols,
      rows,
      cwd,
      env: process.env as { [key: string]: string }
    });

    const terminal: Terminal = {
      id,
      pty: ptyProcess,
      cwd
    };

    this.terminals.set(id, terminal);

    ptyProcess.onData((data) => {
      this.emit('data', id, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', id, exitCode);
      this.terminals.delete(id);
    });

    return id;
  }

  write(id: string, data: string): void {
    const terminal = this.terminals.get(id);
    if (terminal) {
      terminal.pty.write(data);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(id);
    if (terminal) {
      terminal.pty.resize(cols, rows);
    }
  }

  kill(id: string): void {
    const terminal = this.terminals.get(id);
    if (terminal) {
      terminal.pty.kill();
      this.terminals.delete(id);
    }
  }

  getCwd(id: string): string | undefined {
    return this.terminals.get(id)?.cwd;
  }

  dispose(): void {
    for (const [id, terminal] of this.terminals) {
      terminal.pty.kill();
    }
    this.terminals.clear();
  }
}
