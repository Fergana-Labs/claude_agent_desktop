import PptxGenJS from 'pptxgenjs';

export class PowerPointTool {
  /**
   * Create a new PowerPoint presentation
   */
  static async createPresentation(
    filePath: string,
    config: {
      title?: string;
      author?: string;
      slides: Array<{
        type: 'title' | 'content' | 'section' | 'blank';
        title?: string;
        subtitle?: string;
        content?: string[];
        images?: Array<{ path: string; x: number; y: number; w: number; h: number }>;
        tables?: Array<{ headers: string[]; rows: string[][] }>;
        charts?: Array<{
          type: 'bar' | 'line' | 'pie';
          data: any[];
          options?: any;
        }>;
      }>;
    }
  ): Promise<void> {
    const pptx = new PptxGenJS();

    // Set presentation properties
    if (config.author) {
      pptx.author = config.author;
    }
    if (config.title) {
      pptx.title = config.title;
    }

    // Create slides
    for (const slideConfig of config.slides) {
      const slide = pptx.addSlide();

      switch (slideConfig.type) {
        case 'title':
          this.createTitleSlide(slide, slideConfig);
          break;
        case 'content':
          this.createContentSlide(slide, slideConfig);
          break;
        case 'section':
          this.createSectionSlide(slide, slideConfig);
          break;
        default:
          // Blank slide or custom
          if (slideConfig.title) {
            slide.addText(slideConfig.title, {
              x: 0.5,
              y: 0.5,
              w: 9,
              h: 1,
              fontSize: 32,
              bold: true,
              color: '363636',
            });
          }
      }

      // Add images
      if (slideConfig.images) {
        slideConfig.images.forEach((img) => {
          slide.addImage({
            path: img.path,
            x: img.x,
            y: img.y,
            w: img.w,
            h: img.h,
          });
        });
      }

      // Add tables
      if (slideConfig.tables) {
        slideConfig.tables.forEach((table, index) => {
          const tableData = [table.headers, ...table.rows];
          slide.addTable(tableData, {
            x: 0.5,
            y: 2 + index * 2,
            w: 9,
            h: 2,
            fontSize: 12,
            border: { pt: 1, color: '363636' },
            fill: { color: 'F7F7F7' },
          });
        });
      }

      // Add charts
      if (slideConfig.charts) {
        slideConfig.charts.forEach((chart, index) => {
          this.addChart(slide, chart, index);
        });
      }
    }

    await pptx.writeFile({ fileName: filePath });
  }

  private static createTitleSlide(slide: any, config: any) {
    // Title
    if (config.title) {
      slide.addText(config.title, {
        x: 0.5,
        y: 2,
        w: 9,
        h: 1.5,
        fontSize: 44,
        bold: true,
        color: '363636',
        align: 'center',
      });
    }

    // Subtitle
    if (config.subtitle) {
      slide.addText(config.subtitle, {
        x: 0.5,
        y: 3.5,
        w: 9,
        h: 1,
        fontSize: 24,
        color: '666666',
        align: 'center',
      });
    }
  }

  private static createContentSlide(slide: any, config: any) {
    // Title
    if (config.title) {
      slide.addText(config.title, {
        x: 0.5,
        y: 0.5,
        w: 9,
        h: 0.75,
        fontSize: 32,
        bold: true,
        color: '363636',
      });
    }

    // Content bullets
    if (config.content && config.content.length > 0) {
      const bulletPoints = config.content.map((text) => ({
        text,
        options: { bullet: true, fontSize: 18, color: '363636' },
      }));

      slide.addText(bulletPoints, {
        x: 0.5,
        y: 1.5,
        w: 9,
        h: 4,
      });
    }
  }

  private static createSectionSlide(slide: any, config: any) {
    slide.background = { color: '0088CC' };

    if (config.title) {
      slide.addText(config.title, {
        x: 0.5,
        y: 2.5,
        w: 9,
        h: 1.5,
        fontSize: 48,
        bold: true,
        color: 'FFFFFF',
        align: 'center',
      });
    }
  }

  private static addChart(slide: any, chartConfig: any, index: number) {
    const chartTypes: { [key: string]: any } = {
      bar: pptx.ChartType.bar,
      line: pptx.ChartType.line,
      pie: pptx.ChartType.pie,
    };

    slide.addChart(chartTypes[chartConfig.type] || pptx.ChartType.bar, chartConfig.data, {
      x: 1,
      y: 2 + index * 3,
      w: 8,
      h: 3,
      ...chartConfig.options,
    });
  }

  /**
   * Create a simple presentation from text outline
   */
  static async createFromOutline(
    filePath: string,
    outline: {
      title: string;
      slides: Array<{ title: string; points: string[] }>;
    }
  ): Promise<void> {
    const slides = [
      {
        type: 'title' as const,
        title: outline.title,
        subtitle: `${outline.slides.length} slides`,
      },
      ...outline.slides.map((slide) => ({
        type: 'content' as const,
        title: slide.title,
        content: slide.points,
      })),
    ];

    await this.createPresentation(filePath, { title: outline.title, slides });
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'create':
      const config = JSON.parse(args[2]);
      PowerPointTool.createPresentation(args[1], config)
        .then(() => console.log('Presentation created'))
        .catch(console.error);
      break;
    case 'outline':
      const outline = JSON.parse(args[2]);
      PowerPointTool.createFromOutline(args[1], outline)
        .then(() => console.log('Presentation created from outline'))
        .catch(console.error);
      break;
    default:
      console.error('Unknown command');
  }
}
