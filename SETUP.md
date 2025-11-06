# Quick Setup Guide

## Step 1: Install Dependencies

```bash
npm install
```

**Note:** This will automatically rebuild `better-sqlite3` for Electron via the postinstall script.

## Step 2: Configure API Key

1. Get your Anthropic API key from https://console.anthropic.com/
2. Open the `.env` file in the project root
3. Add your API key:
   ```
   ANTHROPIC_API_KEY=sk-ant-...your-key-here
   ```

## Step 3: Build the Application

```bash
npm run build:main
```

This compiles the TypeScript code for the Electron main process.

## Step 4: Run the Application

```bash
npm run dev
```

This will:
- Start the Vite dev server for the React frontend (http://localhost:5173)
- Launch the Electron app

## Troubleshooting

### "Module not found" errors
Run `npm install` again and make sure all dependencies are installed.

### "API key not set" errors
Double-check that your `.env` file contains the `ANTHROPIC_API_KEY` and restart the app.

### TypeScript compilation errors
Run `npm run build:main` to see detailed error messages.

### Skills not working
Make sure the `.claude/skills/` directory exists and contains the skill folders (word, excel, powerpoint).

## Using the Office Tools

Once the app is running, you can ask Claude to:

### Word Documents
- "Create a Word document with a report about AI"
- "Read the file at ~/Documents/report.docx"

### Excel Spreadsheets
- "Create a spreadsheet with sales data for Q1 2024"
- "Calculate the sum of column B in my sales spreadsheet"

### PowerPoint Presentations
- "Create a 5-slide presentation about our product"
- "Make a presentation from this outline: [your outline]"

## Project Structure

```
.
├── .claude/skills/         # Agent skills for Office tools
├── src/
│   ├── main/              # Electron main process
│   ├── renderer/          # React frontend
│   └── tools/             # Office tool implementations
├── dist/                  # Compiled output
└── .env                   # Your API key (git-ignored)
```

## Next Steps

- Customize the skills in `.claude/skills/` to add more capabilities
- Modify the UI in `src/renderer/components/`
- Add more Office tool operations in `src/tools/`

## Need Help?

Check the main README.md for detailed documentation and examples.
