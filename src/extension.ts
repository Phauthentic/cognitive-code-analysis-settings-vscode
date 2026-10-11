import * as vscode from 'vscode';
import { Analyser, lineIndex } from './analyser';
import { Runner } from './runner';
import { Finding, FindingLevel } from './sarif';

const SOURCE = 'phpcca';
const SEVERITY: Record<FindingLevel, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  note: vscode.DiagnosticSeverity.Information,
};

function isAnalysable(document: vscode.TextDocument): boolean {
  return document.languageId === 'php' && document.uri.scheme === 'file';
}

function toDiagnostic(document: vscode.TextDocument, finding: Finding): vscode.Diagnostic {
  const range = document.lineAt(lineIndex(finding.line, document.lineCount)).range;
  const diagnostic = new vscode.Diagnostic(range, finding.message, SEVERITY[finding.level]);
  diagnostic.source = SOURCE;
  diagnostic.code = finding.ruleId;
  return diagnostic;
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection(SOURCE);
  const output = vscode.window.createOutputChannel('Cognitive Code Analysis');
  const analyser = new Analyser(new Runner(), (message) => { output.appendLine(message); });
  const timers = new Map<string, NodeJS.Timeout>();

  const settings = (document: vscode.TextDocument): vscode.WorkspaceConfiguration =>
    vscode.workspace.getConfiguration('phpcca', document.uri);

  /** Drops the pending debounce and the in-flight run, keeps existing diagnostics. */
  const cancelPending = (document: vscode.TextDocument): void => {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.delete(key);
    analyser.cancel(key);
  };

  const clear = (document: vscode.TextDocument): void => {
    cancelPending(document);
    diagnostics.delete(document.uri);
  };

  const analyse = async (document: vscode.TextDocument): Promise<void> => {
    if (!isAnalysable(document) || !settings(document).get<boolean>('enable', true)) {
      clear(document);
      return;
    }
    const config = settings(document);
    const version = document.version;
    const findings = await analyser.analyse(
      document.uri.toString(),
      {
        documentPath: document.uri.fsPath,
        text: document.getText(),
        workspaceFolder: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath,
        executable: config.get<string>('executable', 'vendor/bin/phpcca'),
        configFile: config.get<string>('configFile', ''),
        phpExecutable: config.get<string>('phpExecutable', 'php'),
      },
      () => !document.isClosed && document.version === version,
    );
    if (findings !== undefined) {
      diagnostics.set(document.uri, findings.map((finding) => toDiagnostic(document, finding)));
    }
  };

  const schedule = (document: vscode.TextDocument): void => {
    cancelPending(document);
    const key = document.uri.toString();
    const delay = settings(document).get<number>('debounceMs', 500);
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      void analyse(document);
    }, delay));
  };

  context.subscriptions.push(
    diagnostics,
    output,
    { dispose: () => { timers.forEach(clearTimeout); } },
    vscode.workspace.onDidOpenTextDocument((document) => void analyse(document)),
    vscode.workspace.onDidSaveTextDocument((document) => void analyse(document)),
    vscode.workspace.onDidChangeTextDocument(({ document, contentChanges }) => {
      if (contentChanges.length === 0 || !isAnalysable(document)) {
        return;
      }
      // The in-flight result is for an older version and would be dropped anyway.
      analyser.cancel(document.uri.toString());
      if (settings(document).get<string>('runOn', 'type') === 'type') {
        schedule(document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument(clear),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('phpcca')) {
        analyser.resetErrors();
        vscode.workspace.textDocuments.forEach((document) => {
          cancelPending(document);
          void analyse(document);
        });
      }
    }),
  );

  vscode.workspace.textDocuments.forEach((document) => void analyse(document));
}

export function deactivate(): void {
  // Disposables registered in activate() clean up.
}
