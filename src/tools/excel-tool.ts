import ExcelJS from 'exceljs';

export class ExcelTool {
  /**
   * Read data from an Excel file
   */
  static async readSpreadsheet(filePath: string, sheetName?: string): Promise<any> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = sheetName
      ? workbook.getWorksheet(sheetName)
      : workbook.worksheets[0];

    if (!worksheet) {
      throw new Error(`Worksheet ${sheetName || '0'} not found`);
    }

    const data: any[][] = [];
    worksheet.eachRow((row, rowNumber) => {
      const rowData: any[] = [];
      row.eachCell((cell, colNumber) => {
        rowData.push(cell.value);
      });
      data.push(rowData);
    });

    return {
      sheetName: worksheet.name,
      data,
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount,
    };
  }

  /**
   * Create a new Excel spreadsheet
   */
  static async createSpreadsheet(
    filePath: string,
    sheets: Array<{
      name: string;
      data: any[][];
      headers?: string[];
      formulas?: Array<{ cell: string; formula: string }>;
    }>
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook();

    for (const sheetConfig of sheets) {
      const worksheet = workbook.addWorksheet(sheetConfig.name);

      // Add headers if provided
      if (sheetConfig.headers) {
        const headerRow = worksheet.addRow(sheetConfig.headers);
        headerRow.font = { bold: true };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' },
        };
      }

      // Add data
      sheetConfig.data.forEach((row) => {
        worksheet.addRow(row);
      });

      // Apply formulas
      if (sheetConfig.formulas) {
        sheetConfig.formulas.forEach(({ cell, formula }) => {
          worksheet.getCell(cell).value = { formula };
        });
      }

      // Auto-fit columns
      worksheet.columns.forEach((column) => {
        let maxLength = 0;
        column.eachCell?.({ includeEmpty: true }, (cell) => {
          const columnLength = cell.value ? cell.value.toString().length : 10;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
        column.width = Math.min(maxLength + 2, 50);
      });
    }

    await workbook.xlsx.writeFile(filePath);
  }

  /**
   * Add a chart to an existing spreadsheet
   */
  static async addChart(
    filePath: string,
    sheetName: string,
    chartConfig: {
      type: 'bar' | 'line' | 'pie';
      dataRange: string;
      title: string;
      position: string;
    }
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      throw new Error(`Worksheet ${sheetName} not found`);
    }

    // Note: ExcelJS doesn't have full chart support yet
    // This would need a library like xlsx-chart or direct XML manipulation
    console.log('Chart creation requested but requires additional implementation');

    await workbook.xlsx.writeFile(filePath);
  }

  /**
   * Update cells in an existing spreadsheet
   */
  static async updateCells(
    filePath: string,
    sheetName: string,
    updates: Array<{ cell: string; value: any }>
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      throw new Error(`Worksheet ${sheetName} not found`);
    }

    updates.forEach(({ cell, value }) => {
      worksheet.getCell(cell).value = value;
    });

    await workbook.xlsx.writeFile(filePath);
  }

  /**
   * Get summary statistics from a column
   */
  static async getColumnStats(
    filePath: string,
    sheetName: string,
    column: string
  ): Promise<{ sum: number; average: number; min: number; max: number; count: number }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      throw new Error(`Worksheet ${sheetName} not found`);
    }

    const values: number[] = [];
    worksheet.getColumn(column).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber > 1 && typeof cell.value === 'number') {
        values.push(cell.value);
      }
    });

    const sum = values.reduce((a, b) => a + b, 0);
    const average = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    return { sum, average, min, max, count: values.length };
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'read':
      ExcelTool.readSpreadsheet(args[1], args[2]).then((data) => console.log(JSON.stringify(data, null, 2))).catch(console.error);
      break;
    case 'create':
      const sheets = JSON.parse(args[2]);
      ExcelTool.createSpreadsheet(args[1], sheets).then(() => console.log('Spreadsheet created')).catch(console.error);
      break;
    case 'stats':
      ExcelTool.getColumnStats(args[1], args[2], args[3]).then((stats) => console.log(JSON.stringify(stats, null, 2))).catch(console.error);
      break;
    default:
      console.error('Unknown command');
  }
}
