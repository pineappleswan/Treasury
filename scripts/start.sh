#!/bin/bash

(npm run build) &
npx tsx server/index.ts --port 3001 --secure-cookies false

wait
