import { useCallback, useEffect, useMemo, useState } from 'react';

type EventOption = {
  id: string;
  name: string;
  status: string;
  days: Array<{
    id: string;
    localDate: string;
    sequence: number;
    sessions: Array<{ id: string; name: string; sessionType: string }>;
  }>;
};

type ReportRow = {
  attendanceId: string;
  eventId: string;
  eventName: string;
  localDate: string;
  sessionId: string;
  sessionName: string;
  sessionType: string;
  studentNumber: string;
  studentName: string;
  yearLevel: string;
  course: string | null;
  section: string | null;
  scannedAtDevice: string;
  receivedAtServer: string;
  clockSkewSeconds: number;
  late: boolean;
};

type Report = {
  rows: ReportRow[];
  summary: {
    attendanceCount: number;
    studentCount: number;
    eventCount: number;
    sessionCount: number;
    byYearLevel: Record<string, number>;
    byCourse: Record<string, number>;
    bySection: Record<string, number>;
  };
};

type Dashboard = {
  metrics: { events: number; activeEvents: number; sessions: number; attendance: number };
  events: Array<{
    id: string;
    name: string;
    status: string;
    days: number;
    sessions: number;
    attendance: number;
  }>;
  recent: ReportRow[];
};

type Student = {
  id: string;
  studentId: string;
  name: string;
  yearLevel: string;
  course: string | null;
  section: string | null;
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!response.ok) throw new Error(body.error?.message ?? 'Request failed.');
  return body;
}

function queryString(filters: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

export default function CoordinatorDashboard({ events }: { events: EventOption[] }) {
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [report, setReport] = useState<Report>();
  const [students, setStudents] = useState<Student[]>([]);
  const [tab, setTab] = useState<'overview' | 'attendance' | 'students'>('overview');
  const [eventId, setEventId] = useState('');
  const [dayId, setDayId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [query, setQuery] = useState('');
  const [yearLevel, setYearLevel] = useState('');
  const [course, setCourse] = useState('');
  const [section, setSection] = useState('');
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [studentLoading, setStudentLoading] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);

  const filters = useMemo(
    () => ({ eventId, dayId, sessionId, query, yearLevel, course, section }),
    [course, dayId, eventId, query, section, sessionId, yearLevel],
  );
  const selectedEvent = events.find((event) => event.id === eventId);
  const selectedDay = selectedEvent?.days.find((day) => day.id === dayId);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      setDashboard(await request<Dashboard>('/api/coordinator/dashboard'));
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReport = useCallback(async () => {
    setReportLoading(true);
    try {
      setReport(await request<Report>(`/api/reports/attendance${queryString(filters)}`));
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setReportLoading(false);
    }
  }, [filters]);

  const loadStudents = useCallback(async () => {
    setStudentLoading(true);
    try {
      const result = await request<{ students: Student[] }>(
        `/api/students${queryString({ query, yearLevel, course, section })}`,
      );
      setStudents(result.students);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setStudentLoading(false);
    }
  }, [course, query, section, yearLevel]);

  useEffect(() => {
    void loadDashboard();
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    return () => {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
    };
  }, [loadDashboard]);

  useEffect(() => {
    if (tab === 'attendance') void loadReport();
    if (tab === 'students') void loadStudents();
  }, [loadReport, loadStudents, tab]);

  const clearFilters = () => {
    setEventId('');
    setDayId('');
    setSessionId('');
    setQuery('');
    setYearLevel('');
    setCourse('');
    setSection('');
  };

  const download = async (format: 'csv' | 'xlsx') => {
    try {
      const response = await fetch(
        `/api/reports/attendance/export${queryString({ ...filters, format })}`,
        {
          credentials: 'include',
        },
      );
      if (!response.ok) throw new Error('Report export failed.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `attendance-report.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <section
      className="mx-auto max-w-6xl px-4 py-6 sm:px-6 print:px-0"
      aria-labelledby="dashboard-title"
    >
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">
            Coordinator workspace
          </p>
          <h2
            id="dashboard-title"
            className="mt-1 text-2xl font-bold tracking-tight text-slate-950"
          >
            Attendance overview
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Monitor event coverage, investigate attendance, and export an auditable report.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-2 text-xs font-bold ${online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}
            aria-live="polite"
          >
            {online ? 'Online' : 'Offline · cached view'}
          </span>
          <button
            onClick={() => void loadDashboard()}
            className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50 print:hidden"
          >
            Refresh
          </button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          {error}
        </div>
      )}
      {!online && (
        <div
          role="status"
          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          You are offline. Existing data remains visible; reports and exports may be stale or
          unavailable.
        </div>
      )}
      <nav
        className="mt-5 flex gap-2 overflow-x-auto border-b border-slate-200 print:hidden"
        aria-label="Coordinator sections"
      >
        {(['overview', 'attendance', 'students'] as const).map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold capitalize ${tab === item ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
            aria-current={tab === item ? 'page' : undefined}
          >
            {item}
          </button>
        ))}
      </nav>
      {loading && !dashboard ? <LoadingState label="Loading dashboard" /> : null}
      {tab === 'overview' && dashboard && (
        <Overview
          dashboard={dashboard}
          onEvent={(id) => {
            setEventId(id);
            setTab('attendance');
          }}
        />
      )}
      {tab !== 'overview' && (
        <>
          <FilterBar
            events={events}
            eventId={eventId}
            dayId={dayId}
            sessionId={sessionId}
            selectedEvent={selectedEvent}
            selectedDay={selectedDay}
            query={query}
            yearLevel={yearLevel}
            course={course}
            section={section}
            setEventId={(value) => {
              setEventId(value);
              setDayId('');
              setSessionId('');
            }}
            setDayId={(value) => {
              setDayId(value);
              setSessionId('');
            }}
            setSessionId={setSessionId}
            setQuery={setQuery}
            setYearLevel={setYearLevel}
            setCourse={setCourse}
            setSection={setSection}
            clearFilters={clearFilters}
          />
          {tab === 'attendance' && (
            <AttendanceReport report={report} loading={reportLoading} onExport={download} />
          )}
          {tab === 'students' && <StudentReport students={students} loading={studentLoading} />}
        </>
      )}
    </section>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600"
    >
      <span className="inline-block animate-pulse">{label}…</span>
    </div>
  );
}

