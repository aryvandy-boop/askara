import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import crypto from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { sqlite } from './db.ts';

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY belum dikonfigurasi pada environment server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const ALLOWED_MODELS = new Set(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);

function getActiveAiConfig(): { model: string; thinkingLevel: ThinkingLevel } {
  const modelRow = sqlite.prepare('SELECT value FROM system_settings WHERE key = ?').get('ai_model') as { value: string } | undefined;
  const thinkRow = sqlite.prepare('SELECT value FROM system_settings WHERE key = ?').get('ai_thinking_level') as { value: string } | undefined;

  const candidate = modelRow?.value || 'gemini-4-hydrogen';
  const model = ALLOWED_MODELS.has(candidate) ? candidate : 'gemini-4-hydrogen';

  let thinkingLevel = ThinkingLevel.LOW;
  if (model === 'gemini-4-hydrogen') {
    if (thinkRow?.value === 'HIGH') thinkingLevel = ThinkingLevel.HIGH;
    else if (thinkRow?.value === 'MEDIUM') thinkingLevel = ThinkingLevel.MEDIUM;
  } else {
    thinkingLevel = ThinkingLevel.MINIMAL;
  }
  return { model, thinkingLevel };
}

function checkTenantAiQuota(tenantId: string) {
  const sub = sqlite.prepare('SELECT monthly_ai_limit, status FROM subscriptions WHERE tenant_id = ?').get(tenantId) as any;
  if (sub && sub.status !== 'active') {
    throw new Error('Langganan lembaga Anda sedang tidak aktif. Hubungi Super Admin ASKARA 04.');
  }
  const limit = sub?.monthly_ai_limit || 500;
  const monthCount = sqlite
    .prepare(
      `SELECT COUNT(*) AS cnt FROM ai_usage_logs
       WHERE tenant_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
    )
    .get(tenantId) as { cnt: number };

  if (monthCount.cnt >= limit) {
    throw new Error(`Batas kuota AI bulanan (${limit} panggilan) untuk lembaga ini telah tercapai.`);
  }
}

function logAiUsage(
  tenantId: string,
  userId: string,
  operation: string,
  modelName: string,
  promptTokens: number,
  outputTokens: number,
  status: 'success' | 'error',
  durationMs: number
) {
  try {
    sqlite
      .prepare(
        `INSERT INTO ai_usage_logs (id, tenant_id, user_id, operation, model_name, prompt_tokens, output_tokens, status, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), tenantId, userId, operation, modelName, promptTokens, outputTokens, status, durationMs);
  } catch (err) {
    console.error('Failed to log AI usage:', err);
  }
}

export function retrieveRagChunks(
  tenantId: string,
  referenceIds: string[],
  queryText: string,
  limit = 10,
  selectedChapters?: string[]
) {
  if (!referenceIds.length) return [];
  const placeholders = referenceIds.map(() => '?').join(',');
  const rows = sqlite
    .prepare(
      `SELECT rc.id, rc.document_id, rc.chunk_index, rc.chapter_title, rc.page_number, rc.content, rc.keywords,
              rd.title AS doc_title, rd.chapters_json AS doc_chapters_json
       FROM reference_chunks rc
       JOIN reference_documents rd ON rd.id = rc.document_id
       WHERE rc.tenant_id = ? AND rc.document_id IN (${placeholders})
       ORDER BY rc.chunk_index ASC`
    )
    .all(tenantId, ...referenceIds) as Array<{
    id: string;
    document_id: string;
    chunk_index: number;
    chapter_title: string;
    page_number: number;
    content: string;
    keywords: string;
    doc_title: string;
    doc_chapters_json?: string;
  }>;

  const totalByDoc = new Map<string, number>();
  const chaptersByDoc = new Map<string, string[]>();
  for (const row of rows) {
    totalByDoc.set(row.document_id, (totalByDoc.get(row.document_id) || 0) + 1);
    if (!chaptersByDoc.has(row.document_id)) {
      try {
        const parsedCh = JSON.parse(row.doc_chapters_json || '[]');
        chaptersByDoc.set(row.document_id, Array.isArray(parsedCh) ? parsedCh : []);
      } catch {
        chaptersByDoc.set(row.document_id, []);
      }
    }
  }

  const normalizedChapters = (selectedChapters || [])
    .map((c) => String(c || '').trim())
    .filter(Boolean);

  const chapterNeedles = normalizedChapters.map((ch) => {
    const clean = ch.replace(/\s*\(hal\.?[^)]*\)/gi, '').trim().toLowerCase();
    const prefixMatch = clean.match(/^(bab|unit|modul|tema|subtema|pelajaran|topik|bagian)\s+[ivx0-9a-z]+/i);
    const words = clean
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !['bab', 'unit', 'modul', 'tema', 'hal', 'dan', 'untuk', 'dengan'].includes(w));
    return { rawLower: ch.toLowerCase(), clean, prefix: prefixMatch?.[0]?.toLowerCase() || '', words };
  });

  const queryTerms = queryText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);

  if (queryTerms.length === 0 && chapterNeedles.length === 0) {
    return rows.slice(0, limit);
  }

  const scored = rows.map((row) => {
    const titleLower = (row.chapter_title || '').toLowerCase();
    const hay = `${titleLower} ${row.keywords} ${row.content}`.toLowerCase();
    let score = 0;
    let chapterMatched = false;

    for (const term of queryTerms) {
      if (hay.includes(term)) score += 2;
      if (titleLower.includes(term)) score += 3;
    }

    if (chapterNeedles.length > 0) {
      const docChaps = chaptersByDoc.get(row.document_id) || [];
      const totalDocChunks = Math.max(1, totalByDoc.get(row.document_id) || 1);

      for (const needle of chapterNeedles) {
        if (
          titleLower === needle.rawLower ||
          titleLower.includes(needle.clean) ||
          (needle.prefix && titleLower.includes(needle.prefix))
        ) {
          score += 30;
          chapterMatched = true;
        } else if (needle.prefix && row.content.toLowerCase().includes(needle.prefix)) {
          score += 18;
          chapterMatched = true;
        } else if (needle.words.length > 0) {
          const wordHits = needle.words.filter((w) => hay.includes(w)).length;
          if (wordHits >= Math.max(1, Math.ceil(needle.words.length / 2))) {
            score += 12 + wordHits * 3;
            chapterMatched = true;
          }
        }

        // Positional chapter segment check only when chunk chapter_title is generic (no conflicting explicit Bab/Unit/Tema prefix)
        const rowPrefixMatch = titleLower.match(/^(bab|unit|modul|tema|subtema|pelajaran|topik|bagian)\s+[ivx0-9a-z]+/i);
        const hasConflictingPrefix =
          Boolean(needle.prefix) &&
          Boolean(rowPrefixMatch?.[0]) &&
          rowPrefixMatch![0].toLowerCase() !== needle.prefix;

        if (!chapterMatched && !hasConflictingPrefix && docChaps.length > 1) {
          const chIdx = docChaps.findIndex((c) => {
            const cl = c.toLowerCase();
            return cl === needle.rawLower || cl.includes(needle.clean);
          });
          if (chIdx >= 0) {
            const relStart = chIdx / docChaps.length;
            const relEnd = (chIdx + 1) / docChaps.length;
            const chunkPos = row.chunk_index / totalDocChunks;
            if (chunkPos >= relStart - 0.02 && chunkPos < relEnd) {
              score += 15;
              chapterMatched = true;
            }
          }
        }
      }
    }

    return { row, score, chapterMatched };
  });

  const matchedPool = chapterNeedles.length > 0 ? scored.filter((s) => s.chapterMatched) : scored;
  const pool = matchedPool.length > 0 ? matchedPool : scored;
  pool.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.row.chunk_index - b.row.chunk_index;
  });
  return pool.slice(0, limit).map((s) => s.row);
}

