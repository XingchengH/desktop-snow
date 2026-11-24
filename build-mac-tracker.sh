#!/usr/bin/env bash
set -euo pipefail

cpu="${1:?Specify arm64 or x86_64}"
target="$cpu-apple-macos13.0"
node_headers="$(node -p 'require("node:path").resolve(process.execPath, "../../include/node")')"
mkdir -p build
swiftc -O -module-cache-path build/swift-cache -target "$target" windows.swift -o build/desktop-snow-tracker
clang++ -O2 -fobjc-arc -target "$target" -bundle -undefined dynamic_lookup \
  -I "$node_headers" -framework AppKit -framework ApplicationServices \
  finder-icons.mm -o build/finder-icons.node
