"use client";

import { useState, useRef } from "react";

const SAMPLE_JSON = `{
  "info": "{\\"Agent Name\\": \\"John Smith\\", \\"Agency Name\\": \\"Premier Travel Agency\\", \\"Email\\": \\"john@premiertravel.com\\", \\"Is the mailing address for commission check the same as the agency address?\\": \\"NO\\", \\"Mailing Address\\": \\"999 Fake Road, New York, IA, 12572\\", \\"Is the commission's check payable name the same as the agency name?\\": \\"NO\\", \\"Check Payable to\\": \\"Mr Check\\", \\"Form of payment\\": \\"Wire\\", \\"Number of passengers\\": \\"2\\", \\"Passenger 1 Seat Preference\\": \\"7777\\", \\"Passenger 1 Frequent Flyer #\\": \\"555555\\", \\"Passenger 1 Known Traveler #\\": \\"11111\\", \\"Passenger 1 Special Requests\\": \\"Kosher meal\\", \\"Passenger 2 Frequent Flyer #\\": \\"545454545\\", \\"Passenger 2 Known Traveler #\\": \\"212121212\\", \\"Passenger 2 Special Requests\\": \\"Kids Diet meal\\", \\"+ COMMISSION PP\\": \\"98989898.00\\", \\"Total\\": \\"98989898.00\\", \\"HubSpot Deal ID\\": \\"9898989\\", \\"Form Type\\": \\"Net Rate (NO CC Fee)\\", \\"Total Per Person\\": \\"0\\", \\"Amount of deals on contact\\": \\"1\\", \\"Please provide your agency address\\": \\"12 Fake Road, New York, IA, 12572\\", \\"HubSpot Deal Name\\": \\"Test Deal 1\\"}"
}`;

export default function PdfPreviewPage() {
  const [jsonInput, setJsonInput] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prevUrlRef = useRef<string | null>(null);

  async function handleGenerate() {
    setError(null);
    setLoading(true);

    // Revoke previous object URL to avoid memory leaks
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonInput.trim());
    } catch {
      setError("Invalid JSON — please check your input and try again.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/highviewtravel/generateFormPDF", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });

      if (!res.ok) {
        const text = await res.text();
        let detail = text;
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          detail = j.details ?? j.error ?? text;
        } catch {}
        throw new Error(detail);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      prevUrlRef.current = url;
      setPdfUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleLoadSample() {
    setJsonInput(SAMPLE_JSON);
    setError(null);
  }

  function handleClear() {
    setJsonInput("");
    setPdfUrl(null);
    setError(null);
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'Inter', system-ui, sans-serif", background: "#f4f6f8" }}>
      {/* Top bar */}
      <div style={{ background: "#126181", padding: "14px 24px", display: "flex", alignItems: "center", gap: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }}>
        <div>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 16, letterSpacing: 0.3 }}>Highview Travel</div>
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: 1 }}>Booking Summary PDF Generator</div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left panel — JSON input */}
        <div style={{ width: 420, minWidth: 320, display: "flex", flexDirection: "column", borderRight: "1px solid #dde2e8", background: "#fff", padding: "20px 20px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: "#1a2533" }}>Paste Form JSON</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleLoadSample}
                style={{ fontSize: 11, padding: "4px 10px", background: "#eef4f7", border: "1px solid #c5d8e0", borderRadius: 5, cursor: "pointer", color: "#126181", fontWeight: 600 }}
              >
                Load Sample
              </button>
              <button
                onClick={handleClear}
                style={{ fontSize: 11, padding: "4px 10px", background: "#f6f6f6", border: "1px solid #ddd", borderRadius: 5, cursor: "pointer", color: "#666" }}
              >
                Clear
              </button>
            </div>
          </div>

          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder={`Paste your JSON here, e.g.:\n{\n  "info": "{...}"\n}\n\nor a flat object directly.`}
            spellCheck={false}
            style={{
              flex: 1,
              resize: "none",
              fontFamily: "'Fira Mono', 'Consolas', monospace",
              fontSize: 12,
              lineHeight: 1.55,
              padding: "12px 14px",
              border: "1.5px solid #d0d7de",
              borderRadius: 8,
              outline: "none",
              color: "#1a2533",
              background: "#fafbfc",
              overflowY: "auto",
              transition: "border-color 0.15s",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "#126181"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "#d0d7de"; }}
          />

          {error && (
            <div style={{ marginTop: 10, padding: "10px 12px", background: "#fff3f3", border: "1px solid #f5c6c6", borderRadius: 7, fontSize: 12, color: "#b91c1c" }}>
              <strong>Error:</strong> {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={loading || !jsonInput.trim()}
            style={{
              marginTop: 14,
              padding: "11px 0",
              background: loading || !jsonInput.trim() ? "#a0b8c4" : "#126181",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 14,
              cursor: loading || !jsonInput.trim() ? "not-allowed" : "pointer",
              letterSpacing: 0.3,
              transition: "background 0.15s",
              boxShadow: loading || !jsonInput.trim() ? "none" : "0 2px 6px rgba(18,97,129,0.3)",
            }}
          >
            {loading ? "Generating…" : "Generate PDF"}
          </button>
        </div>

        {/* Right panel — PDF viewer */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: pdfUrl ? "flex-start" : "center", background: "#eaecef", overflow: "hidden" }}>
          {pdfUrl ? (
            <>
              <div style={{ width: "100%", padding: "10px 16px", background: "#fff", borderBottom: "1px solid #dde2e8", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "#555", fontWeight: 500 }}>PDF Preview</span>
                <a
                  href={pdfUrl}
                  download="booking_summary.pdf"
                  style={{ fontSize: 12, color: "#126181", textDecoration: "none", fontWeight: 600, padding: "4px 12px", border: "1px solid #126181", borderRadius: 5 }}
                >
                  ↓ Download PDF
                </a>
              </div>
              <iframe
                src={pdfUrl}
                style={{ flex: 1, width: "100%", border: "none" }}
                title="Booking Summary PDF"
              />
            </>
          ) : (
            <div style={{ textAlign: "center", color: "#8a9bb0" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#667082", marginBottom: 6 }}>No PDF generated yet</div>
              <div style={{ fontSize: 13, maxWidth: 280 }}>
                Paste your form JSON on the left and click <strong>Generate PDF</strong>.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