function isTransientGeminiError(err: any): boolean {
  const status = Number(err?.status || err?.code || 0);
  if (status === 503 || status === 429 || status === 500 || status === 502 || status === 504) {
    return true;
  }
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('429') ||
    msg.includes('try again later') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed')
  );
}

function formatReadableGeminiError(err: any): string {
  const raw = String(err?.message || err || '');
  if (isTransientGeminiError(err)) {
    return 'Server AI sedang mengalami lonjakan permintaan sementara (503). Sistem sudah mencoba ulang otomatis—silakan klik ulang proses beberapa detik lagi.';
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) return String(parsed.error.message);
  } catch {
    // not raw JSON
  }
  return raw || 'Terjadi kendala saat menghubungi layanan AI.';
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runJsonPrompt<T>(
  tenantId: string,
  userId: string,
  operation: string,
  prompt: string,
  systemInstruction: string,
  responseSchema: any,
  options?: { fastMode?: boolean }
): Promise<T> {
  checkTenantAiQuota(tenantId);
  const activeCfg = getActiveAiConfig();
  const primaryModel = options?.fastMode ? 'gemini-3.1-flash-lite' : activeCfg.model;
  const primaryThinking = options?.fastMode ? ThinkingLevel.MINIMAL : activeCfg.thinkingLevel;
  const ai = getClient();
  const start = Date.now();

  const attempts: Array<{ model: string; thinkingLevel: ThinkingLevel; delayMs: number }> = [
    { model: primaryModel, thinkingLevel: primaryThinking, delayMs: 0 },
  ];

  if (primaryModel !== 'gemini-3.1-flash-lite') {
    attempts.push(
      { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, delayMs: 400 },
      { model: primaryModel, thinkingLevel: primaryThinking, delayMs: 1200 },
      { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, delayMs: 1200 }
    );
  } else {
    attempts.push(
      { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, delayMs: 900 },
      { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, delayMs: 1600 }
    );
  }

  let lastErr: any;
  let lastAttemptedModel = primaryModel;

  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await sleep(attempt.delayMs);
    }
    lastAttemptedModel = attempt.model;
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model: attempt.model,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema,
            thinkingConfig: { thinkingLevel: attempt.thinkingLevel },
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`AI request timeout (${attempt.model})`)), 25000)
        ),
      ]);

      const duration = Date.now() - start;
      const usage = response.usageMetadata;
      logAiUsage(
        tenantId,
        userId,
        operation,
        attempt.model,
        usage?.promptTokenCount || 0,
        usage?.candidatesTokenCount || 0,
        'success',
        duration
      );

      const text = (response.text || '{}').trim();
      return JSON.parse(text) as T;
    } catch (err: any) {
      lastErr = err;
      if (!isTransientGeminiError(err)) {
        break;
      }
      console.warn(`[AI ${operation}] Attempt with ${attempt.model} hit transient error, retrying/falling back...`);
    }
  }

  const duration = Date.now() - start;
  logAiUsage(tenantId, userId, operation, lastAttemptedModel, 0, 0, 'error', duration);
  throw new Error(formatReadableGeminiError(lastErr));
}

export async function analyzeReferenceWithAI(
  tenantId: string,
  userId: string,
  title: string,
  subject: string,
  gradeLevel: string,
  extractedText: string
) {
  const snippet = extractedText.slice(0, 6000);
  return runJsonPrompt<{
    chapters: string[];
    concepts: string[];
    competencies: string[];
    summary: string;
  }>(
    tenantId,
    userId,
    'ANALYZE_REFERENCE',
    `Analisis dokumen referensi pendidikan berikut dan ekstrak struktur materinya secara ringkas dan akurat dalam Bahasa Indonesia.\nJudul: ${title}\nMata Pelajaran: ${subject}\nKelas: ${gradeLevel}\n\nIsi Dokumen:\n${snippet}`,
    'Anda adalah Spesialis Kurikulum dan Asesmen Pendidikan Indonesia. Hanya ekstrak informasi yang benar-benar ada dalam teks dokumen.',
    {
      type: Type.OBJECT,
      properties: {
        chapters: { type: Type.ARRAY, items: { type: Type.STRING } },
        concepts: { type: Type.ARRAY, items: { type: Type.STRING } },
        competencies: { type: Type.ARRAY, items: { type: Type.STRING } },
        summary: { type: Type.STRING },
      },
      required: ['chapters', 'concepts', 'competencies', 'summary'],
    },
    { fastMode: true }
  );
}

export async function extractCpTpWithAI(
  tenantId: string,
  userId: string,
  subject: string,
  gradeLevel: string,
  phase: string,
  chunksText: string
) {
  return runJsonPrompt<{
    cpList: Array<{ code: string; description: string }>;
    tpList: Array<{ code: string; cpCode: string; description: string; atpNotes: string }>;
    sourceWarning: string;
  }>(
    tenantId,
    userId,
    'EXTRACT_CP_TP',
    `Susun Capaian Pembelajaran (CP) dan Tujuan Pembelajaran (TP) Kurikulum Merdeka untuk:\nMata Pelajaran: ${subject}\nKelas: ${gradeLevel}\nFase: ${phase}\n\nBerdasarkan teks referensi berikut:\n${chunksText.slice(0, 12000)}`,
    'Anda adalah ahli Kurikulum Merdeka SD/SMP/SMA Indonesia. Susun CP dan TP hanya berdasarkan materi referensi yang tersedia. Jika referensi kurang lengkap, jelaskan pada sourceWarning.',
    {
      type: Type.OBJECT,
      properties: {
        cpList: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              code: { type: Type.STRING },
              description: { type: Type.STRING },
            },
            required: ['code', 'description'],
          },
        },
        tpList: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              code: { type: Type.STRING },
              cpCode: { type: Type.STRING },
              description: { type: Type.STRING },
              atpNotes: { type: Type.STRING },
            },
            required: ['code', 'cpCode', 'description', 'atpNotes'],
          },
        },
        sourceWarning: { type: Type.STRING },
      },
      required: ['cpList', 'tpList', 'sourceWarning'],
    }
  );
}

export interface BlueprintItemAI {
  rowNumber: number;
  cp: string;
  tp: string;
  materi: string;
  indikatorSoal: string;
  levelKognitif: string;
  bentukSoal: string;
  nomorSoal: string;
}

export type CognitiveCompositionInput =
  | { LOTS?: number; MOTS?: number; HOTS?: number }
  | { mode?: string; selectedLevels?: string[]; levelCounts?: Record<string, number> };

