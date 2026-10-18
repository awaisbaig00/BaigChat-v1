#!/bin/sh
set -e

# If the current user is not root, skip chown and gosu steps and exec directly
if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

DATA_DIRECTORY="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIRECTORY"

# Only run chown when DATA_DIR is not already owned by node to keep boots fast
if [ "$(stat -c '%U' "$DATA_DIRECTORY" 2>/dev/null)" != "node" ] && [ "$(stat -c '%u' "$DATA_DIRECTORY" 2>/dev/null)" != "1000" ]; then
  chown -R node:node "$DATA_DIRECTORY"
fi

exec gosu node "$@"
