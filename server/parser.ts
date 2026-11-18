import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import crypto from 'node:crypto';

export interface ParsedDocumentResult {
  text: string;
  pageCount: number;
  fileType: string;
  chapters: string[];
  chunks: Array<{
    chunkIndex: number;
    chapterTitle: string;
    pageNumber: number;
    content: string;
    keywords: string;
  }>;
  extractedImages: Array<{
    buffer: Buffer;
    ext: 'png' | 'jpg';
    pageNumber: number;
    width: number;
    height: number;
    name: string;
    pageContext?: string;
  }>;
}

function extractKeywords(text: string): string {
  const stopWords = new Set([
    'yang', 'dan', 'di', 'ke', 'dari', 'pada', 'dalam', 'untuk', 'dengan', 'atau',
    'adalah', 'ini', 'itu', 'sebagai', 'oleh', 'akan', 'juga', 'dapat', 'tidak',
    'serta', 'karena', 'agar', 'saat', 'para', 'harus', 'lebih', 'seperti', 'telah',
    'merupakan', 'antara', 'satu', 'dua', 'tiga', 'bagi', 'secara', 'bisa', 'jika',
  ]);
  const freq = new Map<string, number>();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([w]) => w)
    .join(' ');
}

function detectChapters(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headings: string[] = [];
  const headingPattern = /^(bab\s+[ivx0-9]+|unit\s+[0-9]+|modul\s+[0-9]+|tema\s+[0-9]+|subtema\s+[0-9]+|pelajaran\s+[ivx0-9]+|topik\s+[a-z0-9]+|pembelajaran\s+[0-9]+|bagian\s+[0-9]+|semester\s+[12])/i;
  for (const line of lines) {
    if (line.length >= 5 && line.length <= 120 && headingPattern.test(line)) {
      if (!headings.includes(line)) headings.push(line);
    }
  }
  return headings.slice(0, 30);
}

function splitIntoChunks(text: string, pageCount: number, chapters: string[]) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const cleanLower = clean.toLowerCase();
  const chapterOffsets = chapters
    .map((ch) => {
      const normCh = ch.replace(/\s+/g, ' ').trim().toLowerCase();
      const idx = cleanLower.indexOf(normCh);
      return { title: ch, offset: idx };
    })
    .filter((item) => item.offset >= 0)
    .sort((a, b) => a.offset - b.offset);

  const targetSize = 1100;
  const overlap = 120;
  const chunks: ParsedDocumentResult['chunks'] = [];
  let cursor = 0;
  let index = 0;

  while (cursor < clean.length) {
    const end = Math.min(cursor + targetSize, clean.length);
    const slice = clean.slice(cursor, end).trim();
    const progress = cursor / Math.max(1, clean.length);
    const pageNumber = Math.max(1, Math.min(pageCount, Math.ceil(progress * pageCount) || 1));

    let chapterTitle = `Bagian ${index + 1}`;
    if (chapterOffsets.length > 0) {
      let matched = chapterOffsets[0].title;
      for (const co of chapterOffsets) {
        if (co.offset <= cursor + 150) matched = co.title;
        else break;
      }
      chapterTitle = matched;
    } else if (chapters.length > 0) {
      chapterTitle = chapters[Math.min(chapters.length - 1, Math.floor(progress * chapters.length))];
    }

    if (slice.length > 30) {
      chunks.push({
        chunkIndex: index,
        chapterTitle,
        pageNumber,
        content: slice,
        keywords: extractKeywords(slice),
      });
      index++;
    }
    if (end >= clean.length) break;
    cursor = Math.max(cursor + 1, end - overlap);
  }

  return chunks;
}