export async function generateBlueprintWithAI(params: {
  tenantId: string;
  userId: string;
  educationLevel: string;
  gradeLevel: string;
  semester: string;
  subject: string;
  topic: string;
  selectedChapters?: string[];
  assessmentType: string;
  difficulty: string;
  cognitiveComposition: CognitiveCompositionInput;
  questionCounts: Record<string, number>;
  ragContext: string;
  existingCpTp: string;
}) {
  const countLines = Object.entries(params.questionCounts)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `- ${type}: ${count} soal`)
    .join('\n');
  const totalQuestions = Object.values(params.questionCounts).reduce((a, b) => a + b, 0);

  const cogAny = (params.cognitiveComposition || {}) as any;
  const validLevels = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];
  let cognitivePromptLine = '';
  let cognitiveStrictRule = '2. Kolom levelKognitif gunakan format "C1".."C6" (mis. "C1", "C2", "C3", "C4", "C5", "C6").';

  if (Array.isArray(cogAny.selectedLevels) && cogAny.selectedLevels.length > 0) {
    const picked = validLevels.filter((l) => cogAny.selectedLevels.includes(l));
    const activeLevels = picked.length > 0 ? picked : ['C1', 'C2', 'C3', 'C4'];
    const levelCounts = (cogAny.levelCounts || {}) as Record<string, number>;
    const countEntries = activeLevels
      .map((lvl) => ({ lvl, count: Number(levelCounts[lvl] || 0) }))
      .filter((x) => x.count > 0);
    const allocSum = countEntries.reduce((s, x) => s + x.count, 0);

    if (allocSum > 0) {
      const distStr = countEntries.map((x) => `${x.lvl}: ${x.count} soal`).join(', ');
      cognitivePromptLine = `- Level Kognitif Terpilih: ${activeLevels.join(', ')} (Distribusi Target: ${distStr})`;
      cognitiveStrictRule = `2. WAJIB HANYA menggunakan level kognitif yang dipilih guru yaitu [${activeLevels.join(', ')}]. JANGAN gunakan level di luar daftar ini! Usahakan jumlah soal per level sesuai target (${distStr}).`;
    } else {
      cognitivePromptLine = `- Level Kognitif Terpilih: ${activeLevels.join(', ')} (bagi proporsional ke seluruh ${totalQuestions} soal)`;
      cognitiveStrictRule = `2. WAJIB HANYA menggunakan level kognitif yang dipilih guru yaitu [${activeLevels.join(', ')}]. JANGAN gunakan level di luar daftar ini!`;
    }
  } else {
    cognitivePromptLine = `- Komposisi Kognitif Target: LOTS ${cogAny.LOTS ?? 30}%, MOTS ${cogAny.MOTS ?? 50}%, HOTS ${cogAny.HOTS ?? 20}%`;
  }

  const chapterFocusLine =
    params.selectedChapters && params.selectedChapters.length > 0
      ? `- Bab / Materi Terpilih dari Buku:\n  * ${params.selectedChapters.join('\n  * ')}`
      : `- Materi/Bab Fokus: ${params.topic}`;

  return runJsonPrompt<{
    blueprintRows: BlueprintItemAI[];
    sourceWarning: string;
  }>(
    params.tenantId,
    params.userId,
    'GENERATE_BLUEPRINT',
    `Buat Kisi-Kisi Asesmen lengkap dengan total TEPAT ${totalQuestions} butir soal (1 baris kisi-kisi = 1 nomor soal berurutan dari 1 sampai ${totalQuestions}, atau kelompok yang jelas dengan nomor soal tepat berurutan 1..${totalQuestions}).
Spesifikasi Asesmen:
- Jenjang/Kelas: ${params.educationLevel} / ${params.gradeLevel}
- Semester: ${params.semester} (${params.semester === '1' ? 'Ganjil' : 'Genap'})
- Mata Pelajaran: ${params.subject}
${chapterFocusLine}
- Ringkasan Fokus Materi: ${params.topic}
- Jenis Asesmen: ${params.assessmentType}
- Tingkat Kesulitan: ${params.difficulty}
${cognitivePromptLine}
- Rincian Jumlah & Bentuk Soal:
${countLines}

CP & TP Tersedia:
${params.existingCpTp || 'Belum ada CP/TP manual, turunkan langsung dari materi referensi.'}

Materi Referensi (RAG):
${params.ragContext || 'TIDAK ADA REFERENSI DIUNGGAH.'}

ATURAN WAJIB:
1. Buat tepat ${totalQuestions} baris kisi-kisi (nomorSoal "1" sampai "${totalQuestions}") sesuai urutan bentuk soal di atas.
${cognitiveStrictRule}
3. PILAH SEMESTER & BAB SECARA TEGAS: Asesmen ini khusus Semester ${params.semester} (${params.semester === '1' ? 'Ganjil' : 'Genap'}). Ambil materi HANYA dari Bab/Materi terpilih di atas dan potongan buku Referensi (RAG) yang sesuai. Jangan mengambil materi dari bab semester lain yang tidak dipilih.
4. INDIKATOR HARUS JELAS & MANDIRI (ANTI-AMBIGU): Jangan pernah menulis indikator yang menyuruh siswa menghafal letak/nama tokoh buku secara samar tanpa teks (contoh DILARANG: "Mengetahui tokoh dari Papua dalam buku"). Setiap indikator harus jelas arahnya: jika berbasis cerita/tokoh dari buku, cantumkan bahwa soal akan menyajikan cuplikan teks/cerita singkat; jika berbasis konsep/sikap, sajikan konteks situasi nyata yang jelas.
5. Gunakan dasar materi referensi. Jika materi referensi tidak cukup untuk topik/bab/semester yang diminta atau kosong, isi sourceWarning dengan peringatan yang jelas kepada guru.`,
    'Anda adalah Spesialis Evaluasi Pendidikan Indonesia yang teliti. Hasilkan kisi-kisi berbasis referensi yang akurat tanpa mengarang fakta di luar konteks sumber dan bebas indikator ambigu.',
    {
      type: Type.OBJECT,
      properties: {
        blueprintRows: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              rowNumber: { type: Type.INTEGER },
              cp: { type: Type.STRING },
              tp: { type: Type.STRING },
              materi: { type: Type.STRING },
              indikatorSoal: { type: Type.STRING },
              levelKognitif: { type: Type.STRING },
              bentukSoal: { type: Type.STRING },
              nomorSoal: { type: Type.STRING },
            },
            required: ['rowNumber', 'cp', 'tp', 'materi', 'indikatorSoal', 'levelKognitif', 'bentukSoal', 'nomorSoal'],
          },
        },
        sourceWarning: { type: Type.STRING },
      },
      required: ['blueprintRows', 'sourceWarning'],
    }
  );
}

