import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell } from 'docx';
import * as fs from 'fs';

export class WordTool {
  /**
   * Read a Word document and extract its text content
   */
  static async readDocument(filePath: string): Promise<string> {
    const docx = require('docx');
    const mammoth = require('mammoth'); // Better for reading

    try {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } catch (error) {
      throw new Error(`Failed to read Word document: ${error}`);
    }
  }

  /**
   * Create a new Word document with content
   */
  static async createDocument(
    filePath: string,
    content: {
      title?: string;
      paragraphs?: string[];
      headings?: Array<{ text: string; level: number }>;
      tables?: Array<{ headers: string[]; rows: string[][] }>;
    }
  ): Promise<void> {
    const sections: any[] = [];

    // Add title if provided
    if (content.title) {
      sections.push(
        new Paragraph({
          text: content.title,
          heading: HeadingLevel.TITLE,
        })
      );
    }

    // Add headings and paragraphs
    if (content.headings) {
      content.headings.forEach((heading) => {
        const level = this.getHeadingLevel(heading.level);
        sections.push(
          new Paragraph({
            text: heading.text,
            heading: level,
          })
        );
      });
    }

    // Add paragraphs
    if (content.paragraphs) {
      content.paragraphs.forEach((para) => {
        sections.push(
          new Paragraph({
            children: [new TextRun(para)],
          })
        );
      });
    }

    // Add tables
    if (content.tables) {
      content.tables.forEach((tableData) => {
        const rows = [
          // Header row
          new TableRow({
            children: tableData.headers.map(
              (header) =>
                new TableCell({
                  children: [new Paragraph({ text: header })],
                })
            ),
          }),
          // Data rows
          ...tableData.rows.map(
            (row) =>
              new TableRow({
                children: row.map(
                  (cell) =>
                    new TableCell({
                      children: [new Paragraph({ text: cell })],
                    })
                ),
              })
          ),
        ];

        sections.push(
          new Table({
            rows,
          })
        );
      });
    }

    const doc = new Document({
      sections: [
        {
          children: sections,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
  }

  /**
   * Append content to an existing Word document
   */
  static async appendToDocument(filePath: string, paragraphs: string[]): Promise<void> {
    // Note: Appending to existing docs is complex with docx library
    // This is a simplified version - in production you'd need to read, modify, and rewrite
    const existingContent = await this.readDocument(filePath);
    const newParagraphs = [existingContent, ...paragraphs];

    await this.createDocument(filePath, { paragraphs: newParagraphs });
  }

  private static getHeadingLevel(level: number): HeadingLevel {
    switch (level) {
      case 1:
        return HeadingLevel.HEADING_1;
      case 2:
        return HeadingLevel.HEADING_2;
      case 3:
        return HeadingLevel.HEADING_3;
      case 4:
        return HeadingLevel.HEADING_4;
      case 5:
        return HeadingLevel.HEADING_5;
      case 6:
        return HeadingLevel.HEADING_6;
      default:
        return HeadingLevel.HEADING_1;
    }
  }
}

// CLI interface for use as a skill
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'read':
      WordTool.readDocument(args[1]).then(console.log).catch(console.error);
      break;
    case 'create':
      const content = JSON.parse(args[2]);
      WordTool.createDocument(args[1], content).then(() => console.log('Document created')).catch(console.error);
      break;
    default:
      console.error('Unknown command. Use: read <path> or create <path> <json>');
  }
}
