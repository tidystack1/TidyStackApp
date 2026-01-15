"use client";

import { useState } from "react";

type TestPdfResponse = {
  recordId?: string;
  attachmentCount?: number;
  pdfCount?: number;
  pdfFiles?: number;
  imageFiles?: number;
  message?: string;
  pdfBase64?: string;
  facility?: string | null;
  error?: string;
};

export default function PlaygroundPage() {
  const [recordId, setRecordId] = useState("7219537000000606001");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestPdfResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const testPdfFetch = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setPdfUrl(null);
    setPdfBase64(null);
    setEmailSent(false);

    try {
      const response = await fetch("/api/test-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: recordId, formType: "mileage-reimbursement" }),
      });

      const data: TestPdfResponse = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to process request");
        setResult(data);
        return;
      }

      setResult(data);

      // If we got a PDF, create a blob URL to display it
      if (data.pdfBase64) {
        setPdfBase64(data.pdfBase64);
        const binaryString = atob(data.pdfBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = () => {
    if (pdfUrl) {
      const a = document.createElement("a");
      a.href = pdfUrl;
      a.download = `combined-${recordId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const sendEmailTest = async () => {
    if (!pdfBase64) return;

    setSending(true);
    setError(null);

    try {
      const response = await fetch("/api/send-test-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pdfBase64: pdfBase64,
          recordId: recordId,
          facility: result?.facility ?? null,
        }),
      });

      const data: { error?: string } = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to send email");
        return;
      }

      setEmailSent(true);
      setTimeout(() => setEmailSent(false), 5000); // Hide success message after 5 seconds
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            Mileage Reimbursement Form
          </h1>
          <p className="text-gray-600 mb-6">
            Test fetching and rendering the mileage reimbursement cover page
          </p>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="recordId"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Zoho CRM Record ID
              </label>
              <input
                id="recordId"
                type="text"
                value={recordId}
                onChange={(e) => setRecordId(e.target.value)}
                placeholder="e.g., 7219537000000606001"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <button
              onClick={testPdfFetch}
              disabled={loading || !recordId}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200"
            >
              {loading ? "⏳ Processing..." : "🚀 Test PDF Fetch & Combine"}
            </button>
          </div>

          {error && (
            <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <h3 className="text-red-800 font-semibold mb-2">❌ Error</h3>
              <p className="text-red-700">{error}</p>
            </div>
          )}

          {result && !error && (
            <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="text-green-800 font-semibold mb-2">✅ Success</h3>
              <div className="text-sm text-green-700 space-y-1">
                <p>
                  📋 Record ID: <strong>{result.recordId}</strong>
                </p>
                {result.message && <p className="mt-2">{result.message}</p>}
              </div>
            </div>
          )}
        </div>

        {pdfUrl && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-gray-800">
                📄 Combined PDF Preview
              </h2>
              <div className="flex gap-3">
                <button
                  onClick={sendEmailTest}
                  disabled={sending}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200"
                >
                  {sending ? "📤 Sending..." : "📧 Send Email"}
                </button>
                <button
                  onClick={downloadPdf}
                  className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200"
                >
                  💾 Download PDF
                </button>
              </div>
            </div>

            {emailSent && (
              <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-green-800 font-semibold">
                  ✅ Email sent successfully to mspitzer@tidystack.com!
                </p>
              </div>
            )}
            <div className="border-2 border-gray-300 rounded-lg overflow-hidden">
              <iframe
                src={pdfUrl}
                className="w-full h-[800px]"
                title="Combined PDF Preview"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