export interface GeneratedQuestionAI {
  questionNumber: number;
  questionType: string;
  materi: string;
  indikatorSoal: string;
  cognitiveLevel: string;
  cognitiveTier: string;
  cognitiveRationale: string;
  difficulty: string;
  questionText: string;
  options: string[];
  matchingPairs: Array<{ left: string; right: string }>;
  correctAnswer: string;
  explanation: string;
  idealAnswer: string;
  scoringGuide: string;
  criteria: Array<{ aspect: string; maxScore: number; description: string }>;
  maxScore: number;
  sourceReference: string;
  sourcePage: string;
  imageUrl?: string;
  imageCaption?: string;
  needsIllustrationPrompt?: string;
  imageSearchQueries?: string[];
}

export async function generateQuestionsBatchWithAI(params: {
  tenantId: string;
  userId: string;
  gradeLevel: string;
  semester: string;
  subject: string;
  topic: string;
  selectedChapters?: string[];
  assessmentType: string;
  lowercaseOptions: boolean;
  blueprintBatch: BlueprintItemAI[];
  ragContext: string;
  availableImages?: Array<{ url: string; pageNumber: number; label: string }>;
}) {
  const bpJson = JSON.stringify(params.blueprintBatch, null, 2);
  const imagesText =
    params.availableImages && params.availableImages.length > 0
      ? params.availableImages.map((img) => `- url: "${img.url}" | Hal. ${img.pageNumber} | ${img.label}`).join('\n')
      : 'Tidak ada gambar terekstrak dari dokumen referensi.';
  const chapterConstraint =
    params.selectedChapters && params.selectedChapters.length > 0
      ? `Bab & Materi Fokus Terpilih dari Buku: ${params.selectedChapters.join(' | ')}`
      : `Materi Fokus: ${params.topic}`;

  return runJsonPrompt<{
    questions: GeneratedQuestionAI[];
    insufficientSourceWarning: string;
  }>(
    params.tenantId,
    params.userId,
    'GENERATE_QUESTIONS',
    `Buat butir soal lengkap sesuai kisi-kisi berikut untuk ${params.subject} ${params.gradeLevel} Semester ${params.semester} (${params.semester === '1' ? 'Ganjil' : 'Genap'}) — ${params.assessmentType}.
${chapterConstraint}
Ringkasan Fokus: ${params.topic}

Daftar Kisi-Kisi Batch Ini:
${bpJson}

Sumber Referensi (RAG):
${params.ragContext || 'TIDAK ADA DOKUMEN REFERENSI.'}

Daftar Gambar Tersedia dari Referensi:
${imagesText}

ATURAN PENULISAN KETAT:
1. Jumlah soal harus sama persis dengan jumlah baris kisi-kisi batch ini (${params.blueprintBatch.length} soal) dengan questionNumber sesuai nomorSoal.
2. KAIDAH SOAL MANDIRI & ARAH PERTANYAAN JELAS (WAJIB DIPATUHI 100%, ANTI-AMBIGU):
   - Saat ujian berlangsung, siswa TIDAK memegang buku paket! Karena itu, setiap butir soal HARUS dapat dipahami dan dijawab secara mandiri hanya dari naskah soal.
   - DILARANG KERAS menulis frasa samar yang merujuk ke buku di luar lembar ujian, seperti: "dalam buku", "di buku", "pada buku", "di halaman ...", "pada bab ...", "tokoh dalam buku", atau "berdasarkan bacaan/cerita di atas" jika bacaannya TIDAK ditulis di dalam questionText!
   - JIKA soal mengangkat tokoh, cerita, dialog, peristiwa, atau data khusus dari buku referensi: WAJIB tuliskan cuplikan cerita/bacaan/konteks singkat (2–4 kalimat utuh) langsung di bagian awal questionText (pisahkan dengan baris baru \\n), lalu tuliskan pertanyaan yang mengarah tegas ke cuplikan tersebut!
     * Contoh SALAH (Ambigu): "Siapakah nama tokoh dalam buku yang berasal dari Papua?"
     * Contoh BENAR (Jelas & Mandiri): "Bacalah cerita singkat berikut!\\nDi kelas satu, Beni berkenalan dengan teman baru bernama Bina yang berasal dari Papua.\\nBerdasarkan cerita di atas, siapakah teman baru Beni yang berasal dari Papua?"
   - JIKA soal menguji konsep, nilai, atau sikap: berikan konteks situasi atau petunjuk arah yang jelas pada pokok soal sehingga siswa langsung paham apa yang ditanyakan tanpa menebak-nebak, dan pastikan HANYA ada 1 jawaban paling benar.
3. Untuk Pilihan Ganda / Pilihan Ganda Kompleks: isi array options tepat 4 pilihan (A, B, C, D tanpa awalan huruf "a.", hanya teks opsi). ${
      params.lowercaseOptions
        ? 'ATURAN KHUSUS ASKARA 04: Tulis teks pilihan jawaban diawali huruf kecil (kecuali nama orang, nama kota/tempat, Tuhan, Pancasila, atau singkatan resmi).'
        : ''
    }
4. Untuk Benar atau Salah: isi options ["benar", "salah"].
5. Untuk Menjodohkan: isi matchingPairs (3-4 pasang pernyataan kiri dan kanan) dan correctAnswer berisi pasangan benarnya.
6. Untuk Isian Singkat / Jawaban Pendek / Uraian / HOTS: options kosong [], isi idealAnswer, scoringGuide, criteria, dan maxScore (mis. Isian = 2, Uraian = 4 atau 5).
7. Soal berlabel HOTS / C4-C6 wajib berbasis stimulus kasus/kontekstual dan menuntut analisis/evaluasi/kreasi nyata, bukan hafalan!
8. Cantumkan sourceReference (nama dokumen/bab) dan sourcePage (nomor halaman dari referensi jika tersedia, atau "Tidak ditemukan di referensi" jika tidak ada).
9. GAMBAR OTOMATIS PADA SOAL (WAJIB TERISI TANPA PERLU EDIT MANUAL):
   - PRIORITAS 1 (GAMBAR DARI BUKU): Jika tersedia gambar asli yang sesuai pada "Daftar Gambar Tersedia dari Referensi" di atas, WAJIB pilih gambar buku tersebut dengan mengisi imageUrl persis sesuai URL pada daftar dan imageCaption yang jelas (kosongkan needsIllustrationPrompt & imageSearchQueries).
   - PRIORITAS 2 (GAMBAR OTOMATIS REFERENSI / ILUSTRASI BUKU): Jika batch ini memiliki minimal 3 soal, WAJIB pilih 2 sampai 3 soal yang materinya konkret/visual (misal: lambang Garuda Pancasila, kegiatan perkenalan/kerja bakti/upacara sekolah, pakaian/rumah adat, peta, pahlawan, tumbuhan/hewan/organ tubuh, siklus air, jam, atau bangun datar/ruang) untuk diberi gambar otomatis! Untuk setiap soal bergambar tersebut: isi needsIllustrationPrompt dengan deskripsi visual yang konkret & jelas, isi imageSearchQueries dengan 2–3 kata kunci pencarian Wikimedia Commons/Wikipedia yang akurat (gabungan Bahasa Indonesia & Bahasa Inggris, misal ["Garuda Pancasila", "National emblem of Indonesia"] atau ["Siklus air", "Water cycle diagram Indonesian"]), serta awali questionText dengan "Perhatikan gambar berikut!\\n" atau "Perhatikan gambar di samping!". JANGAN pernah menulis teks placeholder seperti "(Ilustrasi ...)" di dalam questionText. Untuk soal berbasis teks saja, isi imageUrl="", needsIllustrationPrompt="", dan imageSearchQueries=[].
10. Jika materi referensi tidak memuat informasi memadai untuk beberapa indikator, tuliskan peringatan spesifik di insufficientSourceWarning.`,
    'Anda adalah Pembuat Soal Profesional Kurikulum Merdeka Indonesia. Patuhi Taksonomi Bloom Revisi (C1-C6), EYD V, kaidah soal mandiri yang jelas arahnya tanpa rujukan samar ke buku paket, serta kesetiaan mutlak pada dokumen sumber.',
    {
      type: Type.OBJECT,
      properties: {
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              questionNumber: { type: Type.INTEGER },
              questionType: { type: Type.STRING },
              materi: { type: Type.STRING },
              indikatorSoal: { type: Type.STRING },
              cognitiveLevel: { type: Type.STRING },
              cognitiveTier: { type: Type.STRING },
              cognitiveRationale: { type: Type.STRING },
              difficulty: { type: Type.STRING },
              questionText: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              matchingPairs: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    left: { type: Type.STRING },
                    right: { type: Type.STRING },
                  },
                  required: ['left', 'right'],
                },
              },
              correctAnswer: { type: Type.STRING },
              explanation: { type: Type.STRING },
              idealAnswer: { type: Type.STRING },
              scoringGuide: { type: Type.STRING },
              criteria: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    aspect: { type: Type.STRING },
                    maxScore: { type: Type.INTEGER },
                    description: { type: Type.STRING },
                  },
                  required: ['aspect', 'maxScore', 'description'],
                },
              },
              maxScore: { type: Type.INTEGER },
              sourceReference: { type: Type.STRING },
              sourcePage: { type: Type.STRING },
              imageUrl: { type: Type.STRING },
              imageCaption: { type: Type.STRING },
              needsIllustrationPrompt: { type: Type.STRING },
              imageSearchQueries: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: [
              'questionNumber',
              'questionType',
              'materi',
              'indikatorSoal',
              'cognitiveLevel',
              'cognitiveTier',
              'cognitiveRationale',
              'difficulty',
              'questionText',
              'options',
              'correctAnswer',
              'explanation',
              'maxScore',
              'sourceReference',
              'sourcePage',
            ],
          },
        },
        insufficientSourceWarning: { type: Type.STRING },
      },
      required: ['questions', 'insufficientSourceWarning'],
    }
  );
}

