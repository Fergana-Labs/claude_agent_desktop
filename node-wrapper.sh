#!/bin/bash
# Wrapper script to call node with full path
# This ensures the Claude Agent SDK can spawn node successfully in Electron
exec /usr/local/bin/node "$@"
