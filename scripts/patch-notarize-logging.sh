#!/bin/bash
# Patch @electron/notarize to show the full error message

NOTARIZE_FILE="node_modules/app-builder-lib/node_modules/@electron/notarize/lib/notarytool.js"

if [ ! -f "$NOTARIZE_FILE" ]; then
    echo "Error: Could not find $NOTARIZE_FILE"
    exit 1
fi

# Check if already patched
if grep -q "FULL ERROR OUTPUT" "$NOTARIZE_FILE"; then
    echo "Already patched!"
    exit 0
fi

# Create backup
cp "$NOTARIZE_FILE" "${NOTARIZE_FILE}.backup"

# Add logging before the JSON.parse on line 105
sed -i.tmp '105i\
            console.log("====== FULL ERROR OUTPUT FROM NOTARYTOOL ======");\
            console.log("Exit code:", result.code);\
            console.log("Raw output:", result.output);\
            console.log("================================================");\
' "$NOTARIZE_FILE"

rm "${NOTARIZE_FILE}.tmp"

echo "✅ Patched notarytool.js to show full error output"
echo "Run 'npm run package' again to see the detailed error"
