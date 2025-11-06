# Claude Office Assistant

An Electron desktop application that integrates Claude AI with Microsoft Office tools (Word, Excel, PowerPoint). Built with React, TypeScript, and the Claude Agent SDK.

## Features

- **AI-Powered Chat Interface**: Interactive chat with Claude AI using streaming responses with thinking visibility
- **Microsoft Office Integration**: Create, read, and manipulate Office documents
  - Word (.docx) - Create documents, add paragraphs, tables, and formatting
  - Excel (.xlsx) - Create spreadsheets, formulas, charts, and data analysis
  - PowerPoint (.pptx) - Create presentations with slides, text, and visuals
- **Multi-Conversation Management**:
  - Persistent conversation storage with SQLite
  - Per-conversation project folders
  - Isolated conversation environments (switch between conversations without interference)
  - Activity indicators when conversations receive updates in background
- **Advanced Features**:
  - Streaming input mode (queue messages while Claude responds)
  - Message interruption (Stop button)
  - Permission modes: Ask, Accept Edits, Auto-Accept, Plan
  - Real-time tool execution visualization
- **Modern UI**: Dark-themed, responsive interface built with React

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Anthropic API key

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd desktop_claude_code
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:

   Edit `.env` and add your Anthropic API key (get one from https://console.anthropic.com/):
   ```
   ANTHROPIC_API_KEY=your_api_key_here
   ```

4. Build the TypeScript files:
   ```bash
   npm run build:main
   ```

## Development

Run the app in development mode:

```bash
npm run dev
```

This will start:
- Vite dev server for the React frontend (port 5173)
- Electron app in development mode

## Building

Build the app for production:

```bash
npm run build
npm run package
```

This will create platform-specific installers in the `release/` directory.

## Project Structure

```
.
├── src/
│   ├── main/                 # Electron main process
│   │   ├── index.ts          # Main entry point
│   │   ├── claude-agent.ts   # Claude Agent SDK wrapper
│   │   ├── conversation-manager.ts  # SQLite conversation storage
│   │   └── preload.ts        # Preload script for IPC
│   ├── renderer/             # React frontend
│   │   ├── components/       # React components
│   │   ├── App.tsx           # Main app component
│   │   └── main.tsx          # React entry point
│   └── tools/                # Office tool implementations
│       ├── word-tool.ts      # Word document operations
│       ├── excel-tool.ts     # Excel spreadsheet operations
│       └── powerpoint-tool.ts # PowerPoint presentation operations
├── .claude/
│   └── skills/               # Agent skills for Office tools
│       ├── word/
│       ├── excel/
│       └── powerpoint/
└── package.json
```

## Usage

### Basic Chat

1. Launch the application
2. Type your message in the input area
3. Press Enter or click Send
4. Claude will respond with streaming text

### Working with Office Documents

**Word Documents:**
```
"Create a new Word document with a title 'Project Report' and three paragraphs about AI"
"Read the contents of ~/Documents/report.docx"
"Add a table with 3 columns to the document"
```

**Excel Spreadsheets:**
```
"Create a spreadsheet with monthly sales data for Q1"
"Read data from ~/Documents/sales.xlsx"
"Add a sum formula to calculate total revenue"
"Get statistics for column B in the sales sheet"
```

**PowerPoint Presentations:**
```
"Create a presentation about our product with 5 slides"
"Add a new slide with bullet points listing our features"
"Create a presentation from this outline: [outline]"
```

### File Attachments

1. Click the 📎 attachment button
2. Enter the file path (e.g., `/path/to/document.docx`)
3. The file will be referenced in your message to Claude

### Conversation Management

- **New Conversation**: Click "+ New Chat" in the sidebar and select a project folder
- **Switch Conversations**: Click on any conversation in the sidebar
  - Each conversation maintains its own isolated environment
  - Messages sent in one conversation don't interfere with others
  - Activity indicators ("New" badge) show when a conversation receives updates while viewing another
- **Delete Conversation**: Hover over a conversation and click the × button
- **Folder Validation**: Conversations with missing project folders are marked (read-only access)

### Permission Modes

Control how Claude handles file operations and tool usage:

- **Ask** (default): Request permission for each operation
- **Accept Edits**: Auto-approve edit operations, ask for others
- **Auto-Accept**: Approve all operations automatically
- **Plan**: Plan mode for task planning

Change the mode using the dropdown in the chat header.

### Message Control

- **Queue Messages**: Type and send messages even while Claude is responding
- **Interrupt**: Click the Stop button to interrupt Claude's current response

## Architecture

### Claude Agent SDK Integration

The app uses the official Claude Agent SDK with:
- **Streaming Input Mode**: Async generator pattern for message queueing
- **Custom Skills**: Office document manipulation tools
- **Session Management**: Per-conversation session persistence
- **Permission Control**: Query-level permission mode setting
- **Interruption Support**: Graceful message interruption via Query.interrupt()
- **Thinking Visibility**: Real-time visibility into Claude's reasoning process

### IPC Communication

Electron IPC provides secure communication between:
- **Renderer Process** (React UI) → sends user messages
- **Main Process** → executes Claude Agent SDK and Office tools
- **Streaming Events** → real-time token delivery to UI with conversation ID tagging

All events include a `conversationId` to ensure messages are routed to the correct conversation, enabling true multi-conversation isolation.

### Office Tools

Each Office tool is implemented as:
1. **Skill Definition** (`.claude/skills/*/SKILL.md`) - Describes the tool to Claude
2. **Implementation** (`src/tools/*-tool.ts`) - TypeScript class with operations
3. **CLI Interface** - Can be invoked by Claude via Bash tool

## Configuration

### Claude Agent Settings

The Agent SDK is configured in `src/main/claude-agent.ts`:
- Model: `claude-sonnet-4-5-20250929`
- Allowed tools: `Skill`, `Read`, `Write`, `Bash`
- Skills path: User data directory + `.claude/skills`
- Streaming input mode: Enabled via async generator pattern
- Session persistence: Per-conversation session IDs stored in SQLite
- Permission modes: Set via `Query.setPermissionMode()`

### Electron Builder

Build configuration in `package.json`:
- macOS: DMG installer
- Windows: NSIS installer
- Linux: AppImage

## Troubleshooting

### Native Module Errors (better-sqlite3)
If you see errors about `NODE_MODULE_VERSION` mismatch:
```bash
npx electron-rebuild -f -w better-sqlite3
```
This is handled automatically by the postinstall script, but you can run it manually if needed.

### API Key Issues
- Ensure `ANTHROPIC_API_KEY` is set in `.env`
- Restart the app after changing environment variables
- The .env file should be in the project root directory

### Office Tool Errors
- Check that file paths are absolute and accessible
- Ensure you have write permissions for output directories
- Verify that input files are valid Office documents

### Conversation Issues
- **Messages going to wrong conversation**: Fixed - each conversation now has isolated state
- **Can't access conversation with missing folder**: You can view messages but can't send new ones until the folder is restored
- **Activity indicators not clearing**: Click into the conversation to clear the "New" badge

### Build Issues
- Clear `dist/` and `node_modules/`, then reinstall: `npm clean-install`
- Ensure all TypeScript files compile: `npm run build`
- For Electron rebuild issues: `npm run postinstall`

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
