# Publishing

The extension is published to two registries from the same `.vsix`.
The VS Code Marketplace serves VS Code.
Open VSX serves VSCodium, Cursor, Windsurf, Gitpod and other forks.

## One-time setup

These steps need the account owner and cannot be automated.

### VS Code Marketplace

1. Create an Azure DevOps organization at https://dev.azure.com if you do not have one.
2. Create a Personal Access Token in that organization.
3. Set the scope to *Marketplace → Manage*.
4. Set the organization to *All accessible organizations*, otherwise publishing fails with an authorization error.
5. Create the publisher `phauthentic` at https://marketplace.visualstudio.com/manage.
6. The publisher ID must match the `publisher` field in `package.json`.

### Open VSX

1. Create an Eclipse account at https://accounts.eclipse.org and link your GitHub username.
2. Log in at https://open-vsx.org with GitHub and sign the Eclipse publisher agreement in your profile settings.
3. Generate an access token at https://open-vsx.org/user-settings/tokens.
4. Create the namespace once: `make shell`, then `npx ovsx create-namespace phauthentic -p <token>`.

### Repository

1. Create the environment `release` in the repository settings.
2. Add required reviewers to it if you want a manual approval before each publish.
3. Add the secrets `VSCE_PAT` and `OVSX_PAT` to that environment.

## Releasing

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Run `make install lint test package` locally and check the `.vsix` with `docker compose run --rm dev npx vsce ls`.
3. Merge to `master`.
4. Tag the merge commit and push the tag, for example `git tag v0.1.0 && git push origin v0.1.0`.
5. The `Release` workflow checks that the tag equals `v` plus the `package.json` version and that the tagged commit is on `master`.
6. It then runs lint, compile and all tests and packages the extension.
7. It publishes that exact `.vsix` with `vsce` and `ovsx` in separate steps, then creates a GitHub Release with the `.vsix` attached.
8. Publishing uses `--skip-duplicate`, and the steps do not depend on each other, so after a partial failure you can simply re-run the failed workflow run.

## Dry run

Start the `Release` workflow manually with `dry_run` enabled, which is the default.
It builds, tests and packages and uploads the `.vsix` as an artifact, but does not publish or create a release.
