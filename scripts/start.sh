#!/bin/bash

npm_cmd=run dev
npx_cmd=tsx server/index.ts --port 3001 --dev

(npm $npm_cmd) &
echo "$!    npm    $npm_cmd"
(npx $npx_cmd) &
echo "$!    npx    $npx_cmd"
wait
