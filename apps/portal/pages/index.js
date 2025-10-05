
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * PhotoCard 2.0 — Portal: pages/index.js
 *
 * Fix: Avoids "process is not defined" on the client by resolving API base
 *      safely at runtime with multiple fallbacks (meta tag, window global,
 *      env on server). Also keeps the 4 requested customizations:
 * 1) Real-time dynamic status (auto-updating Pending → Processing → Done/Error)
 * 2) Download button + clear save location visibility (outputUrl/outputPath)
 * 3) Clean history behavior (show only latest by default; optional toggle for history)
 * 4) Modern, eye-catching UI with Tailwind (no external UI deps)
 *
 * API assumptions (adjust if your API differs):
 * - POST   /jobs                      -> { id, status, headline, outputUrl?, outputPath? }
 * - GET    /jobs?limit=10             -> [job, ...]
 * - GET    /jobs/:id                  -> job
 *
 * How API base is detected (in order):
 *   1) <meta name="api-base" content="http://localhost:4000"> (client)
 *   2) window.__APP_API_BASE__ (client)
 *   3) process.env.NEXT_PUBLIC_API_BASE_URL (server or bundler-inlined)
 *   4) "" (empty) → same-origin fetch
 */

// Safe resolver — NEVER directly touch `process.env` at module top-level.
function resolveApiBase() {
  let raw = "";
  try {
    // 1) Meta tag on client
    if (typeof window !== "undefined") {
      const meta = document.querySelector('meta[name="api-base"]');
      if (meta && meta.content) raw = meta.content;
      // 2) Global shim
      if (!raw && typeof window.__APP_API_BASE__ === "string") raw = window.__APP_API_BASE__;
    }
    // 3) Server-side / bundler inline
    // Guard against ReferenceError: `process` may not exist in some runtimes
    if (!raw && typeof process !== "undefined" && process?.env?.NEXT_PUBLIC_API_BASE_URL) {
      raw = process.env.NEXT_PUBLIC_API_BASE_URL;
    }
  } catch (_) {}
  if (typeof raw !== "string") raw = "";
  return raw.replace(/\/$/, ""); // trim trailing slash
}

const STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  DONE: "DONE",
  ERROR: "ERROR",
};

const STATUS_STEPS = [STATUS.PENDING, STATUS.PROCESSING, STATUS.DONE];