export async function runQualityControlWithAI(params: {
  tenantId: string;
  userId: string;
  subject: string;
  gradeLevel: string;
  expectedCount: number;
  questionsPayload: Array<{
    id: string;
    questionNumber: number;
    questionType: string;
    materi: string;
    indikatorSoal: string;
    cognitiveLevel: string;
    difficulty: string;
    questionText: string;
    options: string[];
    correctAnswer: string;
  }>;
  ragContext: string;
}) {
  return runJsonPrompt<{
    overallSummary: string;
    countCheckPassed: boolean;
    criteriaSummary: Array<{ criterion: string; status: string; notes: string }>;
    questionReviews: Array<{
      questionId: string;
      questionNumber: number;
      status: 'passed' | 'needs_revision';
      issues: string[];
      recommendation: string;
    }>;
  }>(
    params.tenantId,
    params.userId,
    'QUALITY_CONTROL',
    `Lakukan Audit Quality Control menyeluruh terhadap ${params.questionsPayload.length} soal ${params.subject} ${params.gradeLevel} (jumlah target: ${params.expectedCount} soal).
Periksa 13 aspek wajib:
1. Kesesuaian soal dengan materi referensi
2. Kesesuaian dengan CP dan TP
3. Kesesuaian indikator dengan pertanyaan
4. Ketepatan level kognitif (C1-C6)
5. Kejelasan bahasa & arah pertanyaan untuk siswa ${params.gradeLevel}
6. Kemandirian soal (ANTI-AMBIGU): Soal TIDAK BOLEH merujuk samar ke "dalam buku", "di buku", "halaman ...", atau "cerita/teks di atas" tanpa menyertakan cuplikan teks/stimulusnya secara utuh di dalam soal. Jika melanggar, wajib tandai status = "needs_revision".
7. Ketepatan ejaan (EYD V)
8. Kemungkinan jawaban ganda / ambigu
9. Pilihan jawaban (pengecoh) yang tidak masuk akal
10. Duplikasi pertanyaan
11. Kebenaran kunci jawaban
12. Kesesuaian tingkat kesulitan
13. Kesesuaian jumlah soal (${params.questionsPayload.length} vs ${params.expectedCount})

Daftar Soal:
${JSON.stringify(params.questionsPayload)}

Konteks Referensi:
${params.ragContext.slice(0, 6000)}`,
    'Anda adalah Tim Penjaminan Mutu Asesmen Pendidikan (Quality Control). Bersikaplah objektif, teliti, dan konstruktif dalam menemukan cacat soal, terutama soal ambigu atau yang merujuk buku/bacaan tanpa stimulus.',
    {
      type: Type.OBJECT,
      properties: {
        overallSummary: { type: Type.STRING },
        countCheckPassed: { type: Type.BOOLEAN },
        criteriaSummary: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              criterion: { type: Type.STRING },
              status: { type: Type.STRING },
              notes: { type: Type.STRING },
            },
            required: ['criterion', 'status', 'notes'],
          },
        },
        questionReviews: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              questionId: { type: Type.STRING },
              questionNumber: { type: Type.INTEGER },
              status: { type: Type.STRING },
              issues: { type: Type.ARRAY, items: { type: Type.STRING } },
              recommendation: { type: Type.STRING },
            },
            required: ['questionId', 'questionNumber', 'status', 'issues', 'recommendation'],
          },
        },
      },
      required: ['overallSummary', 'countCheckPassed', 'criteriaSummary', 'questionReviews'],
    }
  );
}

export function detectAmbiguousQuestionIssues(q: {
  questionText?: string;
  question_text?: string;
  imageUrl?: string;
  image_url?: string;
}): string[] {
  const text = String(q.questionText ?? q.question_text ?? '').trim();
  const hasImage = Boolean(String(q.imageUrl ?? q.image_url ?? '').trim());
  const issues: string[] = [];
  if (!text) return ['Teks pertanyaan kosong.'];

  if (/\b(dalam|di|pada|dari|menurut)\s+buku(\s+(paket|teks|siswa|pelajaran|ini|tersebut))?\b/i.test(text)) {
    issues.push('Merujuk samar ke "dalam/di/pada buku" padahal siswa ujian tanpa membuka buku paket.');
  }
  if (/\b(di|pada)\s+halaman\s+\d+\b/i.test(text)) {
    issues.push('Merujuk nomor halaman buku yang tidak tersedia di lembar soal.');
  }

  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const sentenceCount = text.split(/[.!?]+/).filter((s) => s.trim().length > 6).length;
  const hasEmbeddedStimulus = lines.length >= 2 || sentenceCount >= 2 || text.length >= 135;

  if (
    /\b(berdasarkan|sesuai|pada|dalam|dari)\s+(bacaan|cerita|teks|paragraf|dialog|percakapan|kisah|tabel)\s+(di\s+atas|tersebut|ini)\b/i.test(text) &&
    !hasEmbeddedStimulus
  ) {
    issues.push('Menyebut "bacaan/cerita/teks di atas/tersebut" tetapi cuplikan teks stimulusnya belum dicantumkan di soal.');
  }

  if (
    (/\btokoh\b/i.test(text) || /\bsiapakah\s+nama\b/i.test(text)) &&
    !hasEmbeddedStimulus &&
    !hasImage
  ) {
    issues.push('Menanyakan nama/tokoh cerita secara langsung tanpa menyertakan penggalan cerita atau konteks pengenal yang jelas.');
  }

  if (/\bperhatikan\s+gambar\b/i.test(text) && !hasImage) {
    issues.push('Menyebut "Perhatikan gambar" tetapi tidak ada gambar yang terlampir pada soal.');
  }

  if (text.length < 22) {
    issues.push('Kalimat pertanyaan terlalu singkat dan kurang memberi arah yang jelas bagi siswa.');
  }

  return issues;
}

