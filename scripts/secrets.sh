#!/usr/bin/env bash
# Creates .env from .env.example. The values are external database credentials,
# so nothing can be generated - this only creates the file and says what to fill in.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env already exists - left alone"
else
  cp .env.example .env
  echo "Created .env from .env.example"
fi

missing=""
for key in HOST DB USER PASSWORD; do
  grep -qE "^${key}=.+$" .env || missing="${missing} ${key}"
done

if [ -n "$missing" ]; then
  echo "Still to fill in:${missing}"
  echo "The stack starts without them; database features stay inert until they are set."
else
  echo "All database credentials are set."
fi