export default function HomePage() {
  // Compute API base at runtime (client-safe)
  const API_BASE = useMemo(() => resolveApiBase(), []);

  const [form, setForm] = useState({ headline: "", backgroundUrl: "", newsImageUrl: "" });
  const [submitting, setSubmitting] = useState(false);

  const [latestJob, setLatestJob] = useState(null); // Only the most recent job shown by default
  const [jobs, setJobs] = useState([]); // History (hidden by default)
  const [showHistory, setShowHistory] = useState(false);

  const pollTimer = useRef(null);

  // --- Helpers --------------------------------------------------------------
  const prettyStatus = (status) => {
    switch (status) {
      case STATUS.PENDING: return { label: "Queued", color: "bg-yellow-100 text-yellow-800" };
      case STATUS.PROCESSING: return { label: "Processing", color: "bg-blue-100 text-blue-800" };
      case STATUS.DONE: return { label: "Done", color: "bg-green-100 text-green-800" };
      case STATUS.ERROR: return { label: "Error", color: "bg-red-100 text-red-800" };
      default: return { label: status || "Unknown", color: "bg-gray-100 text-gray-800" };
    }
  };

  const storageHint = (job) => {
    if (!job) return "";
    if (job.outputPath) return `Local: ${job.outputPath}`;
    if (job.outputUrl) {
      try {
        const u = new URL(job.outputUrl);
        if (/(drive|googleusercontent|cloudinary|dropbox|onedrive)/i.test(u.hostname)) {
          return `Cloud: ${u.hostname}`;
        }
        return `URL: ${job.outputUrl}`;
      } catch {
        return `URL: ${job.outputUrl}`;
      }
    }
    return "(No output yet)";
  };

  const stepIndex = (status) => {
    const idx = STATUS_STEPS.indexOf(status);
    return idx === -1 ? 0 : idx;
  };

  // Programmatic download helper — fetches the resource as a blob and triggers a download
  const downloadResource = async (url, suggestedName) => {
    if (!url) return;
    // First attempt: server-side proxy to ensure same-origin attachment
    try {
      const proxyUrl = `${API_BASE || ''}/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(suggestedName || '')}`;
      const r = await fetch(proxyUrl);
      if (r.ok) {
        const blob = await r.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = suggestedName || (new URL(url)).pathname.split('/').pop() || 'download';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
        return;
      }
    } catch (e) {
      console.warn('Proxy download failed, falling back to client fetch', e);
    }

    // Fallback: client-side fetch -> blob
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('Failed to download');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = suggestedName || (new URL(url)).pathname.split('/').pop() || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    } catch (e) {
      console.error('Download failed', e);
      try { window.open(url, '_blank', 'noopener'); } catch (_) { alert('Download failed — check console for details'); }
    }
  };

  // --- Initial load: fetch only the latest job so the UI stays clean --------
  useEffect(() => {
    // If API supports it, load only the last job
    fetch(`${API_BASE}/jobs?limit=1`)
      .then((r) => (r.ok ? r.json() : []))
      .then((arr) => {
        if (Array.isArray(arr) && arr.length) {
          const [j] = arr;
          setLatestJob(j);
          if (j.status !== STATUS.DONE && j.status !== STATUS.ERROR) {
            startPolling(j.id);
          }
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_BASE]);

  // --- Polling --------------------------------------------------------------
  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const startPolling = (jobId) => {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/jobs/${jobId}`);
        if (!r.ok) return;
        const j = await r.json();
        setLatestJob(j);
        // Optionally reflect into history head as well
        setJobs((prev) => {
          const without = prev.filter((x) => x.id !== j.id);
          return [j, ...without].slice(0, 10);
        });
        if (j.status === STATUS.DONE || j.status === STATUS.ERROR) {
          stopPolling();
        }
      } catch (_) {}
    }, 2000);
  };

  // --- Handlers -------------------------------------------------------------
  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!form.headline?.trim()) return;
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            headline: form.headline,
            backgroundUrl: form.backgroundUrl,
            newsImageUrl: form.newsImageUrl,
          }),
      });
      if (!r.ok) throw new Error("Failed to create job");
      const j = await r.json();
      setLatestJob(j);
      setJobs((prev) => [j, ...prev].slice(0, 10));
      setShowHistory(false); // keep UI clean
      startPolling(j.id);
    } catch (err) {
      console.error(err);
      alert("Job create করতে সমস্যা হয়েছে. Console চেক করুন.");
    } finally {
      setSubmitting(false);
    }
  };

  const loadHistory = async () => {
    try {
      const r = await fetch(`${API_BASE}/jobs?limit=10`);
      if (!r.ok) return;
      const arr = await r.json();
      setJobs(Array.isArray(arr) ? arr : []);
    } catch (_) {}
  };

  const onToggleHistory = async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && jobs.length === 0) {
      await loadHistory();
    }
  };

  const clearHistoryFromUI = () => {
    setJobs(latestJob ? [latestJob] : []);
    setShowHistory(false);
  };

  // --- UI Pieces ------------------------------------------------------------
  const StatusBadge = ({ status }) => {
    const { label, color } = prettyStatus(status);
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${color}`}>
        <span className="w-2 h-2 rounded-full bg-current opacity-70" />
        {label}
      </span>
    );
  };

  const Stepper = ({ status }) => {
    const active = stepIndex(status);
    return (
      <div className="flex items-center gap-3 select-none">
        {STATUS_STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-3">
            <div
              className={`w-8 h-8 flex items-center justify-center rounded-full text-xs font-bold border 
              ${i < active ? "bg-green-600 text-white border-green-600" : i === active ? "bg-blue-600 text-white border-blue-600" : "bg-gray-100 text-gray-500 border-gray-300"}
            `}
            >
              {i + 1}
            </div>
            {i < STATUS_STEPS.length - 1 && (
              <div className={`w-10 h-1 rounded ${i < active ? "bg-green-600" : "bg-gray-200"}`} />
            )}
          </div>
        ))}
      </div>
    );
  };

  const JobCard = ({ job, primary }) => {
    if (!job) return null;
    const store = storageHint(job);
    return (
      <div className={`rounded-2xl p-5 shadow-lg border ${primary ? "bg-white" : "bg-gray-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <StatusBadge status={job.status} />
            <span className="text-sm text-gray-500">ID: {job.id?.slice?.(0, 8) || job.id}</span>
          </div>
          <Stepper status={job.status} />
        </div>

        <h3 className="mt-3 text-xl font-semibold text-gray-900 line-clamp-2">{job.headline}</h3>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <div className="relative rounded-xl overflow-hidden border bg-black/5">
              {job.outputUrl ? (
                // Preview output
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={job.outputUrl} alt="output" className="w-full h-auto block" />
                  <div className="absolute bottom-3 right-3 flex items-center gap-2">
                    <button
                      onClick={() => downloadResource(job.outputUrl, `${job.id}.png`)}
                      className="px-3 py-2 rounded-lg bg-white/90 hover:bg-white text-gray-900 shadow font-semibold text-sm"
                    >
                      Download
                    </button>
                    <a
                      href={job.outputUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 rounded-lg bg-gray-900/90 hover:bg-gray-900 text-white shadow font-semibold text-sm"
                    >
                      Open
                    </a>
                  </div>
                </>
              ) : (
                <div className="p-10 text-center text-gray-500 text-sm">
                  No image yet. The job is {prettyStatus(job.status).label}…
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border p-3 bg-white">
              <div className="text-xs text-gray-500">Storage</div>
              <div className="text-sm font-medium break-all">{store}</div>
              {(job.outputPath || job.outputUrl) && (
                <button
                  onClick={() => {
                    const text = job.outputPath || job.outputUrl;
                    navigator.clipboard?.writeText(text);
                  }}
                  className="mt-2 px-2.5 py-1.5 rounded-md text-xs bg-gray-100 hover:bg-gray-200"
                >
                  Copy location
                </button>
              )}
            </div>

            <div className="rounded-lg border p-3 bg-white">
              <div className="text-xs text-gray-500">Created</div>
              <div className="text-sm font-medium">
                {job.createdAt ? new Date(job.createdAt).toLocaleString() : "—"}
              </div>
            </div>

            {job.error && (
              <div className="rounded-lg border p-3 bg-red-50 text-red-700 text-sm">
                {String(job.error)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-5xl mx-auto px-4 py-10">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div className="w-full text-center mt-4">
            <h1 className="text-center text-3xl md:text-4xl font-extrabold tracking-tight">📸 <br /> News PhotoCard Generator <br />2.0</h1>
            {/* <p className="text-gray-600 mt-1">Dynamic status • Clean history • Download ready</p> */}
          </div>
          <div className="text-xs text-gray-500">
            <div>
              {/* <span className="font-semibold">API:</span> {API_BASE || "(same origin)"} */}
            </div>
          </div>
        </header>

        {/* Form */}
        <form onSubmit={onSubmit} className="bg-white border rounded-2xl shadow p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-3">
              <label className="block text-sm font-medium mb-1">Headline</label>
              <input
                name="headline"
                value={form.headline}
                onChange={onChange}
                placeholder="Write the news headline…"
                className="w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Background URL</label>
              <input
                name="backgroundUrl"
                value={form.backgroundUrl}
                onChange={onChange}
                placeholder="https://…"
                className="w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">News Image URL</label>
              <input
                name="newsImageUrl"
                value={form.newsImageUrl}
                onChange={onChange}
                placeholder="https://…"
                className="w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={submitting}
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 text-white font-semibold shadow hover:bg-red-700 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    Creating…
                  </>
                ) : (
                  <>Create Job</>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Latest Job */}
        <section className="mt-8 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Latest</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={onToggleHistory}
                className="text-sm px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
              >
                {showHistory ? "Hide History" : "Show History"}
              </button>
              <button
                onClick={clearHistoryFromUI}
                className="text-sm px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
              >
                Clear History
              </button>
            </div>
          </div>

          {latestJob ? (
            <JobCard job={latestJob} primary />
          ) : (
            <div className="rounded-2xl p-6 border bg-white text-gray-500">No job yet. Create your first PhotoCard.</div>
          )}
        </section>

        {/* History (optional view) */}
        {showHistory && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold mb-3">History (latest 10)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {jobs.map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
            </div>
          </section>
        )}

  <footer className="py-10 text-center text-xs text-gray-400">© Dhaka Heralds<br />Powered By The Code Work Studio.</footer>
      </div>
    </div>
  );
}

/**
 * Lightweight runtime smoke-tests (dev only):
 * These run in the browser console and never block the UI.
 */
(function runResolveApiBaseTests() {
  if (typeof window === "undefined") return; // client-only tests
  if (window.__RAN_API_BASE_TESTS__) return; // idempotent
  window.__RAN_API_BASE_TESTS__ = true;
  const origMeta = document.querySelector('meta[name="api-base"]');
  const cleanupMeta = () => {
    const m = document.querySelector('meta[name="api-base"]');
    if (m && !origMeta) m.parentNode?.removeChild(m);
  };

  function addMeta(content) {
    let m = document.querySelector('meta[name="api-base"]');
    if (!m) {
      m = document.createElement("meta");
      m.setAttribute("name", "api-base");
      document.head.appendChild(m);
    }
    m.setAttribute("content", content);
    return m;
  }

  try {
    // Case 1: meta tag
    addMeta("http://localhost:4000/");
    console.assert(resolveApiBase() === "http://localhost:4000", "[TEST] meta tag should be used and trimmed");

    // Case 2: window global
    cleanupMeta();
    window.__APP_API_BASE__ = "https://api.example.com/";
    console.assert(resolveApiBase() === "https://api.example.com", "[TEST] window global should be used and trimmed");
    delete window.__APP_API_BASE__;

    // Case 3: fallback to empty string (same-origin)
    console.assert(resolveApiBase() === "", "[TEST] fallback should be empty string for same-origin");
  } catch (e) {
    // Never break the app for tests
    // eslint-disable-next-line no-console
    console.warn("[TEST] resolveApiBase tests encountered an error:", e);
  } finally {
    cleanupMeta();
  }
})();

