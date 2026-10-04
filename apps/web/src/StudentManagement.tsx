import { useCallback, useEffect, useState } from 'react';

type Student = {
  id: string;
  studentId: string;
  name: string;
  yearLevel: string;
  qrCredential: { id: string; status: string; createdAt: string; revokedAt: string | null } | null;
};
type PreviewRow = {
  rowNumber: number;
  studentId: string;
  name: string;
  yearLevel: string;
  errors: Array<{ field: string; code: string; message: string }>;
};
type Preview = {
  id: string;
  filename: string;
  headers: string[];
  rows: PreviewRow[];
  fileErrors: Array<{ field: string; code: string; message: string }>;
  canImport: boolean;
};

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!response.ok) throw new Error(body.error?.message ?? 'Request failed.');
  return body;
}

export default function StudentManagement({ onError }: { onError: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [lastToken, setLastToken] = useState<{ studentId: string; token: string } | null>(null);

  const search = useCallback(
    () =>
      api<{ students: Student[] }>(`/api/students?query=${encodeURIComponent(query)}`)
        .then((body) => setStudents(body.students))
        .catch((cause: Error) => onError(cause.message)),
    [onError, query],
  );
  useEffect(() => {
    search();
  }, [search]);

  const previewUpload = () => {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    fetch('/api/masterlists/preview', { method: 'POST', body: form, credentials: 'include' })
      .then(async (response) => {
        const body = (await response.json()) as { preview?: Preview; error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? 'Preview failed.');
        return body.preview!;
      })
      .then((nextPreview) => {
        setPreview(nextPreview);
        setMessage('Review the row-level validation results before importing.');
      })
      .catch((cause: Error) => onError(cause.message))
      .finally(() => setBusy(false));
  };

  const importPreview = () => {
    if (!preview?.canImport) return;
    setBusy(true);
    api<{ importedCount: number }>('/api/masterlists/import', {
      method: 'POST',
      body: JSON.stringify({ previewId: preview.id }),
    })
      .then((body) => {
        setMessage(`${body.importedCount} student record(s) imported.`);
        setPreview(null);
        setFile(null);
        return search();
      })
      .catch((cause: Error) => onError(cause.message))
      .finally(() => setBusy(false));
  };

  const qrAction = (studentId: string, action: 'qr' | 'regenerate' | 'revoke') => {
    const url =
      action === 'qr'
        ? `/api/students/${encodeURIComponent(studentId)}/qr`
        : `/api/students/${encodeURIComponent(studentId)}/qr/${action}`;
    api<{ token?: string }>(url, { method: 'POST' })
      .then((body) => {
        if (body.token) setLastToken({ studentId, token: body.token });
        return search();
      })
      .catch((cause: Error) => onError(cause.message));
  };

  return (
    <section
      aria-labelledby="student-management-heading"
      className="mx-auto mt-6 max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">
            Masterlist
          </p>
          <h2 id="student-management-heading" className="mt-1 text-xl font-bold">
            Students and QR credentials
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Upload a CSV/XLSX, review every row, then commit the official student records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="masterlist-file">
            Masterlist CSV or XLSX
          </label>
          <input
            id="masterlist-file"
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="min-h-11 max-w-[240px] rounded-lg border border-slate-300 px-2 py-2 text-sm"
          />
          <button
            onClick={previewUpload}
            disabled={!file || busy}
            className="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Preview upload
          </button>
        </div>
      </div>
      {message && (
        <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>
      )}
      {preview && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Preview: {preview.filename}</h3>
              <p className="text-sm text-slate-600">
                {preview.rows.length} data row(s) · {preview.fileErrors.length} file error(s)
              </p>
            </div>
            <button
              onClick={importPreview}
              disabled={!preview.canImport || busy}
              className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              Import valid rows
            </button>
          </div>
          {preview.fileErrors.map((error) => (
            <p
              key={`${error.code}-${error.message}`}
              role="alert"
              className="mt-3 text-sm text-rose-700"
            >
              File: {error.message}
            </p>
          ))}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="p-2">Row</th>
                  <th className="p-2">Student ID</th>
                  <th className="p-2">Name</th>
                  <th className="p-2">Year</th>
                  <th className="p-2">Validation</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber} className="border-b border-slate-200 align-top">
                    <td className="p-2">{row.rowNumber}</td>
                    <td className="p-2">{row.studentId || '—'}</td>
                    <td className="p-2">{row.name || '—'}</td>
                    <td className="p-2">{row.yearLevel || '—'}</td>
                    <td className="p-2">
                      {row.errors.length ? (
                        <ul className="space-y-1 text-rose-700">
                          {row.errors.map((error) => (
                            <li key={`${row.rowNumber}-${error.code}`}>{error.message}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-emerald-700">Valid</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="mt-8 border-t border-slate-200 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Student records</h3>
            <p className="text-sm text-slate-500">Search by official ID, name, or year level.</p>
          </div>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="student-search">
              Search students
            </label>
            <input
              id="student-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') search();
              }}
              placeholder="Search students"
              className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm"
            />
            <button
              onClick={search}
              className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50"
            >
              Search
            </button>
          </div>
        </div>
        {lastToken && (
          <p className="mt-4 break-all rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">
            <span className="font-semibold">New opaque QR token for {lastToken.studentId}:</span>{' '}
            {lastToken.token}
            <span className="mt-1 block text-xs">
              Store or encode this token securely; it contains no student information.
            </span>
          </p>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {students.map((student) => (
            <article key={student.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold">{student.name}</h4>
                  <p className="text-sm text-slate-600">
                    {student.studentId} · Year {student.yearLevel}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${student.qrCredential?.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}
                >
                  {student.qrCredential?.status ?? 'NO QR'}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => qrAction(student.studentId, 'qr')}
                  className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50"
                >
                  Show QR token
                </button>
                <button
                  onClick={() => qrAction(student.studentId, 'regenerate')}
                  className="min-h-11 rounded-lg border border-amber-300 px-3 text-sm font-semibold text-amber-800 hover:bg-amber-50"
                >
                  Regenerate
                </button>
                {student.qrCredential?.status === 'ACTIVE' && (
                  <button
                    onClick={() => qrAction(student.studentId, 'revoke')}
                    className="min-h-11 rounded-lg border border-rose-300 px-3 text-sm font-semibold text-rose-800 hover:bg-rose-50"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </article>
          ))}
          {students.length === 0 && (
            <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No students found.</p>
          )}
        </div>
      </div>
    </section>
  );
}
