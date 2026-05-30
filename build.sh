#!/usr/bin/env bash
set -e

rm -rf packages/core/dist packages/core/tsconfig.tsbuildinfo
rm -rf packages/web/dist packages/web/tsconfig.tsbuildinfo
rm -rf packages/signaling/dist packages/signaling/tsconfig.tsbuildinfo

npm run build:core
npm run build:web
npm run build:signaling