export async function repairQuestionWithAI(params: {
  tenantId: string;
  userId: string;
  instruction: string;
  question: any;
  ragContext: string;
}) {
  return runJsonPrompt<GeneratedQuestionAI>(
    params.tenantId,
    params.userId,
    'REPAIR_QUESTION',
    `Perbaiki atau buat ulang soal berikut agar mandiri, bebas ambigu, dan memberi arah pertanyaan yang jelas kepada siswa.
Instruksi Perbaikan: ${params.instruction}

ATURAN WAJIB PERBAIKAN:
1. DILARANG merujuk "dalam buku", "di buku", "halaman ...", atau "cerita/bacaan tersebut" tanpa menulis cuplikan ceritanya!
2. Jika soal membahas tokoh atau cerita dari buku referensi, WAJIB sertakan cuplikan cerita/konteks singkat (2–4 kalimat) dari Referensi langsung di awal questionText (pisahkan dengan baris baru \\n), lalu tuliskan pertanyaannya secara jelas merujuk cuplikan tersebut.
3. Jika tidak perlu cuplikan cerita, ubah menjadi soal konseptual/situasional yang kontekstual, jelas arahnya, dan hanya memiliki 1 jawaban paling benar.
4. Pertahankan questionNumber, questionType, dan bentuk opsi yang sesuai.

Soal Saat Ini:
${JSON.stringify(params.question)}

Referensi:
${params.ragContext.slice(0, 6000)}`,
    'Anda adalah editor soal asesmen pendidikan profesional. Pastikan soal perbaikan 100% mandiri (self-contained), bebas ambigu, jelas arahnya bagi siswa, sesuai level kognitif, dan akurat terhadap materi.',
    {
      type: Type.OBJECT,
      properties: {
        questionNumber: { type: Type.INTEGER },
        questionType: { type: Type.STRING },
        materi: { type: Type.STRING },
        indikatorSoal: { type: Type.STRING },
        cognitiveLevel: { type: Type.STRING },
        cognitiveTier: { type: Type.STRING },
        cognitiveRationale: { type: Type.STRING },
        difficulty: { type: Type.STRING },
        questionText: { type: Type.STRING },
        options: { type: Type.ARRAY, items: { type: Type.STRING } },
        matchingPairs: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              left: { type: Type.STRING },
              right: { type: Type.STRING },
            },
            required: ['left', 'right'],
          },
        },
        correctAnswer: { type: Type.STRING },
        explanation: { type: Type.STRING },
        idealAnswer: { type: Type.STRING },
        scoringGuide: { type: Type.STRING },
        criteria: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              aspect: { type: Type.STRING },
              maxScore: { type: Type.INTEGER },
              description: { type: Type.STRING },
            },
            required: ['aspect', 'maxScore', 'description'],
          },
        },
        maxScore: { type: Type.INTEGER },
        sourceReference: { type: Type.STRING },
        sourcePage: { type: Type.STRING },
      },
      required: [
        'questionNumber',
        'questionType',
        'materi',
        'indikatorSoal',
        'cognitiveLevel',
        'cognitiveTier',
        'cognitiveRationale',
        'difficulty',
        'questionText',
        'options',
        'correctAnswer',
        'explanation',
        'maxScore',
        'sourceReference',
        'sourcePage',
      ],
    }
  );
}

