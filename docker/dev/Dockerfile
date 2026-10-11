# Exact tags keep builds reproducible; bump deliberately.
FROM node:22.23.3-bookworm

ARG UID=1000
ARG GID=1000

# PHP for the phpcca CLI used by the fixture workspace, Xvfb + Electron runtime libs for the VS Code E2E tests.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git unzip zip ca-certificates \
        php-cli php-xml php-mbstring php-zip \
        xvfb xauth dbus-x11 \
        libnss3 libgtk-3-0 libgbm1 libasound2 libxss1 libxkbfile1 libsecret-1-0 \
        libatk-bridge2.0-0 libdrm2 libxkbcommon0 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2.10.3 /usr/bin/composer /usr/local/bin/composer

# The base image ships a "node" user with uid/gid 1000; replace it so UID/GID build args always win.
RUN (userdel -r node 2>/dev/null || true) \
    && (getent group "${GID}" >/dev/null || groupadd --gid "${GID}" dev) \
    && useradd --create-home --no-log-init --shell /bin/bash --uid "${UID}" --gid "${GID}" dev \
    && git config --system --add safe.directory /app

# Pre-create mount points owned by dev so fresh named volumes inherit that ownership.
RUN mkdir -p /app/node_modules /app/.vscode-test /home/dev/.npm /home/dev/.cache/composer \
    && chown -R "${UID}:${GID}" /app /home/dev

WORKDIR /app
USER dev
