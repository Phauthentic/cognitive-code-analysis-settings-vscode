import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

const TIMEOUT_MS = 30_000;

async function waitFor<T>(description: string, probe: () => T | undefined): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function lineOf(document: vscode.TextDocument, needle: string): number {
  const index = document.getText().split('\n').findIndex((line) => line.includes(needle));
  assert.notEqual(index, -1, `fixture lacks "${needle}"`);
  return index;
}

const SETTINGS = ['enable', 'runOn', 'debounceMs'] as const;

async function setting(key: (typeof SETTINGS)[number], value: unknown): Promise<void> {
  await vscode.workspace.getConfiguration('phpcca').update(key, value, vscode.ConfigurationTarget.Workspace);
}

/** Reverts unsaved changes of the document and closes the tabs showing it. */
async function closeDocument(uri: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.files.revert', uri);
  const tabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString());
  await vscode.window.tabGroups.close(tabs);
}

async function waitForDiagnostics(uri: vscode.Uri, count: number): Promise<vscode.Diagnostic[]> {
  return waitFor(`${String(count)} diagnostic(s)`, () => {
    const found = vscode.languages.getDiagnostics(uri);
    return found.length === count ? found : undefined;
  });
}

const COMPLEX_BODY =
  '        if ($a > 0) { if ($b > 0) { foreach ([$a] as $x) { if ($x) { return 1; } else { return 2; } } } } return $a + $b;';

describe('phpcca diagnostics', function () {
  let uri: vscode.Uri;
  let original: string;

  before(() => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'fixture workspace must be open');
    uri = vscode.Uri.file(path.join(folder.uri.fsPath, 'src/Sample.php'));
    original = fs.readFileSync(uri.fsPath, 'utf8');
  });

  afterEach(async () => {
    await closeDocument(uri);
    for (const key of SETTINGS) {
      await setting(key, undefined);
    }
    fs.writeFileSync(uri.fsPath, original);
  });

  // Not openTextDocument(): VS Code keeps API-opened models alive for a minute, which delays the close event.
  async function open(): Promise<vscode.TextDocument> {
    await vscode.commands.executeCommand('vscode.open', uri);
    const document = vscode.window.activeTextEditor?.document;
    assert.ok(document);
    assert.equal(document.uri.toString(), uri.toString());
    return document;
  }

  async function makeSimpleComplex(document: vscode.TextDocument): Promise<number> {
    const simpleLine = lineOf(document, 'function simple');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, document.lineAt(simpleLine + 2).range, COMPLEX_BODY);
    assert.ok(await vscode.workspace.applyEdit(edit));
    return simpleLine;
  }

  it('flags the complex method only, follows unsaved edits and clears on close', async () => {
    const document = await open();
    const complexLine = lineOf(document, 'function complex');
    const initial = await waitForDiagnostics(uri, 1);
    const [diagnostic] = initial;
    assert.ok(diagnostic);
    assert.equal(diagnostic.range.start.line, complexLine);
    assert.equal(diagnostic.source, 'phpcca');
    assert.equal(diagnostic.code, 'cognitive-complexity');
    assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Error);
    // Cross-checked by hand against `vendor/bin/phpcca analyse src/Sample.php` (1.792, SARIF rounds to 1 decimal).
    assert.equal(diagnostic.message, 'Method complex has cognitive complexity 1.8 (threshold: 0.5)');

    const simpleLine = await makeSimpleComplex(document);
    assert.ok(document.isDirty);
    const updated = await waitForDiagnostics(uri, 2);
    assert.deepEqual(updated.map((d) => d.range.start.line).sort((a, b) => a - b), [simpleLine, complexLine]);
    assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), original, 'the unsaved buffer must not touch the file');

    await closeDocument(uri);
    await waitFor('diagnostics cleared', () => (vscode.languages.getDiagnostics(uri).length === 0 ? true : undefined));
  });

  it('clears diagnostics when disabled and restores them when re-enabled', async () => {
    await open();
    await waitForDiagnostics(uri, 1);
    await setting('enable', false);
    await waitForDiagnostics(uri, 0);
    await setting('enable', true);
    await waitForDiagnostics(uri, 1);
  });

  it('with runOn=save ignores unsaved edits and analyses on save', async () => {
    await setting('runOn', 'save');
    const document = await open();
    await waitForDiagnostics(uri, 1);

    await makeSimpleComplex(document);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(vscode.languages.getDiagnostics(uri).length, 1, 'typing must not trigger a run');

    assert.ok(await document.save());
    await waitForDiagnostics(uri, 2);
  });
});
