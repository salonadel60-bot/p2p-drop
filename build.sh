#!/usr/bin/env bash
set -e

# Clean stale build artifacts to avoid incremental build cache issues
rm -rf packages/core/dist packages/core/tsconfig.tsbuildinfo
rm -rf packages/web/dist packages/web/tsconfig.tsbuildinfo

npm run build:core
npm run build:web
