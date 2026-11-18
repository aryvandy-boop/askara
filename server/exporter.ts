import fs from 'node:fs';
import path from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import { Resvg } from '@resvg/resvg-js';

export interface ExportBundleData {
  project: any;
  template: any;
  formatting: any;
  schoolProfile: any;
  blueprints: any[];
  questions: any[];
  cognitiveSummary: any;
}

const CM_TO_TWIPS = 567;
const CM_TO_PT = 28.3465;

const NO_CELL_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function resolveFontSizeHalfPt(gradeLevel: string, formatting: any): number {
  const g = (gradeLevel || '').toLowerCase();
  if (
    g.includes('1') ||
    (g.includes(' i') && !g.includes('ii') && !g.includes('iv') && !g.includes('vi')) ||
    g.includes('2') ||
    (g.includes(' ii') && !g.includes('iii'))
  ) {
    return Number(formatting?.fontSizeClass12 || 14) * 2;
  }
  if (g.includes('6') || g.includes('vi')) {
    return Number(formatting?.fontSizeClass6 || 12) * 2;
  }
  return Number(formatting?.fontSizeClass345 || 12) * 2;
}

function resolveFontSizePt(gradeLevel: string, formatting: any): number {
  return resolveFontSizeHalfPt(gradeLevel, formatting) / 2;
}

function rasterizeSvgToPng(svgInput: string | Buffer, width = 260): Buffer | null {
  try {
    const svgText = Buffer.isBuffer(svgInput) ? svgInput.toString('utf8') : svgInput;
    const resvg = new Resvg(svgText, {
      fitTo: { mode: 'width', value: width },
      background: '#ffffff',
    });
    return Buffer.from(resvg.render().asPng());
  } catch {
    return null;
  }
}

