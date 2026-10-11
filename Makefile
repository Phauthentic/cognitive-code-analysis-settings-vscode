.DEFAULT_GOAL := help

export HOST_UID := $(shell id -u)
export HOST_GID := $(shell id -g)

# CI sets RUN_FLAGS=-T because there is no TTY.
RUN_BASE := docker compose run --rm $(RUN_FLAGS)
RUN := $(RUN_BASE) dev

help:
	@echo "Available commands:"
	@echo "  - build:     Build the dev image"
	@echo "  - install:   npm ci and composer install for the E2E fixture"
	@echo "  - lint:      ESLint and tsc --noEmit"
	@echo "  - compile:   Compile TypeScript to out/"
	@echo "  - test-unit: Run mocha unit tests"
	@echo "  - test-e2e:  Run VS Code E2E tests under Xvfb"
	@echo "  - test:      Run unit and E2E tests"
	@echo "  - package:   Build the .vsix into dist/"
	@echo "  - shell:     Open a shell in the dev container"
	@echo "  - publish:   Publish (also publish-vsce, publish-ovsx) dist/*.vsix (run make package first) to both marketplaces; needs VSCE_PAT and OVSX_PAT"

# Mount points are created on the host first so Docker does not create them as root.
prepare:
	@mkdir -p node_modules .vscode-test dist

build:
	docker compose build dev

install: prepare
	$(RUN) npm ci
	$(RUN) composer install --working-dir=test/fixtures/workspace --no-interaction --no-progress

lint: prepare
	$(RUN) npm run lint

compile: prepare
	$(RUN) npm run compile

test-unit: prepare
	$(RUN) npm run test:unit

test-e2e: prepare
	$(RUN) xvfb-run -a npm run test:e2e

test: test-unit test-e2e

package: prepare
	$(RUN) npm run package

shell: prepare
	docker compose run --rm dev /bin/bash

# Publish the already built dist/*.vsix. Secrets are passed only here. vsce reads VSCE_PAT and ovsx reads OVSX_PAT.
# --skip-duplicate makes re-runs after a partial failure safe.
publish-vsce: prepare
	$(RUN_BASE) -e VSCE_PAT dev sh -c 'npx vsce publish --packagePath dist/*.vsix --skip-duplicate'

publish-ovsx: prepare
	$(RUN_BASE) -e OVSX_PAT dev sh -c 'npx ovsx publish dist/*.vsix --skip-duplicate'

publish: publish-vsce publish-ovsx

.PHONY: help prepare build install lint compile test-unit test-e2e test package shell publish publish-vsce publish-ovsx
