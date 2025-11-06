# Troubleshooting Guide

## Black Screen Issue

If you see a black screen when launching the app:

### 1. Check if the Loading Message Appears

You should now see "Loading Claude Office Assistant..." instead of a black screen. If you see this:
- The React app is loading correctly
- The Electron preload script may not be working

### 2. Open Developer Tools

In the Electron window:
- **macOS**: Cmd+Option+I or View > Toggle Developer Tools
- **Windows/Linux**: Ctrl+Shift+I or View > Toggle Developer Tools

### 3. Check Console Messages

Look for these messages in the console:
- ✅ `"React app starting..."` - React is loading
- ✅ `"Electron API available: true"` - Preload script worked
- ❌ `"Electron API available: false"` - Preload script issue
- ❌ `"Electron API not available"` - App can't communicate with backend

### 4. Common Issues & Solutions

#### Issue: "Electron API not available"

**Cause**: Preload script isn't loading or context isolation issue

**Solution**:
1. Make sure the app was rebuilt: `npm run build:main`
2. Check that `dist/main/preload.js` exists
3. Restart the app completely (kill all processes)

#### Issue: Blank/white screen with no loading message

**Cause**: React app isn't loading at all

**Solution**:
1. Check that Vite server is running on port 5173
2. Look for errors in the console
3. Try: `npm run dev:renderer` separately to test Vite
4. Check if `http://localhost:5173` loads in a regular browser

#### Issue: "Failed to load URL" errors

**Cause**: Vite server not running or wrong URL

**Solution**:
1. Make sure both processes are running (renderer and main)
2. Check that `concurrently` is running both commands
3. Verify Vite shows "ready" message with port 5173

### 5. Manual Testing Steps

#### Test Vite Server Separately
```bash
# In terminal 1
npm run dev:renderer

# Wait for "VITE ready" message
# Open http://localhost:5173 in browser
# You should see the app interface
```

#### Test Electron Separately
```bash
# In terminal 2 (after Vite is running)
npm run build:main
NODE_ENV=development electron .
```

#### Test Preload Script
Add this to `src/renderer/main.tsx`:
```typescript
console.log('window.electron:', window.electron);
console.log('Available methods:', Object.keys(window.electron || {}));
```

### 6. Complete Reset

If nothing works:
```bash
# Kill all processes
pkill -f electron
pkill -f node

# Clean everything
rm -rf node_modules dist
npm install

# Rebuild
npm run build:main

# Try again
npm run dev
```

### 7. Check DevTools Console

The console should show:
```
React app starting...
Electron API available: true
```

If you see errors like:
- `window.electron is undefined` - Preload issue
- `Cannot read property 'getConversations'` - API not exposed
- `Failed to fetch` - Backend not responding

### 8. Verify File Structure

Check these files exist:
```
dist/main/
├── index.js
├── preload.js
├── claude-agent.js
└── conversation-manager.js

src/renderer/
├── index.html
├── main.tsx
├── App.tsx
└── components/
```

## Still Having Issues?

1. Check all console errors (both Electron console and terminal)
2. Verify API key is set in `.env`
3. Make sure better-sqlite3 is rebuilt: `npx electron-rebuild -f -w better-sqlite3`
4. Try running in production mode: `npm run build && npm run package`

## Getting Help

If the problem persists:
1. Copy all console errors
2. Check terminal output from `npm run dev`
3. Verify system requirements (Node 18+, Electron 28+)
4. Check if other Electron apps work on your system