function Overview({ dashboard, onEvent }: { dashboard: Dashboard; onEvent: (id: string) => void }) {
  const cards = [
    ['Events', dashboard.metrics.events, 'All accessible events'],
    ['Active now', dashboard.metrics.activeEvents, 'Events currently active'],
    ['Sessions', dashboard.metrics.sessions, 'Configured attendance windows'],
    ['Attendance', dashboard.metrics.attendance, 'Accepted server records'],
  ];
  return (
    <div className="mt-6 space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, helper]) => (
          <article
            key={label}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm font-semibold text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{helper}</p>
          </article>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          aria-labelledby="event-monitoring-heading"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 id="event-monitoring-heading" className="text-lg font-bold text-slate-950">
                Event monitoring
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Select an event to inspect attendance by session.
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <caption className="sr-only">Accessible events and attendance counts</caption>
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-3">Event</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Days</th>
                  <th className="px-3 py-3">Sessions</th>
                  <th className="px-3 py-3 text-right">Attendance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dashboard.events.map((event) => (
                  <tr key={event.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3">
                      <button
                        onClick={() => onEvent(event.id)}
                        className="font-semibold text-indigo-700 underline-offset-2 hover:underline"
                      >
                        {event.name}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        {event.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">{event.days}</td>
                    <td className="px-3 py-3">{event.sessions}</td>
                    <td className="px-3 py-3 text-right font-semibold">{event.attendance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dashboard.events.length === 0 && (
            <p className="mt-4 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
              No events are available for this account.
            </p>
          )}
        </section>
        <section
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          aria-labelledby="recent-attendance-heading"
        >
          <h3 id="recent-attendance-heading" className="text-lg font-bold text-slate-950">
            Recent attendance
          </h3>
          <div className="mt-4 space-y-3">
            {dashboard.recent.map((row) => (
              <div
                key={row.attendanceId}
                className="rounded-xl border border-slate-100 bg-slate-50 p-3"
              >
                <p className="font-semibold text-slate-900">{row.studentName}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {row.eventName} · {row.sessionName}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(row.receivedAtServer).toLocaleString()}
                </p>
              </div>
            ))}
            {dashboard.recent.length === 0 && (
              <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                No accepted attendance yet.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function FilterBar(props: {
  events: EventOption[];
  eventId: string;
  dayId: string;
  sessionId: string;
  selectedEvent?: EventOption;
  selectedDay?: EventOption['days'][number];
  query: string;
  yearLevel: string;
  course: string;
  section: string;
  setEventId: (value: string) => void;
  setDayId: (value: string) => void;
  setSessionId: (value: string) => void;
  setQuery: (value: string) => void;
  setYearLevel: (value: string) => void;
  setCourse: (value: string) => void;
  setSection: (value: string) => void;
  clearFilters: () => void;
}) {
  return (
    <section
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:hidden"
      aria-labelledby="filter-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="filter-heading" className="font-bold text-slate-950">
            Search and filters
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Filters apply to the server-generated report.
          </p>
        </div>
        <button
          onClick={props.clearFilters}
          className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50"
        >
          Clear filters
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-semibold text-slate-700">
          Search
          <input
            value={props.query}
            onChange={(event) => props.setQuery(event.target.value)}
            placeholder="Name or student ID"
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 font-normal"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Event
          <select
            value={props.eventId}
            onChange={(event) => props.setEventId(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal"
          >
            <option value="">All events</option>
            {props.events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Day
          <select
            value={props.dayId}
            onChange={(event) => props.setDayId(event.target.value)}
            disabled={!props.selectedEvent}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal"
          >
            <option value="">All days</option>
            {props.selectedEvent?.days.map((day) => (
              <option key={day.id} value={day.id}>
                Day {day.sequence} · {day.localDate}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Session
          <select
            value={props.sessionId}
            onChange={(event) => props.setSessionId(event.target.value)}
            disabled={!props.selectedDay}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal"
          >
            <option value="">All sessions</option>
            {props.selectedDay?.sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Year level
          <input
            value={props.yearLevel}
            onChange={(event) => props.setYearLevel(event.target.value)}
            placeholder="e.g. 7"
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 font-normal"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Course
          <input
            value={props.course}
            onChange={(event) => props.setCourse(event.target.value)}
            placeholder="Course or program"
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 font-normal"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Section
          <input
            value={props.section}
            onChange={(event) => props.setSection(event.target.value)}
            placeholder="Section"
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 font-normal"
          />
        </label>
      </div>
    </section>
  );
}

function AttendanceReport({
  report,
  loading,
  onExport,
}: {
  report?: Report;
  loading: boolean;
  onExport: (format: 'csv' | 'xlsx') => void;
}) {
  if (loading && !report) return <LoadingState label="Loading attendance report" />;
  if (!report)
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">
        No report data is available.
      </div>
    );
  return (
    <section
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-labelledby="attendance-report-heading"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between print:hidden">
        <div>
          <h3 id="attendance-report-heading" className="text-lg font-bold text-slate-950">
            Attendance report
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {report.summary.attendanceCount} accepted records · {report.summary.studentCount}{' '}
            students
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onExport('csv')}
            className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50"
          >
            Export CSV
          </button>
          <button
            onClick={() => onExport('xlsx')}
            className="min-h-10 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Export XLSX
          </button>
          <button
            onClick={() => window.print()}
            className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50"
          >
            Print
          </button>
        </div>
      </div>
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Attendance report</h1>
        <p className="mt-1 text-sm">Generated {new Date().toLocaleString()}</p>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <caption className="sr-only">Filtered attendance records</caption>
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3">Student</th>
              <th className="px-3 py-3">Event / session</th>
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Year</th>
              <th className="px-3 py-3">Course</th>
              <th className="px-3 py-3">Section</th>
              <th className="px-3 py-3">Received</th>
              <th className="px-3 py-3">Skew</th>
              <th className="px-3 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {report.rows.map((row) => (
              <tr key={row.attendanceId}>
                <td className="px-3 py-3">
                  <span className="font-semibold">{row.studentName}</span>
                  <span className="block text-xs text-slate-500">{row.studentNumber}</span>
                </td>
                <td className="px-3 py-3">
                  {row.eventName}
                  <span className="block text-xs text-slate-500">
                    {row.sessionName} · {row.sessionType}
                  </span>
                </td>
                <td className="px-3 py-3">{row.localDate}</td>
                <td className="px-3 py-3">{row.yearLevel}</td>
                <td className="px-3 py-3">{row.course || '—'}</td>
                <td className="px-3 py-3">{row.section || '—'}</td>
                <td className="px-3 py-3 text-xs">
                  {new Date(row.receivedAtServer).toLocaleString()}
                </td>
                <td className="px-3 py-3 text-xs">{row.clockSkewSeconds}s</td>
                <td className="px-3 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${row.late ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}
                  >
                    {row.late ? 'Late' : 'On time'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.rows.length === 0 && (
        <p className="mt-4 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
          No attendance matches the current filters.
        </p>
      )}
    </section>
  );
}

function StudentReport({ students, loading }: { students: Student[]; loading: boolean }) {
  if (loading && !students.length) return <LoadingState label="Loading students" />;
  return (
    <section
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-labelledby="student-report-heading"
    >
      <h3 id="student-report-heading" className="text-lg font-bold text-slate-950">
        Student records
      </h3>
      <p className="mt-1 text-sm text-slate-500">Search the official masterlist source.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <caption className="sr-only">Student records</caption>
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3">Student ID</th>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Year</th>
              <th className="px-3 py-3">Course</th>
              <th className="px-3 py-3">Section</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {students.map((student) => (
              <tr key={student.id}>
                <td className="px-3 py-3 font-semibold">{student.studentId}</td>
                <td className="px-3 py-3">{student.name}</td>
                <td className="px-3 py-3">{student.yearLevel}</td>
                <td className="px-3 py-3">{student.course || '—'}</td>
                <td className="px-3 py-3">{student.section || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {students.length === 0 && (
        <p className="mt-4 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
          No students match the current filters.
        </p>
      )}
    </section>
  );
}