export function loadImageBuffer(imageUrl: string): { buffer: Buffer; type: 'png' | 'jpg' } | null {
  try {
    if (!imageUrl) return null;
    if (imageUrl.startsWith('data:image/png;base64,')) {
      return { buffer: Buffer.from(imageUrl.split(',')[1], 'base64'), type: 'png' };
    }
    if (imageUrl.startsWith('data:image/jpeg;base64,') || imageUrl.startsWith('data:image/jpg;base64,')) {
      return { buffer: Buffer.from(imageUrl.split(',')[1], 'base64'), type: 'jpg' };
    }
    if (imageUrl.startsWith('data:image/svg+xml;base64,')) {
      const svgRaw = Buffer.from(imageUrl.split(',')[1], 'base64').toString('utf8');
      const png = rasterizeSvgToPng(svgRaw);
      return png ? { buffer: png, type: 'png' } : null;
    }
    if (imageUrl.startsWith('data:image/svg+xml')) {
      const commaIdx = imageUrl.indexOf(',');
      if (commaIdx !== -1) {
        const rawPart = imageUrl.slice(commaIdx + 1);
        const svgRaw = imageUrl.includes(';utf8,') || rawPart.includes('%3C') ? decodeURIComponent(rawPart) : rawPart;
        const png = rasterizeSvgToPng(svgRaw);
        return png ? { buffer: png, type: 'png' } : null;
      }
    }

    let diskPath = '';
    if (imageUrl.startsWith('/assets/')) {
      diskPath = path.resolve(process.cwd(), 'public', imageUrl.slice(1));
    } else if (imageUrl.startsWith('/uploads/')) {
      diskPath = path.resolve(process.cwd(), imageUrl.slice(1));
    }

    if (diskPath && fs.existsSync(diskPath)) {
      const lower = diskPath.toLowerCase();
      if (lower.endsWith('.png')) return { buffer: fs.readFileSync(diskPath), type: 'png' };
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return { buffer: fs.readFileSync(diskPath), type: 'jpg' };
      if (lower.endsWith('.svg')) {
        const png = rasterizeSvgToPng(fs.readFileSync(diskPath, 'utf8'));
        return png ? { buffer: png, type: 'png' } : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function getImageDimensions(buffer: Buffer, type: 'png' | 'jpg'): { width: number; height: number } | null {
  try {
    if (type === 'png' && buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }
    if (type === 'jpg' && buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buffer.length) {
        if (buffer[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buffer[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        if (marker === 0xd9 || marker === 0xda) break;
        const segLen = buffer.readUInt16BE(i + 2);
        if (segLen < 2) break;
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc &&
          i + 9 < buffer.length
        ) {
          const height = buffer.readUInt16BE(i + 5);
          const width = buffer.readUInt16BE(i + 7);
          if (width > 0 && height > 0) return { width, height };
        }
        i += 2 + segLen;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function fitDimensions(
  buffer: Buffer,
  type: 'png' | 'jpg',
  maxWidth: number,
  targetHeight: number
): { width: number; height: number } {
  const dims = getImageDimensions(buffer, type);
  if (!dims) {
    const side = Math.min(maxWidth, targetHeight);
    return { width: side, height: side };
  }
  let h = targetHeight;
  let w = Math.round(targetHeight * (dims.width / dims.height));
  if (w > maxWidth) {
    w = maxWidth;
    h = Math.max(24, Math.round(maxWidth * (dims.height / dims.width)));
  }
  return { width: Math.max(24, w), height: Math.max(24, h) };
}

function resolveAssessmentTitle(assessmentType: string, semester: string): string {
  const raw = (assessmentType || 'SUMATIF AKHIR SEMESTER').trim();
  const semNum = semester === '2' ? '2' : '1';
  const cleaned = raw.replace(/\s*\([^)]*\)\s*$/g, '').trim().toUpperCase();
  if (cleaned.includes('SUMATIF AKHIR SEMESTER') || cleaned.includes('SUMATIF TENGAH SEMESTER') || cleaned.includes('PENILAIAN AKHIR SEMESTER') || cleaned.includes('PENILAIAN TENGAH SEMESTER')) {
    return `${cleaned} ${semNum}`;
  }
  return cleaned;
}

function applyKopTokens(line: string, project: any): string {
  const academicYear = project?.academic_year || '2026/2027';
  const semNum = project?.semester === '2' ? '2' : '1';
  const jenisAsesmen = resolveAssessmentTitle(project?.assessment_type || 'Sumatif Akhir Semester', semNum);
  return (line || '')
    .replace(/\[TAHUN PELAJARAN\]/gi, academicYear)
    .replace(/\[SEMESTER\]/gi, semNum)
    .replace(/\[JENIS ASESMEN\]/gi, jenisAsesmen);
}

function formatGradeAndSemester(gradeLevel: string, semester: string): string {
  const semLabel = semester === '2' ? 'Genap' : 'Ganjil';
  let g = (gradeLevel || '').replace(/^kelas\s+/i, '').trim();
  const romanMap: Record<string, string> = {
    '1': 'I',
    '2': 'II',
    '3': 'III',
    '4': 'IV',
    '5': 'V',
    '6': 'VI',
    '7': 'VII',
    '8': 'VIII',
    '9': 'IX',
    '10': 'X',
    '11': 'XI',
    '12': 'XII',
  };
  if (romanMap[g]) g = romanMap[g];
  g = g.replace(/^PAUD\s*\/\s*/i, '');
  return `${g || '-'} / ${semLabel}`;
}

function sortQuestionsByExamSection(questions: any[]): Array<{ sectionType: string; items: any[] }> {
  const rank = (qType: string) => {
    const t = (qType || '').toLowerCase();
    if (t.includes('pilihan ganda kompleks')) return 2;
    if (t.includes('pilihan ganda')) return 1;
    if (t.includes('benar') || t.includes('salah')) return 3;
    if (t.includes('jodoh')) return 4;
    if (t.includes('isian') || t.includes('pendek')) return 5;
    return 6;
  };
  const ordered = [...questions].sort((a, b) => {
    const ra = rank(a.question_type || '');
    const rb = rank(b.question_type || '');
    if (ra !== rb) return ra - rb;
    return Number(a.question_number || 0) - Number(b.question_number || 0);
  });

  const grouped: Array<{ sectionType: string; items: any[] }> = [];
  for (const q of ordered) {
    const key = q.question_type || 'Pilihan Ganda';
    let entry = grouped.find((g) => g.sectionType === key);
    if (!entry) {
      entry = { sectionType: key, items: [] };
      grouped.push(entry);
    }
    entry.items.push(q);
  }
  return grouped;
}

function getSectionInstruction(qType: string): string {
  const t = (qType || '').toLowerCase();
  if (t.includes('pilihan ganda kompleks')) {
    return 'Berilah tanda centang (✓) pada lebih dari satu jawaban yang benar!';
  }
  if (t.includes('pilihan ganda')) {
    return 'Berilah tanda silang (x) pada huruf a, b, c atau d di depan jawaban yang paling benar!';
  }
  if (t.includes('benar') || t.includes('salah')) {
    return 'Tentukan pernyataan di bawah ini Benar atau Salah!';
  }
  if (t.includes('jodoh')) {
    return 'Jodohkan pernyataan di kolom kiri dengan pasangan yang sesuai di kolom kanan!';
  }
  if (t.includes('isian') || t.includes('pendek')) {
    return 'Isilah titik-titik di bawah ini dengan benar!';
  }
  return 'Jawablah pertanyaan-pertanyaan di bawah ini dengan benar!';
}

function getOptionLayoutMode(options: string[], allowInline: boolean): 'row' | 'grid2' | 'stack' {
  if (!options.length) return 'stack';
  if (!allowInline) return 'stack';
  const maxLen = Math.max(...options.map((o) => String(o || '').trim().length));
  if (options.length <= 4 && maxLen <= 14) return 'row';
  if (options.length <= 4 && maxLen <= 40) return 'grid2';
  return 'stack';
}

function buildKopHeaderParagraphs(data: ExportBundleData, font: string): Array<Paragraph | Table> {
  const { template, project, schoolProfile } = data;
  const academicYear = project.academic_year || '2026/2027';
  const pemkabLine = applyKopTokens(template?.pemkab_line || schoolProfile?.pemkab_name || '', project);
  const line1 = applyKopTokens(template?.line_1 || schoolProfile?.dinas_name || 'DINAS PENDIDIKAN', project);
  const line2 = applyKopTokens(template?.line_2 || '[JENIS ASESMEN]', project);
  const line3 = applyKopTokens(template?.line_3 || schoolProfile?.school_name || '', project);
  const line4 = applyKopTokens(template?.line_4 || `TAHUN PELAJARAN ${academicYear}`, project);

  const profileContact = [
    schoolProfile?.email ? `Email: ${schoolProfile.email}` : '',
    schoolProfile?.phone ? `Telp: ${schoolProfile.phone}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const addressLine = String(template?.address_line || schoolProfile?.address || '').trim();
  const contactLine = String(template?.contact_line || profileContact || '').trim();

  const leftLogo = loadImageBuffer(template?.logo_url || schoolProfile?.pemkab_logo_url || '');
  const rightLogo = loadImageBuffer(template?.right_logo_url || schoolProfile?.school_logo_url || '');

  const boldLinesCount = [pemkabLine, line1, line2, line3, line4].filter(Boolean).length;
  const smallLinesCount = [addressLine, contactLine].filter(Boolean).length;
  const estimatedKopHeightPx = boldLinesCount * 17 + smallLinesCount * 13 + 6;
  const targetLogoHeightPx = Math.min(
    132,
    Math.max(Number(template?.logo_size || 96), Math.round(estimatedKopHeightPx * 0.90))
  );
  const maxLogoWidthPx = Math.min(128, Math.round(targetLogoHeightPx * 1.25));

  const isDual = template?.logo_position === 'dual' || Boolean(rightLogo);
  const isCenter = template?.logo_position === 'center' && !rightLogo;

  const textParagraphs = [
    pemkabLine
      ? new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 10, line: 250 },
          children: [new TextRun({ text: pemkabLine.toUpperCase(), bold: true, size: 24, font })],
        })
      : null,
    line1
      ? new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 10, line: 260 },
          children: [new TextRun({ text: line1.toUpperCase(), bold: true, size: 26, font })],
        })
      : null,
    line2
      ? new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 10, line: 260 },
          children: [new TextRun({ text: line2.toUpperCase(), bold: true, size: 26, font })],
        })
      : null,
    line3
      ? new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 10, line: 260 },
          children: [new TextRun({ text: line3.toUpperCase(), bold: true, size: 26, font })],
        })
      : null,
    line4
      ? new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: addressLine || contactLine ? 20 : 60, line: 260 },
          children: [new TextRun({ text: line4.toUpperCase(), bold: true, size: 24, font })],
        })
      : null,
  ].filter(Boolean) as Paragraph[];

  if (addressLine) {
    textParagraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 10, line: 230 },
        children: [new TextRun({ text: addressLine, size: 18, font })],
      })
    );
  }
  if (contactLine) {
    textParagraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40, line: 230 },
        children: [new TextRun({ text: contactLine, size: 18, font })],
      })
    );
  }

  const borderStyle = template?.border_style === 'double' ? BorderStyle.DOUBLE : BorderStyle.SINGLE;
  const borderSize = template?.border_style === 'single' ? 10 : template?.border_style === 'double' ? 12 : 20;
  const bottomBorder = { style: borderStyle, size: borderSize, color: '000000' };

  if (isCenter) {
    const centerChildren: Paragraph[] = [];
    if (leftLogo) {
      const centerDim = fitDimensions(leftLogo.buffer, leftLogo.type, maxLogoWidthPx, Math.min(targetLogoHeightPx, 104));
      centerChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [
            new ImageRun({
              type: leftLogo.type,
              data: leftLogo.buffer,
              transformation: centerDim,
            }),
          ],
        })
      );
    }
    const centerTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: { ...NO_CELL_BORDERS, bottom: bottomBorder },
              children: [...centerChildren, ...textParagraphs],
            }),
          ],
        }),
      ],
    });
    return [centerTable, new Paragraph({ spacing: { after: 80 }, text: '' })];
  }

  const leftDim = leftLogo ? fitDimensions(leftLogo.buffer, leftLogo.type, maxLogoWidthPx, targetLogoHeightPx) : null;
  const rightDim = rightLogo ? fitDimensions(rightLogo.buffer, rightLogo.type, maxLogoWidthPx, targetLogoHeightPx) : null;

  const cells: TableCell[] = [
    new TableCell({
      width: { size: isDual ? 16 : 18, type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.CENTER,
      borders: { ...NO_CELL_BORDERS, bottom: bottomBorder },
      children: [
        leftLogo && leftDim
          ? new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: 30 },
              children: [
                new ImageRun({
                  type: leftLogo.type,
                  data: leftLogo.buffer,
                  transformation: leftDim,
                }),
              ],
            })
          : new Paragraph({ text: '' }),
      ],
    }),
    new TableCell({
      width: { size: isDual ? 68 : 82, type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.CENTER,
      borders: { ...NO_CELL_BORDERS, bottom: bottomBorder },
      children: textParagraphs,
    }),
  ];

  if (isDual) {
    cells.push(
      new TableCell({
        width: { size: 16, type: WidthType.PERCENTAGE },
        verticalAlign: VerticalAlign.CENTER,
        borders: { ...NO_CELL_BORDERS, bottom: bottomBorder },
        children: [
          rightLogo && rightDim
            ? new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 30 },
                children: [
                  new ImageRun({
                    type: rightLogo.type,
                    data: rightLogo.buffer,
                    transformation: rightDim,
                  }),
                ],
              })
            : new Paragraph({ text: '' }),
        ],
      })
    );
  }

  const kopTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: cells })],
  });

  return [kopTable, new Paragraph({ spacing: { after: 70 }, text: '' })];
}

function buildDocxOptionsBlocks(options: string[], font: string, fontSizeHalfPt: number, lineSpacing: number, allowInline: boolean, baseIndentTwips: number): Array<Paragraph | Table> {
  if (!options.length) return [];
  const letters = ['a', 'b', 'c', 'd', 'e'];
  const mode = getOptionLayoutMode(options, allowInline);

  if (mode === 'row') {
    return [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        indent: { size: baseIndentTwips, type: WidthType.DXA },
        rows: [
          new TableRow({
            cantSplit: true,
            children: options.map(
              (o, idx) =>
                new TableCell({
                  width: { size: Math.floor(100 / options.length), type: WidthType.PERCENTAGE },
                  borders: NO_CELL_BORDERS,
                  children: [
                    new Paragraph({
                      spacing: { after: 40, line: lineSpacing },
                      children: [new TextRun({ text: `${letters[idx]}. ${o}`, size: fontSizeHalfPt, font })],
                    }),
                  ],
                })
            ),
          }),
        ],
      }),
    ];
  }

  if (mode === 'grid2') {
    const colPairs: Array<[number, number]> = [
      [0, 2],
      [1, 3],
    ];
    return [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        indent: { size: baseIndentTwips, type: WidthType.DXA },
        rows: colPairs
          .filter(([leftIdx]) => leftIdx < options.length)
          .map(
            ([leftIdx, rightIdx]) =>
              new TableRow({
                cantSplit: true,
                children: [
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    borders: NO_CELL_BORDERS,
                    children: [
                      new Paragraph({
                        indent: { left: 260, hanging: 260 },
                        spacing: { after: 20, line: lineSpacing },
                        children: [new TextRun({ text: `${letters[leftIdx]}. ${options[leftIdx]}`, size: fontSizeHalfPt, font })],
                      }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    borders: NO_CELL_BORDERS,
                    children: [
                      rightIdx < options.length
                        ? new Paragraph({
                            indent: { left: 260, hanging: 260 },
                            spacing: { after: 20, line: lineSpacing },
                            children: [new TextRun({ text: `${letters[rightIdx]}. ${options[rightIdx]}`, size: fontSizeHalfPt, font })],
                          })
                        : new Paragraph({ text: '' }),
                    ],
                  }),
                ],
              })
          ),
      }),
    ];
  }

  return options.map(
    (o, idx) =>
      new Paragraph({
        indent: { left: baseIndentTwips + 260, hanging: 260 },
        spacing: { after: idx === options.length - 1 ? 50 : 15, line: lineSpacing },
        children: [new TextRun({ text: `${letters[idx]}. ${o}`, size: fontSizeHalfPt, font })],
      })
  );
}

function buildMultilineTextRuns(text: string, size: number, font: string): TextRun[] {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd());
  if (lines.length <= 1) {
    return [new TextRun({ text: String(text || ''), size, font })];
  }
  const runs: TextRun[] = [];
  lines.forEach((line, idx) => {
    if (idx === 0) {
      runs.push(new TextRun({ text: line, size, font }));
    } else {
      runs.push(new TextRun({ text: line, size, font, break: 1 }));
    }
  });
  return runs;
}

function buildSectionElements(category: string, data: ExportBundleData, font: string, fontSizeHalfPt: number): Array<Paragraph | Table> {
  const { project, blueprints, questions, cognitiveSummary } = data;
  const lineSpacing = Math.round(Number(data.formatting?.lineSpacing || 1.15) * 240);
  const allowInline = data.formatting?.shortAnswerInline !== false;
  const items: Array<Paragraph | Table> = [];

  const titleMap: Record<string, string> = {
    naskah_soal: 'NASKAH SOAL ASESMEN',
    kisi_kisi: 'KISI-KISI PENULISAN SOAL',
    kunci_jawaban: 'KUNCI JAWABAN DAN PEMBAHASAN',
    pedoman_penskoran: 'PEDOMAN PENSKORAN',
    rubrik_penilaian: 'RUBRIK PENILAIAN URAIAN',
    kunci_rubrik: 'KUNCI JAWABAN, PEDOMAN PENSKORAN, DAN RUBRIK PENILAIAN',
    analisis_kognitif: 'ANALISIS LEVEL KOGNITIF (TAKSONOMI BLOOM REVISI)',
    rekap_kualitas: 'REKAPITULASI QUALITY CONTROL SOAL',
  };

  if (category !== 'naskah_soal') {
    items.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60, line: lineSpacing },
        children: [new TextRun({ text: titleMap[category] || category.toUpperCase(), bold: true, size: fontSizeHalfPt + 4, font })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 140, line: lineSpacing },
        children: [
          new TextRun({
            text: `${String(project.subject || '').toUpperCase()} · ${formatGradeAndSemester(project.grade_level, project.semester)} · TA ${project.academic_year || '2026/2027'}`,
            size: 20,
            font,
            color: '334155',
          }),
        ],
      })
    );
  }

  if (category === 'naskah_soal') {
    const leftMeta: Array<[string, string]> = [
      ['Mata Pelajaran', String(project.subject || '').toUpperCase()],
      ['Kelas /Semester', formatGradeAndSemester(project.grade_level, project.semester)],
      ['Hari / Tanggal', ''],
      ['Waktu', `${project.duration_minutes || 90} menit`],
    ];
    const rightMeta: Array<[string, string]> = [
      ['Nama', '........................................'],
      ['Nomor', '........................................'],
      ['Nilai', '........................................'],
      ['Paraf Guru', '........................................'],
    ];

    const thickDivider = { style: BorderStyle.SINGLE, size: 18, color: '000000' };
    const metaRows = leftMeta.map(([lLabel, lVal], idx) => {
      const [rLabel, rVal] = rightMeta[idx];
      const isLast = idx === leftMeta.length - 1;
      const cellBorder = isLast ? { ...NO_CELL_BORDERS, bottom: thickDivider } : NO_CELL_BORDERS;
      const afterSp = isLast ? 90 : 25;
      return new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 17, type: WidthType.PERCENTAGE },
            borders: cellBorder,
            children: [new Paragraph({ spacing: { after: afterSp, line: 240 }, children: [new TextRun({ text: lLabel, size: 22, font })] })],
          }),
          new TableCell({
            width: { size: 35, type: WidthType.PERCENTAGE },
            borders: cellBorder,
            children: [new Paragraph({ spacing: { after: afterSp, line: 240 }, children: [new TextRun({ text: `: ${lVal}`, size: 22, font })] })],
          }),
          new TableCell({
            width: { size: 14, type: WidthType.PERCENTAGE },
            borders: cellBorder,
            children: [new Paragraph({ spacing: { after: afterSp, line: 240 }, children: [new TextRun({ text: rLabel, size: 22, font })] })],
          }),
          new TableCell({
            width: { size: 34, type: WidthType.PERCENTAGE },
            borders: cellBorder,
            children: [new Paragraph({ spacing: { after: afterSp, line: 240 }, children: [new TextRun({ text: `: ${rVal}`, size: 22, font })] })],
          }),
        ],
      });
    });

    items.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: metaRows,
      }),
      new Paragraph({ spacing: { after: 90 }, text: '' })
    );

    const sections = sortQuestionsByExamSection(questions);
    const romawi = ['I', 'II', 'III', 'IV', 'V', 'VI'];

    sections.forEach((sec, secIdx) => {
      const instruction = getSectionInstruction(sec.sectionType);
      items.push(
        new Paragraph({
          spacing: { before: secIdx === 0 ? 40 : 140, after: 80, line: lineSpacing },
          children: [
            new TextRun({ text: `${romawi[secIdx] || secIdx + 1}. ${instruction}`, bold: true, size: fontSizeHalfPt, font }),
          ],
        })
      );

      for (const q of sec.items) {
        const options: string[] = Array.isArray(q.options) ? q.options : [];
        const qImg = q.image_url ? loadImageBuffer(q.image_url) : null;

        if (qImg) {
          // Side-by-side image on left + question text & options on right (matches Q16 layout in sample PDF)
          const rightCellChildren: Array<Paragraph | Table> = [
            new Paragraph({
              spacing: { after: 40, line: lineSpacing },
              children: buildMultilineTextRuns(q.question_text, fontSizeHalfPt, font),
            }),
            ...buildDocxOptionsBlocks(options, font, fontSizeHalfPt, lineSpacing, allowInline, 0),
          ];
          if (q.question_type?.includes('Menjodohkan') && Array.isArray(q.matching_pairs)) {
            for (const pair of q.matching_pairs) {
              rightCellChildren.push(
                new Paragraph({
                  spacing: { after: 20, line: lineSpacing },
                  children: [new TextRun({ text: `• ${pair.left}   <-------->   ${pair.right}`, size: fontSizeHalfPt, font })],
                })
              );
            }
          }

          const qImgDim = fitDimensions(qImg.buffer, qImg.type, 148, 108);
          const leftImgChildren: Paragraph[] = [
            new Paragraph({
              spacing: { after: 20 },
              children: [
                new ImageRun({
                  type: qImg.type,
                  data: qImg.buffer,
                  transformation: qImgDim,
                }),
              ],
            }),
          ];

          items.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  cantSplit: true,
                  children: [
                    new TableCell({
                      width: { size: 6, type: WidthType.PERCENTAGE },
                      borders: NO_CELL_BORDERS,
                      children: [
                        new Paragraph({
                          spacing: { after: 20, line: lineSpacing },
                          children: [new TextRun({ text: `${q.question_number}.`, size: fontSizeHalfPt, font })],
                        }),
                      ],
                    }),
                    new TableCell({
                      width: { size: 27, type: WidthType.PERCENTAGE },
                      borders: NO_CELL_BORDERS,
                      children: leftImgChildren,
                    }),
                    new TableCell({
                      width: { size: 67, type: WidthType.PERCENTAGE },
                      borders: NO_CELL_BORDERS,
                      children: rightCellChildren,
                    }),
                  ],
                }),
              ],
            }),
            new Paragraph({ spacing: { after: 40 }, text: '' })
          );
        } else {
          items.push(
            new Paragraph({
              indent: { left: 420, hanging: 420 },
              spacing: { before: 40, after: options.length ? 30 : 80, line: lineSpacing },
              children: [
                new TextRun({ text: `${q.question_number}.\t`, size: fontSizeHalfPt, font }),
                ...buildMultilineTextRuns(q.question_text, fontSizeHalfPt, font),
              ],
            })
          );

          if (options.length > 0) {
            items.push(...buildDocxOptionsBlocks(options, font, fontSizeHalfPt, lineSpacing, allowInline, 420));
          } else if (q.question_type?.includes('Menjodohkan') && Array.isArray(q.matching_pairs)) {
            for (const pair of q.matching_pairs) {
              items.push(
                new Paragraph({
                  indent: { left: 420 },
                  spacing: { after: 20, line: lineSpacing },
                  children: [new TextRun({ text: `• ${pair.left}   <-------->   ${pair.right}`, size: fontSizeHalfPt, font })],
                })
              );
            }
          }
        }
      }
    });
  } else if (category === 'kisi_kisi') {
    const headerRow = new TableRow({
      tableHeader: true,
      children: ['No', 'CP', 'TP', 'Materi', 'Indikator Soal', 'Level', 'Bentuk', 'No. Soal'].map(
        (h) =>
          new TableCell({
            shading: { fill: 'EEF2FF' },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: h, bold: true, size: 20, font })] })],
          })
      ),
    });
    const rows = blueprints.map(
      (b) =>
        new TableRow({
          cantSplit: true,
          children: [
            String(b.row_number),
            b.cp,
            b.tp,
            b.materi,
            b.indikator_soal,
            b.level_kognitif,
            b.bentuk_soal,
            String(b.nomor_soal),
          ].map(
            (val, idx) =>
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: idx === 0 || idx === 5 || idx === 7 ? AlignmentType.CENTER : AlignmentType.LEFT,
                    spacing: { line: lineSpacing },
                    children: [new TextRun({ text: val || '-', size: 20, font })],
                  }),
                ],
              })
          ),
        })
    );
    items.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }));
  } else if (category === 'kunci_jawaban') {
    const headerRow = new TableRow({
      tableHeader: true,
      children: ['No', 'Bentuk Soal', 'Kunci Jawaban', 'Pembahasan', 'Sumber'].map(
        (h) =>
          new TableCell({
            shading: { fill: 'EEF2FF' },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: h, bold: true, size: 20, font })] })],
          })
      ),
    });
    const rows = questions.map(
      (q) =>
        new TableRow({
          cantSplit: true,
          children: [
            String(q.question_number),
            q.question_type,
            q.correct_answer || '-',
            q.explanation || '-',
            `${q.source_reference || '-'} (Hal. ${q.source_page || '-'})`,
          ].map(
            (val, idx) =>
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: idx === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
                    spacing: { line: lineSpacing },
                    children: [new TextRun({ text: val, size: 20, font })],
                  }),
                ],
              })
          ),
        })
    );
    items.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }));
  } else if (category === 'pedoman_penskoran' || category === 'rubrik_penilaian') {
    const targetQuestions =
      category === 'rubrik_penilaian'
        ? questions.filter((q) => q.question_type.includes('Uraian') || q.question_type.includes('HOTS') || q.max_score > 1)
        : questions;
    const list = targetQuestions.length ? targetQuestions : questions;
    const headerRow = new TableRow({
      tableHeader: true,
      children: ['No', 'Bentuk', 'Jawaban Ideal / Kriteria', 'Pedoman Penskoran', 'Skor Maks'].map(
        (h) =>
          new TableCell({
            shading: { fill: 'EEF2FF' },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: h, bold: true, size: 20, font })] })],
          })
      ),
    });
    const rows = list.map(
      (q) =>
        new TableRow({
          cantSplit: true,
          children: [
            String(q.question_number),
            q.question_type,
            q.ideal_answer || q.correct_answer || '-',
            q.scoring_guide || `Skor ${q.max_score || 1} jika jawaban tepat dan lengkap.`,
            String(q.max_score || 1),
          ].map(
            (val, idx) =>
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: idx === 0 || idx === 4 ? AlignmentType.CENTER : AlignmentType.LEFT,
                    spacing: { line: lineSpacing },
                    children: [new TextRun({ text: val, size: 20, font })],
                  }),
                ],
              })
          ),
        })
    );
    const totalMax = list.reduce((acc, q) => acc + Number(q.max_score || 1), 0);
    items.push(
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }),
      new Paragraph({
        spacing: { before: 120, line: lineSpacing },
        children: [new TextRun({ text: `Total Skor Maksimal: ${totalMax}   |   Nilai Akhir = (Skor Perolehan / ${totalMax}) × 100`, bold: true, size: 22, font })],
      })
    );
  } else if (category === 'kunci_rubrik') {
    const headerRow = new TableRow({
      tableHeader: true,
      children: ['No', 'Bentuk', 'Kunci Jawaban', 'Pembahasan & Jawaban Ideal', 'Pedoman Penskoran', 'Skor Maks'].map(
        (h) =>
          new TableCell({
            shading: { fill: 'EEF2FF' },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: h, bold: true, size: 19, font })] })],
          })
      ),
    });
    const rows = questions.map(
      (q) =>
        new TableRow({
          cantSplit: true,
          children: [
            String(q.question_number),
            q.question_type || '-',
            q.correct_answer || '-',
            [q.explanation, q.ideal_answer && q.ideal_answer !== q.correct_answer ? `Ideal: ${q.ideal_answer}` : '']
              .filter(Boolean)
              .join(' — ') || '-',
            q.scoring_guide || `Skor ${q.max_score || 1} jika jawaban tepat dan lengkap.`,
            String(q.max_score || 1),
          ].map(
            (val, idx) =>
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: idx === 0 || idx === 5 ? AlignmentType.CENTER : AlignmentType.LEFT,
                    spacing: { line: lineSpacing },
                    children: [new TextRun({ text: val, size: 19, font })],
                  }),
                ],
              })
          ),
        })
    );
    const totalMax = questions.reduce((acc, q) => acc + Number(q.max_score || 1), 0);
    items.push(
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }),
      new Paragraph({
        spacing: { before: 120, line: lineSpacing },
        children: [new TextRun({ text: `Total Skor Maksimal: ${totalMax}   |   Nilai Akhir = (Skor Perolehan / ${totalMax}) × 100`, bold: true, size: 22, font })],
      })
    );
  } else if (category === 'analisis_kognitif') {
    const c = cognitiveSummary || {};
    items.push(
      new Paragraph({
        spacing: { after: 100, line: lineSpacing },
        children: [
          new TextRun({
            text: `Distribusi Taksonomi Bloom: C1=${c.c1_count || 0}, C2=${c.c2_count || 0}, C3=${c.c3_count || 0}, C4=${c.c4_count || 0}, C5=${c.c5_count || 0}, C6=${c.c6_count || 0}  |  LOTS=${c.lots_count || 0}, MOTS=${c.mots_count || 0}, HOTS=${c.hots_count || 0}`,
            bold: true,
            size: 22,
            font,
          }),
        ],
      })
    );
    const headerRow = new TableRow({
      tableHeader: true,
      children: ['No', 'Level', 'Kategori', 'Kesulitan', 'Alasan Klasifikasi Kognitif'].map(
        (h) =>
          new TableCell({
            shading: { fill: 'EEF2FF' },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: h, bold: true, size: 20, font })] })],
          })
      ),
    });
    const rows = questions.map(
      (q) =>
        new TableRow({
          cantSplit: true,
          children: [
            String(q.question_number),
            q.cognitive_level,
            q.cognitive_tier,
            q.difficulty,
            q.cognitive_rationale || '-',
          ].map(
            (val, idx) =>
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: idx === 0 || idx === 1 || idx === 2 ? AlignmentType.CENTER : AlignmentType.LEFT,
                    spacing: { line: lineSpacing },
                    children: [new TextRun({ text: val, size: 20, font })],
                  }),
                ],
              })
          ),
        })
    );
    items.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }));
  } else if (category === 'rekap_kualitas') {
    const headerRow = new TableRow({
      tableHeader: true,
      children: ['No', 'Status QC', 'Disetujui', 'Catatan Pemeriksaan Kualitas'].map(
        (h) =>
          new TableCell({
            shading: { fill: 'EEF2FF' },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: h, bold: true, size: 20, font })] })],
          })
      ),
    });
    const rows = questions.map(
      (q) =>
        new TableRow({
          cantSplit: true,
          children: [
            String(q.question_number),
            q.qc_status === 'passed' ? 'Lolos QC' : q.qc_status === 'needs_revision' ? 'Perlu Perbaikan' : 'Menunggu QC',
            q.is_approved ? 'Disetujui' : 'Belum',
            q.qc_notes || 'Memenuhi kriteria materi, bahasa, dan indikator.',
          ].map(
            (val, idx) =>
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: idx === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
                    spacing: { line: lineSpacing },
                    children: [new TextRun({ text: val, size: 20, font })],
                  }),
                ],
              })
          ),
        })
    );
    items.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }));
  }

  return items;
}

export async function generateDocxBuffer(category: string, data: ExportBundleData): Promise<Buffer> {
  const formatting = data.formatting || {};
  const font = formatting.fontFamily || data.template?.font_family || 'Calibri';
  const fontSizeHalfPt = resolveFontSizeHalfPt(data.project.grade_level, formatting);
  const paperW = Math.round(Number(formatting.paperWidthCm || 21.5) * CM_TO_TWIPS);
  const paperH = Math.round(Number(formatting.paperHeightCm || 33) * CM_TO_TWIPS);

  const categories =
    category === 'all'
      ? ['naskah_soal', 'kisi_kisi', 'kunci_jawaban', 'pedoman_penskoran', 'rubrik_penilaian', 'analisis_kognitif', 'rekap_kualitas']
      : [category];

  const sections = categories.map((cat) => ({
    properties: {
      page: {
        size: { width: paperW, height: paperH },
        margin: {
          top: Math.round(Number(formatting.marginTopCm || 1) * CM_TO_TWIPS),
          bottom: Math.round(Number(formatting.marginBottomCm || 1) * CM_TO_TWIPS),
          right: Math.round(Number(formatting.marginRightCm || 1) * CM_TO_TWIPS),
          left: Math.round(Number(formatting.marginLeftCm || 2) * CM_TO_TWIPS),
        },
      },
    },
    children: [...buildKopHeaderParagraphs(data, font), ...buildSectionElements(cat, data, font, fontSizeHalfPt)],
  }));

  const doc = new Document({ sections });
  return Packer.toBuffer(doc);
}

export async function generatePdfBuffer(category: string, data: ExportBundleData): Promise<Buffer> {
  const formatting = data.formatting || {};
  const paperW = Number(formatting.paperWidthCm || 21.5) * CM_TO_PT;
  const paperH = Number(formatting.paperHeightCm || 33) * CM_TO_PT;
  const marginTop = Number(formatting.marginTopCm || 1) * CM_TO_PT;
  const marginBottom = Number(formatting.marginBottomCm || 1) * CM_TO_PT;
  const marginRight = Number(formatting.marginRightCm || 1) * CM_TO_PT;
  const marginLeft = Number(formatting.marginLeftCm || 2) * CM_TO_PT;
  const contentW = paperW - marginLeft - marginRight;
  const fontSize = resolveFontSizePt(data.project.grade_level, formatting);
  const allowInline = formatting?.shortAnswerInline !== false;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [paperW, paperH],
      margins: { top: marginTop, bottom: marginBottom, left: marginLeft, right: marginRight },
      autoFirstPage: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ensureSpace = (neededPt: number) => {
      if (doc.y + neededPt > paperH - marginBottom) {
        doc.addPage();
        doc.y = marginTop;
      }
    };

    const renderKop = () => {
      const tpl = data.template || {};
      const academicYear = data.project.academic_year || '2026/2027';
      const leftLogo = loadImageBuffer(tpl.logo_url || data.schoolProfile?.pemkab_logo_url || '');
      const rightLogo = loadImageBuffer(tpl.right_logo_url || data.schoolProfile?.school_logo_url || '');
      const isDual = tpl.logo_position === 'dual' || Boolean(rightLogo);
      const isCenter = tpl.logo_position === 'center' && !rightLogo;
      const topY = doc.y;

      const pemkabLine = applyKopTokens(tpl.pemkab_line || data.schoolProfile?.pemkab_name || '', data.project).toUpperCase();
      const l1 = applyKopTokens(tpl.line_1 || data.schoolProfile?.dinas_name || 'DINAS PENDIDIKAN', data.project).toUpperCase();
      const l2 = applyKopTokens(tpl.line_2 || '[JENIS ASESMEN]', data.project).toUpperCase();
      const l3 = applyKopTokens(tpl.line_3 || data.schoolProfile?.school_name || '', data.project).toUpperCase();
      const l4 = applyKopTokens(tpl.line_4 || `TAHUN PELAJARAN ${academicYear}`, data.project).toUpperCase();

      const profileContact = [
        data.schoolProfile?.email ? `Email: ${data.schoolProfile.email}` : '',
        data.schoolProfile?.phone ? `Telp: ${data.schoolProfile.phone}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const addressLine = String(tpl.address_line || data.schoolProfile?.address || '').trim();
      const contactLine = String(tpl.contact_line || profileContact || '').trim();

      const rawKopLinesSpec: Array<{ text: string; sizePt: number; fontName: 'Helvetica-Bold' | 'Helvetica'; yExtra: number }> = [
        { text: pemkabLine, sizePt: 11, fontName: 'Helvetica-Bold', yExtra: 0 },
        { text: l1, sizePt: 12, fontName: 'Helvetica-Bold', yExtra: 0 },
        { text: l2, sizePt: 12.5, fontName: 'Helvetica-Bold', yExtra: 0 },
        { text: l3, sizePt: 12, fontName: 'Helvetica-Bold', yExtra: 0 },
        { text: l4, sizePt: 11, fontName: 'Helvetica-Bold', yExtra: 0 },
        { text: addressLine, sizePt: 8.5, fontName: 'Helvetica', yExtra: 1 },
        { text: contactLine, sizePt: 8.5, fontName: 'Helvetica', yExtra: 0 },
      ];
      const kopLinesSpec = rawKopLinesSpec.filter((item) => Boolean(item.text));

      const slotWidthPt = 88;
      const textX = isCenter ? marginLeft : isDual ? marginLeft + slotWidthPt + 8 : leftLogo ? marginLeft + slotWidthPt + 8 : marginLeft;
      const textW = isCenter ? contentW : isDual ? contentW - 2 * (slotWidthPt + 8) : leftLogo ? contentW - (slotWidthPt + 8) : contentW;

      let centerLogoPt = Math.min(82, Math.max(58, Number(tpl.logo_size || 96) * 0.78));
      if (isCenter && leftLogo) {
        try {
          const dimC = fitDimensions(leftLogo.buffer, leftLogo.type, centerLogoPt * 1.25, centerLogoPt);
          doc.image(leftLogo.buffer, marginLeft + (contentW - dimC.width) / 2, topY, { width: dimC.width, height: dimC.height });
          doc.y = topY + dimC.height + 6;
        } catch {
          // ignore
        }
      }

      const textStartY = isCenter ? doc.y : topY;
      let firstTextPlaced = false;
      for (const item of kopLinesSpec) {
        const yPos = !firstTextPlaced ? textStartY : doc.y + item.yExtra;
        firstTextPlaced = true;
        doc.font(item.fontName).fontSize(item.sizePt).text(item.text, textX, yPos, { width: textW, align: 'center' });
      }
      const textEndY = doc.y;
      const measuredTextH = Math.max(60, textEndY - textStartY);

      const targetLogoPt = Math.min(
        104,
        Math.max(Math.round(measuredTextH * 0.94), Math.round(Number(tpl.logo_size || 96) * 0.85))
      );

      if (!isCenter) {
        if (leftLogo) {
          try {
            const leftDim = fitDimensions(leftLogo.buffer, leftLogo.type, slotWidthPt, targetLogoPt);
            const ly = topY + Math.max(0, (measuredTextH - leftDim.height) / 2);
            const lx = marginLeft + Math.max(0, (slotWidthPt - leftDim.width) / 2);
            doc.image(leftLogo.buffer, lx, ly, { width: leftDim.width, height: leftDim.height });
          } catch {
            // ignore
          }
        }
        if (isDual && rightLogo) {
          try {
            const rightDim = fitDimensions(rightLogo.buffer, rightLogo.type, slotWidthPt, targetLogoPt);
            const ry = topY + Math.max(0, (measuredTextH - rightDim.height) / 2);
            const rx = paperW - marginRight - slotWidthPt + Math.max(0, (slotWidthPt - rightDim.width) / 2);
            doc.image(rightLogo.buffer, rx, ry, { width: rightDim.width, height: rightDim.height });
          } catch {
            // ignore
          }
        }
      }

      const contentBottomY = isCenter ? textEndY : Math.max(textEndY, topY + targetLogoPt);
      const lineY = contentBottomY + 5;
      if (tpl.border_style === 'double') {
        doc.moveTo(marginLeft, lineY).lineTo(paperW - marginRight, lineY).lineWidth(2).stroke();
        doc.moveTo(marginLeft, lineY + 3).lineTo(paperW - marginRight, lineY + 3).lineWidth(0.8).stroke();
        doc.y = lineY + 10;
      } else {
        doc.moveTo(marginLeft, lineY).lineTo(paperW - marginRight, lineY).lineWidth(tpl.border_style === 'single' ? 1.2 : 2.2).stroke();
        doc.y = lineY + 9;
      }
      doc.x = marginLeft;
    };

    const renderPdfOptions = (options: string[], xStart: number, availWidth: number) => {
      if (!options.length) return;
      const letters = ['a', 'b', 'c', 'd', 'e'];
      const mode = getOptionLayoutMode(options, allowInline);
      doc.font('Helvetica').fontSize(fontSize);

      if (mode === 'row') {
        const colW = availWidth / Math.max(1, options.length);
        const startY = doc.y;
        let maxY = startY;
        options.forEach((o, i) => {
          doc.text(`${letters[i]}. ${o}`, xStart + i * colW, startY, { width: colW - 6 });
          maxY = Math.max(maxY, doc.y);
        });
        doc.y = maxY + 2;
      } else if (mode === 'grid2') {
        const colW = availWidth / 2;
        const pairs: Array<[number, number]> = [
          [0, 2],
          [1, 3],
        ];
        for (const [li, ri] of pairs) {
          if (li >= options.length) continue;
          const leftStr = `${letters[li]}. ${options[li]}`;
          const rightStr = ri < options.length ? `${letters[ri]}. ${options[ri]}` : '';
          const hNeed = Math.max(
            doc.heightOfString(leftStr, { width: colW - 8 }),
            rightStr ? doc.heightOfString(rightStr, { width: colW - 8 }) : 0
          );
          ensureSpace(hNeed + 4);
          const rowY = doc.y;
          doc.text(leftStr, xStart, rowY, { width: colW - 8 });
          let maxY = doc.y;
          if (rightStr) {
            doc.text(rightStr, xStart + colW, rowY, { width: colW - 8 });
            maxY = Math.max(maxY, doc.y);
          }
          doc.y = maxY + 1;
        }
      } else {
        for (let i = 0; i < options.length; i++) {
          const line = `${letters[i]}. ${options[i]}`;
          ensureSpace(doc.heightOfString(line, { width: availWidth }) + 2);
          doc.text(line, xStart, doc.y, { width: availWidth });
        }
      }
      doc.x = marginLeft;
    };

    const categories =
      category === 'all'
        ? ['naskah_soal', 'kisi_kisi', 'kunci_jawaban', 'pedoman_penskoran', 'rubrik_penilaian', 'analisis_kognitif', 'rekap_kualitas']
        : [category];

    categories.forEach((cat, catIdx) => {
      if (catIdx > 0) doc.addPage();
      renderKop();

      if (cat === 'naskah_soal') {
        const metaStartY = doc.y;
        const leftPairs: Array<[string, string]> = [
          ['Mata Pelajaran', String(data.project.subject || '').toUpperCase()],
          ['Kelas /Semester', formatGradeAndSemester(data.project.grade_level, data.project.semester)],
          ['Hari / Tanggal', ''],
          ['Waktu', `${data.project.duration_minutes || 90} menit`],
        ];
        const rightPairs: Array<[string, string]> = [
          ['Nama', '.....................................'],
          ['Nomor', '.....................................'],
          ['Nilai', '.....................................'],
          ['Paraf Guru', '.....................................'],
        ];

        doc.font('Helvetica').fontSize(10.5);
        let curY = metaStartY;
        const rightX = marginLeft + contentW * 0.54;
        leftPairs.forEach(([lLbl, lVal], idx) => {
          const [rLbl, rVal] = rightPairs[idx];
          doc.text(lLbl, marginLeft, curY, { width: 88, lineBreak: false });
          doc.text(`: ${lVal}`, marginLeft + 88, curY, { width: contentW * 0.54 - 92, lineBreak: false });
          doc.text(rLbl, rightX, curY, { width: 65, lineBreak: false });
          doc.text(`: ${rVal}`, rightX + 65, curY, { width: contentW * 0.46 - 65, lineBreak: false });
          curY += 15;
        });

        doc.moveTo(marginLeft, curY + 3).lineTo(paperW - marginRight, curY + 3).lineWidth(2.2).stroke();
        doc.y = curY + 13;
        doc.x = marginLeft;

        const sections = sortQuestionsByExamSection(data.questions);
        const romawi = ['I', 'II', 'III', 'IV', 'V', 'VI'];

        sections.forEach((sec, secIdx) => {
          ensureSpace(36);
          const instruction = getSectionInstruction(sec.sectionType);
          doc.font('Helvetica-Bold').fontSize(fontSize).text(`${romawi[secIdx] || secIdx + 1}. ${instruction}`, marginLeft, doc.y, { width: contentW });
          doc.moveDown(0.35);

          for (const q of sec.items) {
            const options: string[] = Array.isArray(q.options) ? q.options : [];
            const qImg = q.image_url ? loadImageBuffer(q.image_url) : null;
            const numPrefix = `${q.question_number}.`;
            const bodyX = marginLeft + 22;
            const bodyW = contentW - 22;

            if (qImg) {
              const imgMaxW = 110;
              const imgMaxH = 88;
              const rightColX = marginLeft + 22 + imgMaxW + 12;
              const rightColW = contentW - (22 + imgMaxW + 12);

              doc.font('Helvetica').fontSize(fontSize);
              const qTextH = doc.heightOfString(q.question_text, { width: rightColW });
              const estTotalH = Math.max(imgMaxH + (q.image_caption ? 14 : 0), qTextH + options.length * 14);
              ensureSpace(Math.min(180, estTotalH + 10));

              const blockY = doc.y;
              doc.font('Helvetica').fontSize(fontSize).text(numPrefix, marginLeft, blockY, { width: 20, lineBreak: false });

              let imgBottomY = blockY;
              try {
                doc.image(qImg.buffer, bodyX, blockY + 2, { fit: [imgMaxW, imgMaxH] });
                imgBottomY = blockY + imgMaxH + 4;
              } catch {
                // ignore unsupported image
              }

              doc.font('Helvetica').fontSize(fontSize).text(q.question_text, rightColX, blockY, { width: rightColW });
              if (options.length > 0) {
                doc.y += 2;
                renderPdfOptions(options, rightColX, rightColW);
              }
              doc.y = Math.max(imgBottomY, doc.y) + 6;
              doc.x = marginLeft;
            } else {
              doc.font('Helvetica').fontSize(fontSize);
              const qHeight = doc.heightOfString(q.question_text, { width: bodyW });
              ensureSpace(qHeight + 22);
              const qY = doc.y;
              doc.text(numPrefix, marginLeft, qY, { width: 20, lineBreak: false });
              doc.text(q.question_text, bodyX, qY, { width: bodyW });

              if (options.length > 0) {
                doc.y += 1.5;
                renderPdfOptions(options, bodyX, bodyW);
              } else if (q.question_type?.includes('Menjodohkan') && Array.isArray(q.matching_pairs)) {
                doc.font('Helvetica').fontSize(fontSize);
                for (const pair of q.matching_pairs) {
                  ensureSpace(16);
                  doc.text(`• ${pair.left}   <-------->   ${pair.right}`, bodyX, doc.y, { width: bodyW });
                }
              }
              doc.moveDown(0.35);
            }
          }
          doc.moveDown(0.3);
        });
      }

      const renderPdfDocSubtitle = (titleText: string) => {
        doc.font('Helvetica-Bold').fontSize(fontSize + 1).fillColor('#0f172a').text(titleText, marginLeft, doc.y, { width: contentW, align: 'center' });
        doc.font('Helvetica').fontSize(9.5).fillColor('#475569').text(
          `${String(data.project.subject || '').toUpperCase()} · ${formatGradeAndSemester(data.project.grade_level, data.project.semester)} · TA ${data.project.academic_year || '2026/2027'}`,
          marginLeft,
          doc.y + 2,
          { width: contentW, align: 'center' }
        );
        doc.fillColor('#000000');
        doc.moveDown(0.55);
      };

      const renderPdfTable = (
        headers: string[],
        colRatios: number[],
        rows: string[][],
        centerCols: number[] = [0]
      ) => {
        const colWidths = colRatios.map((r) => r * contentW);
        const padX = 5;
        const padY = 5;
        const headerFontSize = 9;
        const cellFontSize = 8.8;

        const drawRow = (cells: string[], isHeader: boolean, rowIdx: number) => {
          doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(isHeader ? headerFontSize : cellFontSize);
          const heights = cells.map((val, i) => {
            const w = Math.max(18, colWidths[i] - padX * 2);
            return doc.heightOfString(String(val || '-'), { width: w });
          });
          const rowH = Math.max(...heights, 11) + padY * 2;

          if (doc.y + rowH > paperH - marginBottom) {
            doc.addPage();
            doc.y = marginTop;
            if (!isHeader) {
              drawRow(headers, true, -1);
            }
          }

          const yTop = doc.y;
          let xCur = marginLeft;
          cells.forEach((val, i) => {
            const w = colWidths[i];
            if (isHeader) {
              doc.save().rect(xCur, yTop, w, rowH).fill('#EEF2FF').restore();
            } else if (rowIdx % 2 === 1) {
              doc.save().rect(xCur, yTop, w, rowH).fill('#F8FAFC').restore();
            }
            doc.save().rect(xCur, yTop, w, rowH).lineWidth(0.5).strokeColor('#475569').stroke().restore();

            doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(isHeader ? headerFontSize : cellFontSize)
              .fillColor(isHeader ? '#0f172a' : '#1e293b')
              .text(String(val || '-'), xCur + padX, yTop + padY, {
                width: Math.max(18, w - padX * 2),
                align: isHeader || centerCols.includes(i) ? 'center' : 'left',
              });
            xCur += w;
          });
          doc.fillColor('#000000');
          doc.y = yTop + rowH;
          doc.x = marginLeft;
        };

        drawRow(headers, true, -1);
        rows.forEach((r, idx) => drawRow(r, false, idx));
        doc.moveDown(0.5);
      };

      if (cat === 'kisi_kisi') {
        renderPdfDocSubtitle('KISI-KISI PENULISAN SOAL');
        renderPdfTable(
          ['No', 'CP', 'TP', 'Materi', 'Indikator Soal', 'Level', 'Bentuk', 'No. Soal'],
          [0.05, 0.17, 0.17, 0.13, 0.24, 0.07, 0.1, 0.07],
          data.blueprints.map((b) => [
            String(b.row_number),
            b.cp || '-',
            b.tp || '-',
            b.materi || '-',
            b.indikator_soal || '-',
            b.level_kognitif || '-',
            b.bentuk_soal || '-',
            String(b.nomor_soal || '-'),
          ]),
          [0, 5, 7]
        );
      } else if (cat === 'kunci_jawaban') {
        renderPdfDocSubtitle('KUNCI JAWABAN DAN PEMBAHASAN');
        renderPdfTable(
          ['No', 'Bentuk Soal', 'Kunci Jawaban', 'Pembahasan', 'Sumber'],
          [0.06, 0.15, 0.18, 0.41, 0.2],
          data.questions.map((q) => [
            String(q.question_number),
            q.question_type || '-',
            q.correct_answer || '-',
            q.explanation || '-',
            `${q.source_reference || '-'} (Hal. ${q.source_page || '-'})`,
          ]),
          [0]
        );
      } else if (cat === 'pedoman_penskoran' || cat === 'rubrik_penilaian') {
        renderPdfDocSubtitle(cat === 'rubrik_penilaian' ? 'RUBRIK PENILAIAN URAIAN' : 'PEDOMAN PENSKORAN');
        const targetQuestions =
          cat === 'rubrik_penilaian'
            ? data.questions.filter((q) => q.question_type?.includes('Uraian') || q.question_type?.includes('HOTS') || q.max_score > 1)
            : data.questions;
        const list = targetQuestions.length ? targetQuestions : data.questions;
        renderPdfTable(
          ['No', 'Bentuk', 'Jawaban Ideal / Kriteria', 'Pedoman Penskoran', 'Skor Maks'],
          [0.06, 0.15, 0.31, 0.38, 0.1],
          list.map((q) => [
            String(q.question_number),
            q.question_type || '-',
            q.ideal_answer || q.correct_answer || '-',
            q.scoring_guide || `Skor ${q.max_score || 1} jika jawaban tepat dan lengkap.`,
            String(q.max_score || 1),
          ]),
          [0, 4]
        );
        const totalMax = list.reduce((acc, q) => acc + Number(q.max_score || 1), 0);
        ensureSpace(24);
        doc.font('Helvetica-Bold').fontSize(10).text(
          `Total Skor Maksimal: ${totalMax}   |   Nilai Akhir = (Skor Perolehan / ${totalMax}) × 100`,
          marginLeft,
          doc.y,
          { width: contentW }
        );
      } else if (cat === 'kunci_rubrik') {
        renderPdfDocSubtitle('KUNCI JAWABAN, PEDOMAN PENSKORAN, DAN RUBRIK PENILAIAN');
        renderPdfTable(
          ['No', 'Bentuk', 'Kunci Jawaban', 'Pembahasan & Jawaban Ideal', 'Pedoman Penskoran', 'Skor'],
          [0.05, 0.13, 0.16, 0.31, 0.27, 0.08],
          data.questions.map((q) => [
            String(q.question_number),
            q.question_type || '-',
            q.correct_answer || '-',
            [q.explanation, q.ideal_answer && q.ideal_answer !== q.correct_answer ? `Ideal: ${q.ideal_answer}` : '']
              .filter(Boolean)
              .join(' — ') || '-',
            q.scoring_guide || `Skor ${q.max_score || 1} jika jawaban tepat dan lengkap.`,
            String(q.max_score || 1),
          ]),
          [0, 5]
        );
        const totalMax = data.questions.reduce((acc, q) => acc + Number(q.max_score || 1), 0);
        ensureSpace(24);
        doc.font('Helvetica-Bold').fontSize(10).text(
          `Total Skor Maksimal: ${totalMax}   |   Nilai Akhir = (Skor Perolehan / ${totalMax}) × 100`,
          marginLeft,
          doc.y,
          { width: contentW }
        );
      } else if (cat === 'analisis_kognitif') {
        const c = data.cognitiveSummary || {};
        renderPdfDocSubtitle('ANALISIS LEVEL KOGNITIF (TAKSONOMI BLOOM REVISI)');
        const boxY = doc.y;
        doc.save().rect(marginLeft, boxY, contentW, 24).fill('#EEF2FF').restore();
        doc.save().rect(marginLeft, boxY, contentW, 24).lineWidth(0.5).strokeColor('#475569').stroke().restore();
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a').text(
          `C1=${c.c1_count || 0}  ·  C2=${c.c2_count || 0}  ·  C3=${c.c3_count || 0}  ·  C4=${c.c4_count || 0}  ·  C5=${c.c5_count || 0}  ·  C6=${c.c6_count || 0}   |   LOTS=${c.lots_count || 0}  ·  MOTS=${c.mots_count || 0}  ·  HOTS=${c.hots_count || 0}`,
          marginLeft + 6,
          boxY + 7,
          { width: contentW - 12, align: 'center' }
        );
        doc.fillColor('#000000');
        doc.y = boxY + 32;
        renderPdfTable(
          ['No', 'Level', 'Kategori', 'Kesulitan', 'Alasan Klasifikasi Kognitif'],
          [0.06, 0.09, 0.12, 0.14, 0.59],
          data.questions.map((q) => [
            String(q.question_number),
            q.cognitive_level || '-',
            q.cognitive_tier || '-',
            q.difficulty || '-',
            q.cognitive_rationale || '-',
          ]),
          [0, 1, 2]
        );
      } else if (cat === 'rekap_kualitas') {
        renderPdfDocSubtitle('REKAPITULASI QUALITY CONTROL SOAL');
        renderPdfTable(
          ['No', 'Status QC', 'Disetujui', 'Catatan Pemeriksaan Kualitas'],
          [0.07, 0.18, 0.14, 0.61],
          data.questions.map((q) => [
            String(q.question_number),
            q.qc_status === 'passed' ? 'Lolos QC' : q.qc_status === 'needs_revision' ? 'Perlu Perbaikan' : 'Menunggu QC',
            q.is_approved ? 'Disetujui' : 'Belum',
            q.qc_notes || 'Memenuhi standar mutu.',
          ]),
          [0]
        );
      }
    });

    doc.end();
  });
}

export function generateExcelBuffer(data: ExportBundleData): Buffer {
  const wb = XLSX.utils.book_new();

  const kisiRows = data.blueprints.map((b) => ({
    No: b.row_number,
    CP: b.cp,
    TP: b.tp,
    Materi: b.materi,
    'Indikator Soal': b.indikator_soal,
    'Level Kognitif': b.level_kognitif,
    'Bentuk Soal': b.bentuk_soal,
    'Nomor Soal': b.nomor_soal,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kisiRows), 'Kisi-Kisi');

  const cognitiveRows = data.questions.map((q) => ({
    'Nomor Soal': q.question_number,
    'Bentuk Soal': q.question_type,
    Materi: q.materi,
    'Level Kognitif': q.cognitive_level,
    'Kategori (LOTS/MOTS/HOTS)': q.cognitive_tier,
    'Tingkat Kesulitan': q.difficulty,
    'Alasan Klasifikasi': q.cognitive_rationale,
    'Sumber Referensi': q.source_reference,
    Halaman: q.source_page,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cognitiveRows), 'Analisis Kognitif');

  const keyRows = data.questions.map((q) => ({
    'Nomor Soal': q.question_number,
    'Bentuk Soal': q.question_type,
    'Kunci Jawaban': q.correct_answer,
    Pembahasan: q.explanation,
    'Skor Maksimal': q.max_score || 1,
    'Status QC': q.qc_status,
    Disetujui: q.is_approved ? 'Ya' : 'Belum',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(keyRows), 'Kunci & Rekap QC');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
