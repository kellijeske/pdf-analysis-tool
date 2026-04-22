import { useCallback, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  analyzeImageDataForCopierColor,
  pdfPointsToInches
} from './pdfPageColorAnalysis';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_RENDER_EDGE_PX = 1400;
const MIN_RENDER_SCALE = 1;
const MAX_RENDER_SCALE = 2;

type PdfPageRow = {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  widthIn: number;
  heightIn: number;
  isColor: boolean;
  colorPercentOfContent: number;
};

function formatInches(n: number): string {
  return n.toFixed(2);
}

function isPdfFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type === 'application/pdf' || name.endsWith('.pdf');
}

function firstPdfFromFileList(list: FileList | File[]): File | undefined {
  return Array.from(list).find(isPdfFile);
}

function UploadIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<PdfPageRow[]>([]);
  const [progressLabel, setProgressLabel] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const analyzeFile = useCallback(async (file: File) => {
    setError(null);
    setPages([]);
    setFileName(file.name);
    setBusy(true);
    setProgressPct(0);
    setProgressLabel('Loading PDF...');

    try {
      const buf = await file.arrayBuffer();
      const data = new Uint8Array(buf);
      const loadingTask = pdfjsLib.getDocument({ data, stopAtErrors: false });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      const rows: PdfPageRow[] = [];

      for (let p = 1; p <= numPages; p++) {
        setProgressLabel(`Rendering page ${p} of ${numPages}...`);
        setProgressPct(Math.round(((p - 1) / numPages) * 100));

        const page = await pdf.getPage(p);
        const baseVp = page.getViewport({ scale: 1 });
        const longEdge = Math.max(baseVp.width, baseVp.height);
        const scale = Math.min(
          MAX_RENDER_SCALE,
          Math.max(MIN_RENDER_SCALE, MAX_RENDER_EDGE_PX / longEdge)
        );
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        const w = Math.ceil(viewport.width);
        const h = Math.ceil(viewport.height);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Could not get a 2D canvas context.');

        await page.render({ canvasContext: ctx, viewport }).promise;

        const imageData = ctx.getImageData(0, 0, w, h);
        const score = analyzeImageDataForCopierColor(imageData, { stride: 2 });

        rows.push({
          pageNumber: p,
          widthPt: baseVp.width,
          heightPt: baseVp.height,
          widthIn: pdfPointsToInches(baseVp.width),
          heightIn: pdfPointsToInches(baseVp.height),
          isColor: score.isColor,
          colorPercentOfContent: score.colorPercentOfContent
        });

        await new Promise((r) => requestAnimationFrame(r));
      }

      setPages(rows);
      setProgressPct(100);
      setProgressLabel('Done.');
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to analyze PDF.');
      setPages([]);
    } finally {
      setBusy(false);
    }
  }, []);

  const onPickFile = () => inputRef.current?.click();

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!isPdfFile(f)) {
      setError('Choose a PDF file (.pdf).');
      return;
    }
    void analyzeFile(f);
  };

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (busy) return;
      dragDepthRef.current += 1;
      setIsDragging(true);
    },
    [busy]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!busy) e.dataTransfer.dropEffect = 'copy';
    },
    [busy]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragging(false);
      if (busy) return;
      const pdf = firstPdfFromFileList(e.dataTransfer.files);
      if (pdf) void analyzeFile(pdf);
      else {
        setPages([]);
        setError('Drop a PDF file (.pdf).');
      }
    },
    [busy, analyzeFile]
  );

  const colorCount = pages.filter((r) => r.isColor).length;
  const bwCount = pages.length - colorCount;

  return (
    <main className="app">
      <section className="panel">
        <div className="panel-intro">
          <img
            className="panel-intro-image"
            src="/pages.png"
            alt=""
            decoding="async"
          />
          <div className="panel-intro-text">
            <h1>PDF Analysis Tool</h1>
            <p className="subtitle">
              Drag and drop a PDF to estimate total pages, page sizes, and whether each page would
              likely be billed as color vs black and white.
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={onInputChange}
        />

        <div
          role="button"
          tabIndex={0}
          aria-label="Drop a PDF file here, or activate to choose a file"
          onClick={() => !busy && onPickFile()}
          onKeyDown={(e) => {
            if (busy) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onPickFile();
            }
          }}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`dropzone ${isDragging && !busy ? 'dragging' : ''} ${busy ? 'busy' : ''}`}
        >
          {!busy && (
            <div className="dropzone-icon">
              <UploadIcon size={40} />
            </div>
          )}
          <div className="drop-title">{busy ? 'Analyzing PDF...' : 'Drag and drop a PDF here'}</div>
          <div className="drop-subtitle">
            {busy
              ? 'Please wait while pages are analyzed.'
              : 'Or click this area to browse — .pdf only'}
          </div>
        </div>

        <div className="toolbar">
          <button type="button" onClick={onPickFile} disabled={busy} className="toolbar-btn">
            {!busy && <UploadIcon size={18} />}
            <span>{busy ? 'Analyzing...' : 'Choose PDF'}</span>
          </button>
          {fileName && !busy && <span className="file-name">Last file: {fileName}</span>}
        </div>

        {busy && (
          <div className="progress-block">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="progress-label">{progressLabel}</div>
          </div>
        )}

        {error && <div className="error">{error}</div>}
      </section>

      {pages.length > 0 && (
        <>
          <section className="stats-grid">
            <article className="panel stat">
              <div className="stat-label">Pages</div>
              <div className="stat-value">{pages.length}</div>
            </article>
            <article className="panel stat">
              <div className="stat-label">B/W (est.)</div>
              <div className="stat-value">{bwCount}</div>
            </article>
            <article className="panel stat">
              <div className="stat-label">Color (est.)</div>
              <div className="stat-value">{colorCount}</div>
            </article>
          </section>

          <section className="panel">
            <h2>Per-page breakdown</h2>
            <div className="table-wrap">
              <table className="table-breakdown">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Size (in)</th>
                    <th>Size (pt)</th>
                    <th>Billing (est.)</th>
                    <th>Color on page</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((row) => (
                    <tr key={row.pageNumber}>
                      <td>{row.pageNumber}</td>
                      <td>
                        {formatInches(row.widthIn)} x {formatInches(row.heightIn)}
                      </td>
                      <td className="cell-secondary">
                        {Math.round(row.widthPt)} x {Math.round(row.heightPt)}
                      </td>
                      <td>
                        <span className={`pill ${row.isColor ? 'pill-color' : 'pill-bw'}`}>
                          {row.isColor ? 'Color' : 'B/W'}
                        </span>
                      </td>
                      <td>
                        {row.colorPercentOfContent < 0.01
                          ? '< 0.01%'
                          : `${row.colorPercentOfContent.toFixed(2)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
