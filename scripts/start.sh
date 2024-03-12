#!/bin/bash

if [[! -d proc ]]; then mkdir proc; fi

start_process() {
  cmd="$1 $2"
  cin="proc/$1.cin"
  out="proc/$1.out"
  echo -n > $cin
  echo -n > $out
  ($cmd < $cin 2>&1 $out) &
  echo "started process $cmd with PID $!"
}

start_process "npm" "run dev"
start_process "npx" "tsx server/index.ts --port 3001 --dev"

