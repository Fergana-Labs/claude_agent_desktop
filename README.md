# Claude Agent Desktop

A desktop application that lets you use Claude Agent without needing to install the Claude Code CLI. Get access to all the capabilities of Claude Code in an easy-to-use Electron app, plus some additional Claude Skills that are available in the Claude web app, but not the the standard Claude Code CLI.

## Features

- **Nicer UI for Claude Code**: A clean, modern desktop interface that wraps the powerful Claude Code CLI. No terminal setup or command-line knowledge required - just launch the app and start coding with Claude in a native desktop environment.

- **Comprehensive File Operations**: Claude can read, write, edit, and analyze files across your entire project. It understands code structure, can make precise edits using line-based modifications, and handles multiple file formats including source code, configuration files, and more.

- **Enhanced Claude Skills**: Includes premium [skills](https://www.claude.com/blog/skills) from the Claude web app that aren't available in the standard Claude Code CLI:
  - **Excel**: Create, read, edit, and analyze Microsoft Excel spreadsheets (.xlsx files) with formulas, calculations, and charts
  - **PowerPoint**: Generate and manipulate PowerPoint presentations (.pptx files) with slides, text, bullets, tables, and charts
  - **Word**: Create, read, edit, and format Microsoft Word documents (.docx files)

- **Powerful Development Tools**: Full access to Claude Code's toolkit including:
  - Bash command execution for running tests, builds, and scripts
  - Code search and navigation with glob patterns and grep
  - Git operations for version control
  - Web search and web fetching for up-to-date information
  - Task planning and management with todo lists

- **Persistent Conversations**: All conversations are automatically saved in a local SQLite database. Resume any previous session and maintain context across multiple coding tasks.

- **Bring Your Own API Key**: Use your own Anthropic API key for complete control over usage and billing. Your key is securely stored locally on your machine - no third-party servers involved.

## System Requirements

### For End Users (Pre-built Package)

If you're downloading a pre-built package from the [Releases](https://github.com/samzliu/claude_code_wrapper/releases) page, you only need:
- **Anthropic API Key**: You can grab one at [console.anthropic.com](https://console.anthropic.com/)

No build tools or development dependencies required!

### For Developers (Building from Source)

If you're building from source, you need:
- **Node.js**: Version 18 or higher
- **npm**: Version 8 or higher
- **Anthropic API Key**: You can grab one at [console.anthropic.com](https://console.anthropic.com/)
- **Build Tools** (for compiling native modules):
  - **macOS**: XCode Command Line Tools (`xcode-select --install`)
  - **Windows**: Visual Studio Build Tools or Windows Build Tools
  - **Linux**: `build-essential`, `python3`, and related packages

## Installation

### Option 1: Download Pre-built Package (Recommended)

1. **Download the latest release** from the [Releases](https://github.com/samzliu/claude_code_wrapper/releases) page:
   - **macOS**: Download the `.dmg` file
   - **Windows**: Download the `.exe` installer
   - **Linux**: Download the `.AppImage` file

2. **Install and run** the application

3. **Enter your API key** when prompted on first launch

### Option 2: Build from Source

1. **Clone the repository:**
   ```bash
   git clone https://github.com/samzliu/claude_code_wrapper.git
   cd claude_code_wrapper
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the application:**
   ```bash
   npm run build
   ```

4. **Start the app:**
   ```bash
   npm start
   ```

   Or for development mode with hot reload:
   ```bash
   npm run dev
   ```

## First-Time Setup

When you first launch the application, you'll be prompted to enter your Anthropic API key:

1. If you don't have an API key, visit [console.anthropic.com](https://console.anthropic.com/) to create an account and generate one
2. Paste your API key into the prompt when the app starts
3. Your key is securely stored locally on your machine in the app's user data directory
4. You only need to do this once - the app will remember your key for future sessions

## Usage

Once the app is running:

1. Start a conversation with Claude by typing in the message input
2. Ask Claude to help with coding tasks like:
   - Writing new functions or features
   - Debugging existing code
   - Refactoring code
   - Creating Excel spreadsheets or PowerPoint presentations
   - Running terminal commands
   - Reading and analyzing files
3. Claude will use the appropriate tools to complete your requests
4. All conversations are automatically saved and can be resumed later

## Configuration

The Claude Agent is configured in `src/main/claude-agent.ts`:

- **Model**: `claude-sonnet-4-5` (default) - Can be changed to `claude-opus-4-1` or `claude-haiku-4-5`
- **Available Tools**: `Skill`, `Read`, `Write`, `Bash`, and more
- **Skills Directory**: Located in your user data directory at `.claude/skills`
- **Session Storage**: Conversations are stored in a local SQLite database

### Changing the Claude Model

To use a different Claude model, edit `src/main/claude-agent.ts` and change the model parameter.

## Building Distribution Packages

To create distributable packages for different platforms:

```bash
npm run package
```

This will create installation files in the `release` directory:
- **macOS**: `.dmg` file
- **Windows**: `.exe` installer
- **Linux**: `.AppImage` file

## Troubleshooting

### API Key Issues

**Problem**: App says "API key not configured" or requests fail

**Solution**:
1. Delete the app's user data directory to reset configuration
2. Restart the app and enter your API key again
3. Verify your API key is valid at [console.anthropic.com](https://console.anthropic.com/)

### Build Errors

**Problem**: `npm install` or `npm run build` fails

**Solution**:
1. Ensure you're using Node.js 18 or higher (`node --version`)
2. Clear npm cache: `npm cache clean --force`
3. Delete `node_modules` and `package-lock.json`, then run `npm install` again

### App Won't Start

**Problem**: `npm start` doesn't launch the application

**Solution**:
1. Make sure you've run `npm run build` first
2. Check the terminal for error messages
3. Try running in development mode: `npm run dev`

## Project Structure

```
claude_code_wrapper/
├── src/
│   ├── main/          # Electron main process
│   ├── renderer/      # React UI
│   └── preload/       # Preload scripts
├── .claude/           # Claude skills configuration
├── dist/              # Compiled output
└── release/           # Distribution packages
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests on [GitHub](https://github.com/samzliu/claude_code_wrapper).

## Credits

- Built with [Electron](https://www.electronjs.org/)
- Powered by [Anthropic's Claude](https://www.anthropic.com/claude)
- Office skills from [claude-office-skills](https://github.com/tfriedel/claude-office-skills)