async function runMultimodalJsonPrompt<T>(
  tenantId: string,
  userId: string,
  operation: string,
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
  systemInstruction: string,
  responseSchema: any,
  options?: { fastMode?: boolean }
): Promise<T> {
  checkTenantAiQuota(tenantId);
  const ai = getClient();
  const start = Date.now();
  const models = options?.fastMode
    ? ['gemini-3.1-flash-lite', 'gemini-4-hydrogen']
    : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
  let lastErr: any;

  for (const model of models) {
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: { parts },
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema,
            thinkingConfig: { thinkingLevel: model === 'gemini-4-hydrogen' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL },
          },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Vision timeout (${model})`)), 18000)),
      ]);
      const usage = response.usageMetadata;
      logAiUsage(tenantId, userId, operation, model, usage?.promptTokenCount || 0, usage?.candidatesTokenCount || 0, 'success', Date.now() - start);
      return JSON.parse(response.text || '{}') as T;
    } catch (err: any) {
      lastErr = err;
      if (!isTransientGeminiError(err)) break;
    }
  }
  throw new Error(formatReadableGeminiError(lastErr));
}

export async function describeExtractedBookImagesWithAI(params: {
  tenantId: string;
  userId: string;
  docTitle: string;
  subject: string;
  images: Array<{
    index: number;
    buffer: Buffer;
    ext: 'png' | 'jpg';
    pageNumber: number;
    pageContext?: string;
    name: string;
  }>;
}): Promise<Map<number, { keep: boolean; caption: string }>> {
  const resultMap = new Map<number, { keep: boolean; caption: string }>();
  const subset = params.images.slice(0, 12);
  const batchSize = 4;

  for (let i = 0; i < subset.length; i += batchSize) {
    const batch = subset.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async (img) => {
        try {
          const mimeType = img.ext === 'png' ? 'image/png' : 'image/jpeg';
          const res = await runMultimodalJsonPrompt<{ keep: boolean; caption: string }>(
            params.tenantId,
            params.userId,
            'CAPTION_BOOK_IMAGE',
            [
              {
                inlineData: {
                  mimeType,
                  data: img.buffer.toString('base64'),
                },
              },
              {
                text: `Gambar ini diekstrak dari buku pelajaran "${params.docTitle}" (Mapel: ${params.subject}, Halaman ${img.pageNumber}).
Teks sekitar halaman: "${(img.pageContext || '').slice(0, 240)}"

Tentukan:
1. keep = true jika gambar ini adalah foto, ilustrasi materi, diagram, peta, grafik, simbol materi, atau tokoh pembelajaran yang bermakna untuk dijadikan stimulus soal. keep = false jika hanya logo penerbit/instansi/pemkab/tut wuri di kop halaman, hiasan bingkai/garis halaman, ikon kosong, atau QR code.
2. caption = deskripsi singkat & akurat dalam Bahasa Indonesia (6–14 kata) mengenai isi gambar tersebut.`,
              },
            ],
            'Anda adalah Kurator Gambar Buku Pelajaran Indonesia. Identifikasi isi gambar asli buku dengan akurat.',
            {
              type: Type.OBJECT,
              properties: {
                keep: { type: Type.BOOLEAN },
                caption: { type: Type.STRING },
              },
              required: ['keep', 'caption'],
            },
            { fastMode: true }
          );
          resultMap.set(img.index, {
            keep: Boolean(res.keep),
            caption: String(res.caption || '').trim().slice(0, 140),
          });
        } catch (err) {
          console.warn('[Vision Book Caption] Fallback for image', img.index, err);
        }
      })
    );
  }
  return resultMap;
}

interface CandidateWebImage {
  title: string;
  thumbUrl: string;
  ext: 'png' | 'jpg';
  buffer: Buffer;
  sourceLabel: string;
}

function detectImageFormatFromMagic(buf: Buffer): 'png' | 'jpg' | null {
  if (buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  return null;
}

async function searchWikimediaAndWikipediaCandidates(queries: string[]): Promise<Array<{ title: string; url: string; source: string }>> {
  const seenUrls = new Set<string>();
  const collected: Array<{ title: string; url: string; source: string }> = [];
  const skipTitlePattern = /\b(signature|autograph|blank|placeholder|commons-logo|wiki|ambox|padlock|edit-icon|map_pointer|location_dot)\b/i;
  const headers = { 'User-Agent': 'ASKARA-EdTech/1.0 (https://askara.sch.id)' };

  const pushCandidate = (title: string, url: string, source: string) => {
    if (!url || !url.startsWith('https://') || seenUrls.has(url)) return;
    if (skipTitlePattern.test(title)) return;
    seenUrls.add(url);
    collected.push({ title: title.replace(/^File:/i, '').replace(/\.[^.]+$/, ''), url, source });
  };

  await Promise.allSettled(
    queries.slice(0, 3).map(async (q) => {
      // 1. Wikimedia Commons File Search
      try {
        const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(q)}&gsrlimit=5&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=640&format=json`;
        const resp = await fetch(commonsUrl, { headers, signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
          const data: any = await resp.json();
          const pages = Object.values(data?.query?.pages || {}) as any[];
          for (const p of pages) {
            const info = p?.imageinfo?.[0];
            const thumb = info?.thumburl || info?.url;
            const w = Number(info?.thumbwidth || info?.width || 0);
            const h = Number(info?.thumbheight || info?.height || 0);
            const mime = String(info?.mime || '');
            if (thumb && (w === 0 || w >= 120) && (h === 0 || h >= 90) && !mime.includes('audio') && !mime.includes('video')) {
              pushCandidate(p.title || q, thumb, 'Wikimedia Commons');
            }
          }
        }
      } catch {
        // ignore search error
      }

      // 2. Indonesian Wikipedia & English Wikipedia Page Images
      for (const lang of ['id', 'en']) {
        try {
          const wpUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=3&prop=pageimages&piprop=thumbnail&pithumbsize=640&format=json`;
          const resp = await fetch(wpUrl, { headers, signal: AbortSignal.timeout(4500) });
          if (resp.ok) {
            const data: any = await resp.json();
            const pages = Object.values(data?.query?.pages || {}) as any[];
            for (const p of pages) {
              const thumb = p?.thumbnail?.source;
              const w = Number(p?.thumbnail?.width || 0);
              const h = Number(p?.thumbnail?.height || 0);
              if (thumb && (w === 0 || w >= 120) && (h === 0 || h >= 90)) {
                pushCandidate(p.title || q, thumb, `Wikipedia (${lang.toUpperCase()})`);
              }
            }
          }
        } catch {
          // ignore
        }
      }
    })
  );

  return collected.slice(0, 8);
}

export async function findAuthenticReferenceImageForQuestion(params: {
  tenantId: string;
  userId: string;
  subject: string;
  gradeLevel: string;
  questionText: string;
  visualPrompt?: string;
  searchQueries?: string[];
}): Promise<{ buffer: Buffer; ext: 'png' | 'jpg'; caption: string; sourceTitle: string } | null> {
  let queries = (params.searchQueries || []).map((q) => String(q || '').trim()).filter((q) => q.length >= 2);

  if (queries.length === 0) {
    try {
      const qRes = await runJsonPrompt<{ queries: string[] }>(
        params.tenantId,
        params.userId,
        'IMAGE_SEARCH_QUERY',
        `Buatkan 3 kata kunci singkat untuk mencari FOTO ASLI / DIAGRAM ENSIKLOPEDIA di Wikimedia Commons & Wikipedia yang cocok dengan soal siswa ${params.gradeLevel} (${params.subject}) ini:
Soal: ${params.questionText}
Deskripsi Visual: ${params.visualPrompt || params.questionText}

Aturan:
- Gabungkan kata kunci spesifik Bahasa Indonesia dan Bahasa Inggris (2–4 kata per query).
- Contoh bagus: ["Garuda Pancasila", "National emblem of Indonesia"], ["Candi Borobudur", "Borobudur temple"], ["Siklus air", "Water cycle diagram"], ["Upacara bendera sekolah", "Flag ceremony Indonesia"].`,
        'Anda adalah Pustakawan Referensi Gambar Pendidikan. Berikan kata kunci pencarian gambar ensiklopedia yang paling tepat.',
        {
          type: Type.OBJECT,
          properties: {
            queries: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['queries'],
        },
        { fastMode: true }
      );
      queries = (qRes.queries || []).map((x) => x.trim()).filter(Boolean);
    } catch {
      const fallbackWords = String(params.visualPrompt || params.questionText)
        .replace(/perhatikan gambar[^.!]*[.!]/gi, '')
        .trim()
        .slice(0, 60);
      if (fallbackWords) queries = [fallbackWords];
    }
  }

  if (queries.length === 0) return null;

  let rawCandidates = await searchWikimediaAndWikipediaCandidates(queries);
  if (rawCandidates.length === 0) {
    // Broaden query using 2-3 key nouns from visualPrompt / subject
    const broadTerms = `${params.visualPrompt || params.questionText}`
      .replace(/perhatikan gambar[^.!]*[.!]/gi, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !['yang', 'dengan', 'adalah', 'untuk', 'pada', 'dalam', 'berikut', 'samping', 'siswa', 'sekolah'].includes(w.toLowerCase()))
      .slice(0, 3)
      .join(' ');
    if (broadTerms) {
      rawCandidates = await searchWikimediaAndWikipediaCandidates([broadTerms, `${broadTerms} Indonesia`]);
    }
  }
  if (rawCandidates.length === 0) return null;

  const downloaded: CandidateWebImage[] = [];
  await Promise.allSettled(
    rawCandidates.slice(0, 5).map(async (cand) => {
      try {
        const resp = await fetch(cand.url, {
          headers: { 'User-Agent': 'ASKARA-EdTech/1.0 (https://askara.sch.id)' },
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) return;
        let buf: Buffer<ArrayBufferLike> = Buffer.from(await resp.arrayBuffer());
        if (buf.length < 1500 || buf.length > 4_000_000) return;
        let fmt = detectImageFormatFromMagic(buf);
        if (!fmt) {
          const asTxt = buf.toString('utf8', 0, Math.min(buf.length, 300));
          if (asTxt.includes('<svg')) {
            try {
              const resvg = new Resvg(sanitizeSvgMarkup(buf.toString('utf8')), {
                fitTo: { mode: 'width', value: 480 },
                background: '#ffffff',
              });
              buf = Buffer.from(resvg.render().asPng());
              fmt = 'png';
            } catch {
              return;
            }
          } else {
            return;
          }
        }
        downloaded.push({
          title: cand.title,
          thumbUrl: cand.url,
          ext: fmt,
          buffer: buf,
          sourceLabel: cand.source,
        });
      } catch {
        // skip broken candidate
      }
    })
  );

  if (downloaded.length === 0) return null;

  const topCandidates = downloaded.slice(0, 4);
  try {
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      {
        text: `Pilih SATU gambar asli terbaik (index 0 sampai ${topCandidates.length - 1}) dari kandidat di bawah untuk dimasukkan ke dalam soal ${params.gradeLevel} (${params.subject}) ini:
Soal: "${params.questionText}"
Kriteria visual yang dicari: "${params.visualPrompt || params.questionText}"

ATURAN KETAT:
- Gambar yang dipilih HARUS asli relevan dengan materi soal, jelas, rapi, dan layak untuk siswa sekolah.
- Jika TIDAK ADA gambar kandidat yang relevan atau malah membingungkan/tidak nyambung dengan soal, WAJIB kembalikan selectedIndex = -1.
- Jangan memilih peta negara lain, tanda tangan, monumen negara lain, atau teks buram yang tidak sesuai konteks Indonesia/mapel.`,
      },
    ];

    topCandidates.forEach((c, idx) => {
      parts.push({ text: `Kandidat Index ${idx}: "${c.title}" (${c.sourceLabel})` });
      parts.push({
        inlineData: {
          mimeType: c.ext === 'png' ? 'image/png' : 'image/jpeg',
          data: c.buffer.toString('base64'),
        },
      });
    });

    const pick = await runMultimodalJsonPrompt<{ selectedIndex: number; caption: string }>(
      params.tenantId,
      params.userId,
      'VERIFY_REFERENCE_IMAGE',
      parts,
      'Anda adalah Editor Visual Soal Ujian Sekolah Indonesia. Pilih hanya gambar asli yang benar-benar cocok dengan soal.',
      {
        type: Type.OBJECT,
        properties: {
          selectedIndex: { type: Type.INTEGER },
          caption: { type: Type.STRING },
        },
        required: ['selectedIndex', 'caption'],
      },
      { fastMode: true }
    );

    const idx = Number(pick.selectedIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= topCandidates.length) {
      return null;
    }
    const chosen = topCandidates[idx];
    return {
      buffer: chosen.buffer,
      ext: chosen.ext,
      caption: String(pick.caption || chosen.title).trim().slice(0, 140),
      sourceTitle: `${chosen.sourceLabel}: ${chosen.title}`,
    };
  } catch {
    if (params.searchQueries && params.searchQueries.length > 0 && topCandidates.length > 0) {
      const chosen = topCandidates[0];
      return {
        buffer: chosen.buffer,
        ext: chosen.ext,
        caption: String(chosen.title).trim().slice(0, 140),
        sourceTitle: `${chosen.sourceLabel}: ${chosen.title}`,
      };
    }
    return null;
  }
}

function sanitizeSvgMarkup(rawSvg: string): string {
  let svg = String(rawSvg || '').trim();
  const startIdx = svg.indexOf('<svg');
  const endIdx = svg.lastIndexOf('</svg>');
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('Markup SVG tidak lengkap.');
  }
  svg = svg.slice(startIdx, endIdx + 6);
  // Strip any script tags, foreignObject, external image refs, or inline event handlers
  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, '')
    .replace(/href\s*=\s*(['"])https?:[\s\S]*?\1/gi, '');

  if (!/xmlns=/.test(svg)) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/viewBox=/.test(svg)) {
    svg = svg.replace('<svg', '<svg viewBox="0 0 320 220"');
  }
  return svg;
}

export async function generateEducationalSvgIllustration(params: {
  tenantId: string;
  userId: string;
  subject: string;
  gradeLevel: string;
  questionText: string;
  visualPrompt?: string;
}): Promise<{ pngBuffer: Buffer; caption: string }> {
  const res = await runJsonPrompt<{ svgMarkup: string; caption: string }>(
    params.tenantId,
    params.userId,
    'GENERATE_ILLUSTRATION',
    `Buatlah satu gambar vektor SVG hitam-putih / skala abu-abu bergaya ilustrasi buku pelajaran & naskah soal ujian sekolah Indonesia untuk siswa ${params.gradeLevel} (${params.subject}).
Konteks Soal: ${params.questionText}
Deskripsi Visual yang Diminta: ${params.visualPrompt || params.questionText}

ATURAN TEKNIS SVG KETAT:
1. Gunakan tag tunggal <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" width="320" height="220">.
2. Beri latar belakang putih solid: <rect x="0" y="0" width="320" height="220" fill="#ffffff" /> serta bingkai tipis rapi <rect x="4" y="4" width="312" height="212" rx="6" fill="#ffffff" stroke="#1f2937" stroke-width="1.5" />.
3. Gaya visual: gambar garis edukatif yang bersih, proporsional, jelas dibaca saat dicetak hitam-putih (gunakan #111827 untuk garis utama, #374151/#6b7280 untuk detail, #e5e7eb/#f3f4f6 untuk arsiran/isi).
4. Hindari teks panjang di dalam gambar agar tidak terpotong; gunakan label singkat atau angka saja jika diperlukan (font-family="sans-serif").
5. Dilarang memakai <script>, URL eksternal, atau <foreignObject>. Hanya gunakan elemen standar <rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon>, <path>, <g>, dan <text> seperlunya.
6. Pastikan tidak ada elemen yang keluar dari batas 0..320 dan 0..220.
7. Isi caption singkat (maks 8 kata) dalam Bahasa Indonesia yang menjelaskan gambar.`,
    'Anda adalah Ilustrator Vektor Buku Pelajaran & Naskah Soal Ujian Nasional Indonesia. Hasilkan SVG murni yang rapi, komunikatif, dan siap cetak hitam-putih.',
    {
      type: Type.OBJECT,
      properties: {
        svgMarkup: { type: Type.STRING },
        caption: { type: Type.STRING },
      },
      required: ['svgMarkup', 'caption'],
    },
    { fastMode: true }
  );

  const cleanSvg = sanitizeSvgMarkup(res.svgMarkup);
  const resvg = new Resvg(cleanSvg, {
    fitTo: { mode: 'width', value: 480 },
    background: '#ffffff',
  });
  const pngData = resvg.render();
  return {
    pngBuffer: Buffer.from(pngData.asPng()),
    caption: String(res.caption || '').trim().slice(0, 120),
  };
}

