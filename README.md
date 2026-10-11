# Cognitive Code Analysis for VS Code

Live cognitive complexity feedback for PHP while you edit.
The extension runs [phpcca](https://github.com/Phauthentic/cognitive-code-analysis) on the file you are working on and shows every method above your `scoreThreshold` as a diagnostic.

## Features

- Squiggles on the declaration line of each method that exceeds the threshold, listed in the Problems panel.
- Unsaved edits are analysed, so feedback follows what you type.
- Severity follows phpcca: warning above the threshold, error at twice the threshold or more.
- Your project's `phpcca.yaml` is honoured, including thresholds, metric weights and exclude patterns.
- No runtime dependencies, nothing leaves your machine.

## Requirements

- PHP and `phauthentic/cognitive-code-analysis` 1.11 or later with SARIF report support, for example `composer require --dev phauthentic/cognitive-code-analysis`.
- Linux or macOS. The extension is tested on Linux and macOS only. On Windows it runs `php <phpcca>` and is untested.
- A trusted workspace, because the extension runs the `phpcca` executable of the project.

## Install

Install "Cognitive Code Analysis" from the VS Code Marketplace or from Open VSX (VSCodium, Cursor, Windsurf, Gitpod).
To install a local build, run `make package` and then `code --install-extension dist/*.vsix`.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `phpcca.enable` | `true` | Show cognitive complexity diagnostics for PHP files. |
| `phpcca.executable` | `vendor/bin/phpcca` | Path to `phpcca`. Relative paths are resolved against the workspace folder. If the default does not exist, `phpcca` from `PATH` is used. |
| `phpcca.phpExecutable` | `php` | PHP binary used to run `phpcca` on Windows. Ignored on Linux and macOS. |
| `phpcca.configFile` | empty | Config file passed as `-c`. If empty, `phpcca.yaml` in the workspace folder is used when present. |
| `phpcca.runOn` | `type` | `type` analyses on open and, debounced, while typing. `save` analyses on open and on save. |
| `phpcca.debounceMs` | `500` | Delay after the last keystroke before analysing. |

## How it works

For each analysis the extension writes the current buffer to a fresh temporary directory and runs `phpcca analyse <tmp file> -r sarif -f <report> [-c <config>]` there.
The temporary file mirrors the path of the document relative to the workspace folder, so `excludeFilePatterns` that match directories or file names keep working.
Patterns that match an absolute path will not match the temporary copy.
The config is always passed as an absolute `-c` path, either `phpcca.configFile` or `phpcca.yaml` from the workspace folder.
phpcca writes its `./.phpcca.cache` relative to the working directory, and it creates that directory even when caching is disabled.
Because the working directory is the temporary directory, your project never receives cache files and nothing is left behind.
Relative paths inside your config (for example custom reporter files) are resolved against the temporary directory, not your project.
A newer analysis or an edit cancels the running one for the same document, and results for an outdated version of the buffer are dropped.

The thresholds come from the config file, so there is no extension setting for them.

Errors from phpcca (missing executable, invalid config) are written once per distinct message to the "Cognitive Code Analysis" output channel.

## Development

Everything runs in Docker, so you do not need Node, PHP or Composer on the host.

```sh
make build      # build the dev image
make install    # npm ci and composer install for the E2E fixture
make lint       # ESLint and tsc --noEmit
make compile    # compile TypeScript to out/
make test-unit  # mocha unit tests
make test-e2e   # VS Code E2E tests under Xvfb, against a real phpcca install
make test       # unit and E2E tests
make package    # build dist/*.vsix
make shell      # shell in the dev container
```

The E2E fixture lives in `test/fixtures/workspace`.
It requires `phauthentic/cognitive-code-analysis` from Packagist and uses a low threshold with one complex and one simple method.

To debug with F5, use "Reopen in Container" (`.devcontainer/devcontainer.json`) and pick "Run Extension (fixture workspace)".

Release steps and marketplace setup are described in [docs/Publishing.md](docs/Publishing.md).

## License

GPL-3.0-only, see [LICENSE](LICENSE).