export async function parseUploadedDocument(buffer: Buffer, originalName: string): Promise<ParsedDocumentResult> {
  const ext = originalName.split('.').pop()?.toUpperCase() || 'TXT';
  let text = '';
  let pageCount = 1;
  const extractedImages: ParsedDocumentResult['extractedImages'] = [];
  const seenImageHashes = new Set<string>();

  const pushUniqueImage = (item: ParsedDocumentResult['extractedImages'][number]) => {
    if (extractedImages.length >= 20) return;
    if (!item.buffer || item.buffer.length < 2500 || item.buffer.length > 4_000_000) return;
    if (item.width > 0 && item.height > 0) {
      if (item.width < 70 || item.height < 70) return;
      const ratio = Math.max(item.width / item.height, item.height / item.width);
      if (ratio > 6) return;
    }
    const hash = crypto.createHash('sha1').update(item.buffer).digest('hex');
    if (seenImageHashes.has(hash)) return;
    seenImageHashes.add(hash);
    extractedImages.push(item);
  };

  if (ext === 'PDF') {
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      text = (parsed.text || '').trim();
      pageCount = Math.max(1, parsed.total || parsed.pages?.length || 1);

      const pageTextMap = new Map<number, string>();
      if (Array.isArray(parsed.pages)) {
        for (const p of parsed.pages as Array<{ num?: number; pageNumber?: number; text?: string }>) {
          const pNum = Number(p.num || p.pageNumber || 0);
          if (pNum > 0 && p.text) {
            pageTextMap.set(pNum, String(p.text).replace(/\s+/g, ' ').trim());
          }
        }
      }

      try {
        // Scan up to 24 pages: prioritize pages mentioning figures/photos/diagrams + evenly spaced textbook pages
        const maxScanPages = Math.min(pageCount, 24);
        const partialPages: number[] = [];
        if (pageCount <= 24) {
          for (let p = 1; p <= pageCount; p++) partialPages.push(p);
        } else {
          for (const [pNum, pTxt] of pageTextMap.entries()) {
            if (partialPages.length >= 14) break;
            if (/\b(gambar|ilustrasi|peta|diagram|grafik|foto|bagan|perhatikan)\b/i.test(pTxt)) {
              partialPages.push(pNum);
            }
          }
          for (let i = 0; i < maxScanPages && partialPages.length < maxScanPages; i++) {
            const p = Math.max(1, Math.min(pageCount, 1 + Math.floor((i * (pageCount - 1)) / (maxScanPages - 1))));
            if (!partialPages.includes(p)) partialPages.push(p);
          }
          partialPages.sort((a, b) => a - b);
        }

        const imgRes = await Promise.race([
          parser.getImage({ partial: partialPages, imageBuffer: true, imageDataUrl: false, imageThreshold: 80 }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 7500)),
        ]);
        if (imgRes) {
          for (const page of imgRes.pages || []) {
            const pNum = page.pageNumber || 1;
            const rawPageTxt = pageTextMap.get(pNum) || '';
            const figMatch = rawPageTxt.match(/((?:gambar|ilustrasi|peta|bagan|diagram)[^.]{0,140})/i);
            const snippet = figMatch ? figMatch[1] : rawPageTxt.slice(0, 260);
            for (const img of page.images || []) {
              if (extractedImages.length >= 20) break;
              if (img.data) {
                pushUniqueImage({
                  buffer: Buffer.from(img.data),
                  ext: 'png',
                  pageNumber: pNum,
                  width: img.width || 240,
                  height: img.height || 160,
                  name: img.name || `hal-${pNum}`,
                  pageContext: snippet,
                });
              }
            }
            if (extractedImages.length >= 20) break;
          }
        }
      } catch {
        // Ignore image extraction failures on unsupported PDF image filters
      }
    } finally {
      await parser.destroy().catch(() => {});
    }
  } else if (ext === 'DOCX') {
    const result = await mammoth.extractRawText({ buffer });
    text = (result.value || '').trim();
    pageCount = Math.max(1, Math.ceil(text.length / 1800));
    try {
      const zip = await JSZip.loadAsync(buffer);
      const mediaFiles = Object.keys(zip.files).filter((n) => /^word\/media\/.+\.(png|jpg|jpeg)$/i.test(n));
      for (let i = 0; i < Math.min(25, mediaFiles.length); i++) {
        const fname = mediaFiles[i];
        const buf = await zip.files[fname].async('nodebuffer');
        pushUniqueImage({
          buffer: buf,
          ext: fname.toLowerCase().endsWith('.png') ? 'png' : 'jpg',
          pageNumber: 1,
          width: 240,
          height: 160,
          name: fname.split('/').pop() || `gambar-${i + 1}`,
          pageContext: text.slice(0, 260),
        });
      }
    } catch {
      // ignore zip media extraction fallback
    }
  } else if (ext === 'PPTX') {
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const na = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
        const nb = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
        return na - nb;
      });
    const slideTexts: string[] = [];
    for (let i = 0; i < slideFiles.length; i++) {
      const xml = await zip.files[slideFiles[i]].async('string');
      const runs = Array.from(xml.matchAll(/<a:t[^>]*>(.*?)<\/a:t>/g)).map((m) => m[1]);
      if (runs.length > 0) {
        slideTexts.push(`Slide ${i + 1}: ${runs.join(' ')}`);
      }
    }
    text = slideTexts.join('\n\n').trim();
    pageCount = Math.max(1, slideFiles.length);
    const mediaFiles = Object.keys(zip.files).filter((n) => /^ppt\/media\/.+\.(png|jpg|jpeg)$/i.test(n));
    for (let i = 0; i < Math.min(25, mediaFiles.length); i++) {
      const fname = mediaFiles[i];
      const buf = await zip.files[fname].async('nodebuffer');
      pushUniqueImage({
        buffer: buf,
        ext: fname.toLowerCase().endsWith('.png') ? 'png' : 'jpg',
        pageNumber: 1,
        width: 240,
        height: 160,
        name: fname.split('/').pop() || `slide-img-${i + 1}`,
        pageContext: text.slice(0, 260),
      });
    }
  } else if (ext === 'DOC') {
    // Legacy binary .doc readable text fallback extraction
    const utf8 = buffer.toString('utf8').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ');
    const cleaned = utf8.replace(/[^\p{L}\p{N}\p{P}\s]/gu, ' ').replace(/\s{2,}/g, ' ').trim();
    text = cleaned;
    pageCount = Math.max(1, Math.ceil(text.length / 1800));
  } else {
    text = buffer.toString('utf8').trim();
    pageCount = Math.max(1, Math.ceil(text.length / 1800));
  }

  if (!text || text.length < 20) {
    throw new Error('Dokumen tidak memiliki teks yang dapat diekstrak (mungkin berupa PDF hasil scan gambar atau file rusak).');
  }

  const chapters = detectChapters(text);
  const chunks = splitIntoChunks(text, pageCount, chapters);

  return {
    text,
    pageCount,
    fileType: ext,
    chapters,
    chunks,
    extractedImages,
  };
}
