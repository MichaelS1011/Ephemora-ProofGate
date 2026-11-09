import { useEffect, useMemo, useRef, useState } from 'react';

const navItems = [
  ['Overview', 'grid'],
  ['Executions', 'play'],
  ['Receipts', 'receipt'],
  ['Settlements', 'wallet'],
  ['Security', 'shield'],
  ['Settings', 'settings'],
];

const sampleJobs = [
  { id: 'PG-048', name: 'Transform research bundle', agent: 'Atlas agent', state: 'Verified · awaiting settlement', tone: 'verified', amount: '0.80', time: '4 min ago', receipt: 'demo:pg048:9f12a7c1' },
  { id: 'PG-047', name: 'Summarize public filings', agent: 'Northstar agent', state: 'Blocked by policy', tone: 'blocked', amount: '0.35', time: '18 min ago', receipt: 'demo:pg047:72ab40d9' },
  { id: 'PG-046', name: 'Normalize open data', agent: 'Atlas agent', state: 'Awaiting review', tone: 'pending', amount: '0.20', time: '1 hr ago', receipt: 'demo:pg046:10c83eaa' },
];

async function apiRequest(path, options = {}) {
  const { headers, ...requestOptions } = options;
  const response = await fetch(`/api${path}`, {
    ...requestOptions,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Local API returned ${response.status}.`);
  return data;
}

function relativeTime(value) {
  if (!value) return 'just now';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

function mapApiJob(job) {
  const tone = job.state === 'Verified' ? 'verified' : job.state === 'Blocked' ? 'blocked' : 'pending';
  const label = {
    Ready: 'Ready to run',
    Executing: 'Running in Cell',
    Verified: 'Verified · unpaid',
    Blocked: 'Blocked by verifier',
  }[job.state] || job.state;
  return {
    id: job.id,
    name: job.name,
    agent: 'Local workload',
    state: label,
    tone,
    amount: job.reward,
    time: relativeTime(job.createdAt),
    receipt: job.reportId || 'Not issued',
    beneficiary: job.beneficiary,
    language: job.language,
    languageLabel: job.languageLabel,
    compiler: job.compiler,
    abi: job.abi,
    runtimeProfile: job.runtimeProfile,
    input: job.input,
    output: job.output,
    policy: job.policy,
    policyDigest: job.policyDigest,
    reportId: job.reportId,
    runId: job.runId,
    error: job.error,
    apiState: job.state,
    live: true,
  };
}

const pageCopy = {
  Overview: ['Execution overview', 'Review the run, its evidence, and the payment state in one place.'],
  Executions: ['Executions', 'Inspect each protected workload and its current result.'],
  Receipts: ['Receipts', 'Review signed evidence and the checks ProofGate applies.'],
  Settlements: ['Settlements', 'Track proposed rewards separately from confirmed payments.'],
  Security: ['Security', 'See how execution, verification, and payment authority stay separate.'],
  Settings: ['Settings', 'Choose an appearance and inspect connected runtimes.'],
};

function runtimeLabel(job) {
  const abi = job?.abi === 'component'
    ? 'WASI 0.2 component'
    : job?.abi === 'preview1' ? 'WASI Preview1' : job?.abi;
  const profiles = [abi, job?.runtimeProfile].filter(Boolean);
  return [...new Set(profiles)].join(' · ') || job?.detail || 'Runtime profile not reported';
}

function availableLanguageCatalog(connection) {
  const catalog = new Map();
  for (const language of [
    ...(connection.runnableLanguages || []),
    ...(connection.interpreterLanguages || []),
  ]) {
    const current = catalog.get(language.id) || {};
    catalog.set(language.id, {
      ...current,
      ...language,
      abi: language.abi || current.abi,
      runtimeProfile: language.runtimeProfile || current.runtimeProfile,
      detail: language.detail || current.detail,
      available: language.available === true || current.available === true,
    });
  }
  return [...catalog.values()].filter((language) => language.available);
}

function Icon({ name, size = 18 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></>,
    play: <><rect x="3.5" y="4" width="17" height="16" rx="4"/><path d="m10 8.5 5 3.5-5 3.5z" fill="currentColor" stroke="none"/></>,
    receipt: <><path d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v15l-3-1.7-2.5 1.7-2-1.7-2.5 1.7-2.5-1.7L5 20V5a1.5 1.5 0 0 1 1-1.5Z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h3"/></>,
    wallet: <><rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M4 8h15M16 14h.01"/><path d="M18.5 11.5h2v5h-2a2.5 2.5 0 0 1 0-5Z"/></>,
    shield: <><path d="M12 3 19 6v5.2c0 4.3-2.9 7.8-7 9.8-4.1-2-7-5.5-7-9.8V6z"/><path d="m9 12 2 2 4-4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.8 1.8 0 1 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 1 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 1 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 1 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 1 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z" transform="translate(1.1 1.1) scale(.91)"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.5 4.5"/></>,
    chevron: <><path d="m7 10 5 5 5-5"/></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></>,
    external: <><path d="M13 5h6v6M19 5l-9 9"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    alert: <><path d="M10.3 4.3 2.8 17.5A1.7 1.7 0 0 0 4.3 20h15.4a1.7 1.7 0 0 0 1.5-2.5L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 16.5h.01"/></>,
    clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    moon: <><path d="M20.5 15.3A8.5 8.5 0 0 1 8.7 3.5 8.5 8.5 0 1 0 20.5 15.3Z"/></>,
    download: <><path d="M12 3.5v11m0 0 4-4m-4 4-4-4"/><path d="M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    lock: <><rect x="4.5" y="10" width="15" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z"/></>,
  };
  return <svg {...common}>{paths[name] || paths.grid}</svg>;
}

function Mark() {
  return <svg className="brand-mark" viewBox="0 0 44 44" role="img" aria-label="Ephemora ProofGate">
    <defs><linearGradient id="markTone" x1="4" y1="4" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop stopColor="#7279ee"/><stop offset="1" stopColor="#3f49c8"/></linearGradient></defs>
    <rect x="1" y="1" width="42" height="42" rx="14" fill="url(#markTone)"/>
    <path d="M15 11.5c-3.7 2.2-5.3 5.3-5.3 9.2 0 4 2.2 7.5 6 10.8 2.3 2 4.2 2.9 6.3 3.5V15.2c-2.2-2.1-4.4-3.4-7-3.7Z" fill="none" stroke="white" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M29 11.5c3.7 2.2 5.3 5.3 5.3 9.2 0 4-2.2 7.5-6 10.8-2.3 2-4.2 2.9-6.3 3.5V15.2c2.2-2.1 4.4-3.4 7-3.7Z" fill="none" stroke="white" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}

function Badge({ tone = 'neutral', children, icon }) {
  return <span className={`badge badge-${tone}`}>{icon && <Icon name={icon} size={13} />}{children}</span>;
}

function StatusGlyph({ tone }) {
  return <span className={`status-glyph glyph-${tone}`} aria-hidden="true">{tone === 'verified' ? <Icon name="check" size={12} /> : tone === 'blocked' ? <Icon name="alert" size={12} /> : <Icon name="clock" size={12} />}</span>;
}

function StageTrack({ state = 'verified' }) {
  const stages = ['Submitted', 'Sandboxed', 'Signed', 'Verified', 'Settled'];
  const active = state === 'settled' ? 4 : state === 'verified' ? 3 : state === 'blocked' ? 1 : state === 'running' ? 1 : 0;
  return <ol className={`stage-track stage-${state}`} aria-label="Execution stages">
    {stages.map((stage, i) => <li key={stage} className={i < active ? 'stage-done' : i === active && state === 'blocked' ? 'stage-failed' : i === active ? 'stage-current' : ''}>
      <span className="stage-dot">{i < active ? <Icon name="check" size={12} /> : i === active && state === 'blocked' ? <Icon name="alert" size={12} /> : i + 1}</span>
      <span className="stage-name">{stage}</span>
    </li>)}
  </ol>;
}

function App() {
  const [page, setPage] = useState('Overview');
  const [theme, setTheme] = useState(() => localStorage.getItem('proofgate-theme') || 'light');
  const newJobReturnFocusRef = useRef(null);
  const [jobs, setJobs] = useState(sampleJobs);
  const [selectedId, setSelectedId] = useState('PG-048');
  const [connection, setConnection] = useState({ apiReachable: false, connectedOnce: false, checking: true });
  const [receiptBundles, setReceiptBundles] = useState({});
  const [nearStatus, setNearStatus] = useState(null);
  const [checkingNear, setCheckingNear] = useState(false);
  const [busyJobId, setBusyJobId] = useState('');
  const [showNewJob, setShowNewJob] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('all');
  const selectedJob = jobs.find((job) => job.id === selectedId) || jobs[0] || null;
  const apiOnline = connection.apiReachable === true;
  const recordsAreLocal = connection.connectedOnce === true;
  const connectionLost = recordsAreLocal && !apiOnline;
  const cellReady = connection.connected === true;
  const availableLanguages = availableLanguageCatalog(connection);
  const languageSummary = [...new Map(availableLanguages.map((language) => [
    language.id,
    language.label || language.id,
  ])).values()].join(', ');
  const nearPillLabel = nearStatus?.connected
    ? 'Testnet · read-only'
    : checkingNear ? 'Checking' : nearStatus ? 'Unavailable' : 'Not checked';
  const copy = pageCopy[page] || ['Execution detail', 'Evidence and settlement remain distinct decisions.'];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('proofgate-theme', theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    Promise.all([apiRequest('/health'), apiRequest('/jobs')])
      .then(([health, data]) => {
        if (!active) return;
        const liveJobs = (data.jobs || []).map(mapApiJob);
        setConnection({ ...health, apiReachable: true, connectedOnce: true, checking: false });
        setJobs(liveJobs);
        setSelectedId(liveJobs[0]?.id || '');
      })
      .catch(() => {
        if (!active) return;
        setConnection({ apiReachable: false, connectedOnce: false, checking: false });
        setJobs(sampleJobs);
        setSelectedId('PG-048');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filteredJobs = useMemo(() => jobs.filter((job) => {
    const query = search.trim().toLowerCase();
    const matchesQuery = !query || `${job.id} ${job.name} ${job.agent} ${job.state}`.toLowerCase().includes(query);
    const matchesFilter = filter === 'all' || job.tone === filter.toLowerCase();
    return matchesQuery && matchesFilter;
  }), [jobs, search, filter]);

  function openJob(job) {
    setSelectedId(job.id);
    setPage(`Execution ${job.id}`);
  }

  async function refreshBackend(showNotice = false) {
    try {
      const [health, data] = await Promise.all([apiRequest('/health'), apiRequest('/jobs')]);
      const liveJobs = (data.jobs || []).map(mapApiJob);
      setConnection({ ...health, apiReachable: true, connectedOnce: true, checking: false });
      setJobs(liveJobs);
      setSelectedId((current) => liveJobs.some((job) => job.id === current) ? current : (liveJobs[0]?.id || ''));
      if (showNotice) setNotice('Local job records refreshed.');
    } catch (error) {
      setConnection((current) => ({ ...current, apiReachable: false, connected: false, checking: false }));
      if (showNotice) setNotice('Local ProofGate API is unavailable: ' + error.message);
    }
  }

  async function checkNearStatus() {
    setCheckingNear(true);
    try {
      const status = await apiRequest('/near/status');
      setNearStatus(status);
      setNotice(`NEAR Testnet RPC is reachable at block ${status.latestBlockHeight}. Read-only check only.`);
    } catch (error) {
      setNearStatus({ connected: false, error: error.message });
      setNotice('NEAR Testnet RPC check failed: ' + error.message);
    } finally {
      setCheckingNear(false);
    }
  }

  async function fetchReceipt(job) {
    if (!job?.live) return null;
    if (receiptBundles[job.id]) return receiptBundles[job.id];
    const bundle = await apiRequest('/jobs/' + encodeURIComponent(job.id) + '/receipt');
    setReceiptBundles((current) => ({ ...current, [job.id]: bundle }));
    return bundle;
  }

  async function copyReceipt() {
    if (selectedJob?.live && !selectedJob.reportId) {
      setNotice('This job has no accepted receipt yet. Run it in Cell first.');
      return;
    }
    if (selectedJob?.live && !apiOnline && !receiptBundles[selectedJob.id]) {
      setNotice('Reconnect the local API to retrieve this signed receipt.');
      return;
    }
    try {
      const bundle = await fetchReceipt(selectedJob);
      const value = bundle ? JSON.stringify(bundle.receipt, null, 2) : (selectedJob?.receipt || 'demo:receipt');
      await navigator.clipboard.writeText(value);
      setNotice(selectedJob?.live ? 'Signed ProofGate receipt copied.' : 'Sample receipt reference copied.');
    } catch {
      setNotice('Receipt unavailable: clipboard access or the local API is unavailable.');
    }
  }

  async function downloadReceipt() {
    if (!selectedJob) return;
    if (selectedJob.live && !selectedJob.reportId) {
      setNotice('This job has no accepted receipt yet. Run it in Cell first.');
      return;
    }
    if (selectedJob.live && !apiOnline && !receiptBundles[selectedJob.id]) {
      setNotice('Reconnect the local API to retrieve this signed evidence.');
      return;
    }
    try {
      const bundle = await fetchReceipt(selectedJob);
      const payload = bundle || {
        demo: true,
        notice: 'Illustrative sample only. Not produced by Ephemora Cell and not verified by a backend.',
        version: 'proofgate-demo-v1',
        jobId: selectedJob.id,
        runId: 'run-' + selectedJob.id.toLowerCase(),
        runtime: 'Sample runtime profile',
        policy: 'Sample policy; not an executed Cell policy',
        result: selectedJob.tone === 'blocked' ? 'blocked' : 'success',
        receiptReference: selectedJob.receipt,
        settlement: 'No real NEAR transaction is associated with this sample',
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = selectedJob.id.toLowerCase() + (selectedJob.live ? '-receipt.json' : '-demo-receipt.json');
      link.click();
      URL.revokeObjectURL(href);
      setNotice(selectedJob.live ? 'Signed receipt and Cell evidence downloaded.' : 'Demo receipt downloaded with its sample-data disclosure.');
    } catch (error) {
      setNotice('Receipt unavailable: ' + error.message);
    }
  }

  async function createJob(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (connectionLost) {
      setNotice('The local API is unavailable. Reconnect it before creating or running a job.');
      return;
    }
    if (apiOnline) {
      try {
        const result = await apiRequest('/jobs', {
          method: 'POST',
          body: JSON.stringify({
            name: String(data.get('jobName') || ''),
            input: String(data.get('input') || ''),
            reward: String(data.get('amount') || '0.10'),
            beneficiary: String(data.get('beneficiary') || 'local-agent.testnet'),
            language: String(data.get('language') || 'rust'),
          }),
        });
        const job = mapApiJob(result.job);
        setJobs((current) => [job, ...current]);
        setSelectedId(job.id);
        setShowNewJob(false);
        setPage('Execution ' + job.id);
        setNotice(job.languageLabel + ' job saved locally. Run it to create real Cell evidence.');
      } catch (error) {
        setNotice(error.message);
      }
      return;
    }
    const nextId = 'PG-' + String(49 + jobs.length - sampleJobs.length).padStart(3, '0');
    const job = {
      id: nextId,
      name: String(data.get('jobName') || 'Untitled sample job'),
      agent: 'Local demo',
      state: 'Ready for review',
      tone: 'pending',
      amount: String(data.get('amount') || '0.10'),
      time: 'just now',
      receipt: 'demo:' + nextId.toLowerCase() + ':not-created',
      live: false,
    };
    setJobs((current) => [job, ...current]);
    setSelectedId(job.id);
    setShowNewJob(false);
    setPage('Execution ' + job.id);
    setNotice('Sample job created in this browser only. No Cell run or NEAR transaction was made.');
  }

  async function runJob(job) {
    if (!job?.live || !cellReady) return;
    setBusyJobId(job.id);
    setNotice(`Running ${job.languageLabel || 'language guest'} in Ephemora Cell…`);
    try {
      const result = await apiRequest('/jobs/' + encodeURIComponent(job.id) + '/run', { method: 'POST' });
      setReceiptBundles((current) => ({ ...current, [job.id]: result }));
      const updatedJob = mapApiJob(result.job);
      setJobs((current) => current.map((item) => item.id === job.id ? updatedJob : item));
      setPage('Execution ' + job.id);
      setNotice(updatedJob.apiState === 'Verified'
        ? 'Cell evidence verified and signed. No NEAR funds moved.'
        : updatedJob.apiState === 'Blocked'
          ? 'Cell run was blocked. No NEAR funds moved.'
          : `Cell run finished with state “${updatedJob.state}”. No NEAR funds moved.`);
    } catch (error) {
      await refreshBackend();
      setNotice(error.message);
    } finally {
      setBusyJobId('');
    }
  }

  function navTo(label) {
    setPage(label);
    setSearch('');
  }

  function openNewJob(event) {
    if (event?.currentTarget) newJobReturnFocusRef.current = event.currentTarget;
    setShowNewJob(true);
  }

  return <div className="app-frame">
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand-lockup"><Mark /><div><strong>Ephemora</strong><span>ProofGate</span></div></div>
      <div className="nav-caption">Workspace</div>
      <nav className="nav-list">
        {navItems.map(([label, icon]) => <button key={label} className={`nav-item ${page === label ? 'is-active' : ''}`} onClick={() => navTo(label)} aria-label={label} title={label} aria-current={page === label ? 'page' : undefined}>
          <Icon name={icon} size={18} /><span>{label}</span>{label === 'Security' && <span className="nav-pip" aria-label="Security review available" />}
        </button>)}
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-runtime">
        <span className="runtime-orb"><span /></span>
        <div><b>{apiOnline ? 'Local ProofGate' : recordsAreLocal ? 'Cached local records' : 'Preview mode'}</b><span>{cellReady ? 'Cell route ready' : connectionLost ? 'API unavailable' : 'Cell route unavailable'}</span></div>
        <span className="runtime-info" title="Evidence appears here only after the local service returns it">i</span>
      </div>
      <div className="sidebar-footer"><span className="mini-lock"><Icon name="lock" size={13} /></span><span>Keys stay outside the workload</span></div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="mobile-brand"><Mark /><span>ProofGate</span></div>
        <div className="crumb"><span>Workspace</span><span className="crumb-slash">/</span><b>{page}</b></div>
        <div className="topbar-actions">
          <span className="network-pill"><span className={'network-dot ' + (nearStatus?.connected ? 'connected' : 'offline')} />NEAR · {nearPillLabel}</span>
          <Badge tone={apiOnline ? 'neutral' : recordsAreLocal ? 'pending' : 'demo'}>{apiOnline ? 'Local only' : recordsAreLocal ? 'API unavailable' : 'Demo data'}</Badge>
          <button className="icon-button theme-button" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} appearance`} aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={17} /></button>
          <button className="avatar-button" aria-label="Local operator profile">E</button>
        </div>
      </header>

      <div className="demo-banner" role="note"><span className="demo-spark" aria-hidden="true"><Icon name="spark" size={15}/></span><span>{connection.checking ? 'Checking local services' : apiOnline ? (cellReady ? 'Local Cell route ready' : 'ProofGate API online') : recordsAreLocal ? 'Local API unavailable · cached records' : 'Offline sample environment'}</span><span className="banner-divider" /><span>{connection.checking ? 'Checking runtime and stored jobs' : apiOnline ? (cellReady ? `${languageSummary || 'No reviewed guests available'} · evidence after a completed Cell run · ${nearPillLabel.replace('Testnet · read-only', 'NEAR Testnet RPC read-only')}` : 'Cell or local signing keys need setup') : recordsAreLocal ? 'Reconnect to refresh or execute · escrow contract remains offline' : 'Cell, verifier, and NEAR network are not connected'}</span><span className="banner-end">{apiOnline ? 'Local records' : recordsAreLocal ? 'Cached local records' : 'Sample values only'}</span></div>

      <section className="page-heading">
        <div>
          <p className="eyebrow">PROTECTED COMPUTE</p>
          <h1>{copy[0]}</h1>
          <p className="page-subtitle">{copy[1]}</p>
        </div>
        <div className="heading-actions">
          <button className="button button-secondary" onClick={() => recordsAreLocal ? refreshBackend(true) : setNotice('Sample data is already current.')}>{recordsAreLocal ? apiOnline ? 'Refresh' : 'Reconnect' : 'Refresh sample'}</button>
          <button className="button button-primary" onClick={openNewJob}><Icon name="plus" size={17} />Create protected job</button>
        </div>
      </section>

      {page === 'Overview' && <Overview jobs={jobs} apiOnline={apiOnline} recordsAreLocal={recordsAreLocal} cellReady={cellReady} onOpenJob={openJob} onNewJob={openNewJob} onNavigate={navTo} />}
      {page === 'Executions' && <Executions jobs={filteredJobs} apiOnline={apiOnline} recordsAreLocal={recordsAreLocal} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} onOpenJob={openJob} />}
      {page === 'Receipts' && <Receipts jobs={jobs} selectedJob={selectedJob} receiptBundle={selectedJob ? receiptBundles[selectedJob.id] : null} apiOnline={apiOnline} recordsAreLocal={recordsAreLocal} onOpenJob={openJob} onCopy={copyReceipt} onDownload={downloadReceipt} />}
      {page === 'Settlements' && <Settlements jobs={jobs} apiOnline={apiOnline} recordsAreLocal={recordsAreLocal} onOpenJob={openJob} />}
      {page === 'Security' && <Security connection={connection} />}
      {page === 'Settings' && <Settings theme={theme} setTheme={setTheme} connection={connection} nearStatus={nearStatus} checkingNear={checkingNear} onCheckNearStatus={checkNearStatus} />}
      {page.startsWith('Execution ') && selectedJob && <ExecutionDetail job={selectedJob} receiptBundle={receiptBundles[selectedJob.id]} cellReady={cellReady} busy={busyJobId === selectedJob.id} onRun={() => runJob(selectedJob)} onCopy={copyReceipt} onDownload={downloadReceipt} onNavigate={navTo} />}
      {page.startsWith('Execution ') && !selectedJob && <div className="empty-state"><span className="empty-glyph"><Icon name="search" size={19}/></span><b>Job no longer available</b><p>Refresh the local job list to continue.</p></div>}

      <footer className="page-footer"><span>Ephemora ProofGate <span className="footer-dot">·</span>{recordsAreLocal ? ' Local build' : ' Preview build'}</span><span>Evidence authenticates a statement; it does not prove arbitrary program correctness.</span></footer>
    </main>

    <nav className="mobile-nav" aria-label="Primary navigation">
      {navItems.map(([label, icon]) => <button key={label} className={page === label ? 'is-active' : ''} onClick={() => navTo(label)} aria-label={label} aria-current={page === label ? 'page' : undefined}><Icon name={icon} size={19} /><span>{label}</span></button>)}
    </nav>

    {showNewJob && <NewJobDialog onClose={() => setShowNewJob(false)} onSubmit={createJob} apiOnline={apiOnline} connectionLost={connectionLost} languages={availableLanguages} returnFocusRef={newJobReturnFocusRef} />}
    {notice && <div className="toast" role="status" aria-live="polite" aria-atomic="true" aria-busy={Boolean(busyJobId)}><span className="toast-mark"><Icon name={busyJobId ? 'clock' : 'check'} size={14} /></span>{notice}</div>}
  </div>;
}

function Overview({ jobs, apiOnline, recordsAreLocal, cellReady, onOpenJob, onNewJob, onNavigate }) {
  const featured = jobs.find((job) => job.tone === 'verified') || jobs[0];
  return <div className="content-stack">
    <section className="journey-panel">
      <div className="journey-intro">
        <div><span className="section-kicker">THE PROOFGATE JOURNEY</span><h2>Policy first. Payment last.</h2><p>Each stage leaves evidence. A successful run and a confirmed payment are different events.</p></div>
        <span className="journey-mark" aria-hidden="true"><span className="journey-mark-core"/><span className="journey-mark-ring ring-a"/><span className="journey-mark-ring ring-b"/></span>
      </div>
      <div className="journey-rail" aria-label="Policy to settlement flow">
        <div className="journey-node node-policy"><span className="journey-icon"><Icon name="shield" size={18}/></span><div><b>Policy</b><small>Set allowed work</small></div></div><span className="journey-link"><i/></span>
        <div className="journey-node node-run"><span className="journey-icon"><Icon name="play" size={18}/></span><div><b>Execute</b><small>Cell boundary</small></div></div><span className="journey-link"><i/></span>
        <div className="journey-node node-evidence"><span className="journey-icon"><Icon name="receipt" size={18}/></span><div><b>Verify</b><small>Inspect evidence</small></div></div><span className="journey-link"><i/></span>
        <div className="journey-node node-payment"><span className="journey-icon"><Icon name="wallet" size={18}/></span><div><b>Settle</b><small>Confirm on NEAR</small></div></div>
      </div>
      <div className="journey-foot"><span><span className="tiny-ring"/>Policy checks happen outside the untrusted workload</span><button className="text-link" onClick={() => onNavigate('Security')}>Review security model <Icon name="arrow" size={14}/></button></div>
    </section>

    <div className="overview-grid">
      <section className="panel execution-panel">
        <div className="panel-heading"><div><span className="section-kicker">{recordsAreLocal ? 'LATEST LOCAL JOB' : 'LATEST SAMPLE'}</span><h2>Execution chain</h2></div><Badge tone={recordsAreLocal ? 'neutral' : 'demo'}>{recordsAreLocal ? 'Local record' : 'Illustrative'}</Badge></div>
        {featured ? <>
          <div className="featured-job-line"><div className="job-monogram"><Icon name="receipt" size={18}/></div><div className="featured-job-name"><b>{featured.name}</b><span>{featured.id} <span className="inline-dot">·</span> {featured.agent}</span></div><Badge tone={featured.tone}>{featured.state}</Badge></div>
          <StageTrack state={featured.tone === 'blocked' ? 'blocked' : featured.tone === 'pending' ? 'pending' : 'verified'} />
          <div className="chain-summary">
            <div><span>Receipt reference</span><b className="mono">{featured.receipt}</b></div>
            <div><span>Reward</span><b>{featured.amount} <small>NEAR</small></b></div>
            <div><span>Settlement</span><b className="settlement-wait"><span className="small-state-dot"/>Not confirmed</b></div>
          </div>
          <div className="panel-actions"><button className="button button-secondary" onClick={() => onOpenJob(featured)}>Inspect {featured.live ? 'job' : 'sample'} details <Icon name="arrow" size={15}/></button><span className="micro-note">No NEAR transaction is connected.</span></div>
        </> : <div className="empty-state compact-empty"><span className="empty-glyph"><Icon name="play" size={19}/></span><b>No jobs yet</b><p>Create a job and choose a reviewed language guest.</p><button className="button button-primary" onClick={onNewJob}><Icon name="plus" size={15}/>Create a local job</button></div>}
      </section>

      <section className="panel policy-panel">
        <div className="panel-heading"><div><span className="section-kicker">DECLARED BEFORE RUN</span><h2>{apiOnline && cellReady ? 'Current policy' : 'Policy preview'}</h2></div><span className="panel-icon"><Icon name="lock" size={16}/></span></div>
        <div className="policy-lede"><span className="policy-pulse"/><p>Execution is restricted by the selected policy.</p></div>
        <ul className="policy-list">
          <li><span className="policy-check"><Icon name="check" size={12}/></span><span>Read the job input</span><b>Allowed</b></li>
          <li><span className="policy-check"><Icon name="check" size={12}/></span><span>Use ephemeral sandbox</span><b>Allowed</b></li>
          <li><span className="policy-denied"><Icon name="alert" size={12}/></span><span>Open a network socket</span><b className="denied-copy">Denied</b></li>
        </ul>
        <div className="policy-note"><Icon name="alert" size={14}/><span>{apiOnline && cellReady ? 'Cell applies the recorded limits to every approved language guest.' : 'This policy summary is illustrative until the local Cell route is ready.'}</span></div>
        <button className="text-link policy-link" onClick={() => onNavigate('Security')}>View policy boundaries <Icon name="arrow" size={14}/></button>
      </section>
    </div>

    <section className="panel activity-panel">
      <div className="panel-heading activity-heading"><div><span className="section-kicker">{recordsAreLocal ? 'LOCAL RECORDS' : 'LOCAL SAMPLE RECORDS'}</span><h2>Recent executions</h2></div><button className="text-link" onClick={() => onNavigate('Executions')}>All executions <Icon name="arrow" size={14}/></button></div>
      <div className="records-table-wrap"><table className="records-table"><thead><tr><th>Job</th><th>Agent</th><th>Status</th><th>Reward</th><th>Updated</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>
        {jobs.slice(0, 3).map((job) => <tr key={job.id}>
          <td><span className="job-id">{job.id}</span><b>{job.name}</b></td><td>{job.agent}</td><td><Badge tone={job.tone} icon={job.tone === 'verified' ? 'check' : job.tone === 'blocked' ? 'alert' : 'clock'}>{job.state}</Badge></td><td>{job.amount} NEAR</td><td>{job.time}</td><td><button type="button" className="row-open" aria-label={`Open job ${job.id}: ${job.name}`} onClick={() => onOpenJob(job)}><Icon name="arrow" size={16}/></button></td>
        </tr>)}
      </tbody></table></div>
    </section>

    <section className="demo-explainer"><span className="demo-explainer-icon"><Icon name="lock" size={16}/></span><div><b>{recordsAreLocal ? 'NEAR payout is not connected' : 'This is a visual preview'}</b><p>{apiOnline ? 'Cell evidence can be generated locally. Settlement stays unpaid until an authorized NEAR contract is connected.' : recordsAreLocal ? 'These are saved local records. Reconnect the ProofGate API before creating or running another job.' : 'Sample values and receipt references are fictional. Start the local API to create signed Cell evidence.'}</p></div><button className="text-link" onClick={onNewJob}>Create {recordsAreLocal ? 'a protected job' : 'a local sample job'} <Icon name="arrow" size={14}/></button></section>
  </div>;
}

function Executions({ jobs, apiOnline, recordsAreLocal, search, setSearch, filter, setFilter, onOpenJob }) {
  return <div className="content-stack">
    <section className="panel list-panel">
      <div className="list-controls"><label className="search-field"><Icon name="search" size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={recordsAreLocal ? 'Search local jobs' : 'Search sample jobs'} aria-label={recordsAreLocal ? 'Search local jobs' : 'Search sample jobs'}/></label>
        <label className="select-wrap"><span className="sr-only">Filter jobs</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">{recordsAreLocal ? 'All jobs' : 'All sample jobs'}</option><option value="verified">Verified</option><option value="blocked">Blocked</option><option value="pending">Pending</option></select><Icon name="chevron" size={15}/></label>
      </div>
      {jobs.length ? <div className="records-table-wrap"><table className="records-table full-table"><thead><tr><th>Job</th><th>Agent</th><th>Status</th><th>Reward</th><th>Updated</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><span className="job-id">{job.id}</span><b>{job.name}</b></td><td>{job.agent}</td><td><Badge tone={job.tone}>{job.state}</Badge></td><td>{job.amount} NEAR</td><td>{job.time}</td><td><button type="button" className="row-open" onClick={() => onOpenJob(job)} aria-label={`Open job ${job.id}: ${job.name}`}><Icon name="arrow" size={16}/></button></td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-glyph"><Icon name="search" size={19}/></span><b>{recordsAreLocal ? 'No jobs match' : 'No sample jobs match'}</b><p>{recordsAreLocal ? 'Create a job or change the search filters.' : 'Try a different search or filter.'}</p></div>}
      <div className="table-foot"><Badge tone={recordsAreLocal ? 'neutral' : 'demo'}>{recordsAreLocal ? 'Local records' : 'Demo data'}</Badge><span>{jobs.length} {recordsAreLocal ? 'saved jobs' : 'illustrative records'}</span></div>
    </section>
  </div>;
}

function ExecutionDetail({ job, receiptBundle, cellReady, busy, onRun, onCopy, onDownload, onNavigate }) {
  const isBlocked = job.tone === 'blocked';
  const verified = job.apiState === 'Verified';
  const ready = job.apiState === 'Ready';
  const receipt = receiptBundle?.receipt?.payload;
  const signature = receiptBundle?.receipt?.signatures?.[0];
  const stage = isBlocked ? 'blocked' : verified ? 'verified' : job.apiState === 'Executing' ? 'running' : 'pending';
  const outcomeTitle = verified ? 'Evidence verified · payment not made' : isBlocked ? 'Execution blocked' : job.live ? (ready ? 'Ready for a Cell run' : 'Execution in progress') : 'No payment has been confirmed';
  const outcomeText = verified
    ? 'Cell signed the execution report. ProofGate checked the signature, job binding, freshness, policy limits, output, and replay state.'
    : isBlocked ? (job.error?.message || 'The verifier rejected this execution.')
      : job.live ? 'This local job has not produced accepted Cell evidence yet.'
        : 'This sample has no verified Cell receipt or NEAR transaction behind it.';
  const digest = (name) => receipt?.[name] || (verified ? 'Not present in receipt' : 'Generated after a verified run');

  return <div className="content-stack">
    <section className="panel detail-hero">
      <div className="detail-title-row"><div><button className="back-link" onClick={() => onNavigate('Executions')}>← All executions</button><div className="detail-id-line"><span className="detail-id">{job.id}</span><Badge tone={job.live ? 'neutral' : 'demo'}>{job.live ? 'Local record' : 'Sample record'}</Badge></div><h2>{job.name}</h2><p>{job.agent} <span className="inline-dot">·</span> {job.live ? `${job.languageLabel} · ${runtimeLabel(job)}` : 'Sample runtime profile'}</p></div><Badge tone={job.tone} icon={isBlocked ? 'alert' : verified ? 'check' : 'clock'}>{job.state}</Badge></div>
      <StageTrack state={stage} />
      <div className={'detail-outcome ' + (isBlocked ? 'outcome-blocked' : verified ? 'outcome-verified' : 'outcome-neutral')}><span className="outcome-icon"><Icon name={isBlocked ? 'alert' : verified ? 'check' : 'clock'} size={17}/></span><div><b>{outcomeTitle}</b><p>{outcomeText}</p></div></div>
      {job.live && ready && <div className="run-action"><button className="button button-primary" onClick={onRun} disabled={!cellReady || busy} aria-busy={busy}><Icon name={busy ? 'clock' : 'play'} size={15}/>{busy ? 'Running in Cell…' : 'Run in Ephemora Cell'}</button><span>{cellReady ? 'Uses the reviewed ' + job.languageLabel + ' guest and current Cell limits.' : 'Cell and local signing keys must be ready before execution.'}</span></div>}
      {job.live && job.input && <div className="job-input"><span className="section-kicker">JOB INPUT · {new TextEncoder().encode(job.input).length} BYTES</span><code>{job.input}</code></div>}
      {verified && job.output && <div className="job-output"><span className="section-kicker">VERIFIED OUTPUT</span><pre>{JSON.stringify(job.output, null, 2)}</pre></div>}
    </section>
    <div className="detail-grid">
      <section className="panel evidence-panel"><div className="panel-heading"><div><span className="section-kicker">{verified ? 'SIGNED PROOFGATE RECEIPT' : 'EVIDENCE STATUS'}</span><h2>Execution evidence</h2></div><Badge tone={verified ? 'verified' : 'demo'}>{verified ? 'Verified' : job.live ? 'Not issued' : 'Not signed'}</Badge></div><dl className="evidence-list">
        <div><dt>Job ID</dt><dd>{job.id}</dd></div>
        <div><dt>Run ID</dt><dd className="mono">{job.runId || 'Created on run'}</dd></div>
        <div><dt>Source language</dt><dd>{job.live ? `${job.languageLabel || job.language} · ${job.compiler || 'compiler not reported'}` : 'Sample runtime profile'}</dd></div>
        {job.live && <div><dt>ABI / runtime profile</dt><dd>{runtimeLabel(job)}</dd></div>}
        <div><dt>Program digest</dt><dd className="mono">{digest('programDigest')}</dd></div>
        <div><dt>Input digest</dt><dd className="mono">{digest('inputDigest')}</dd></div>
        <div><dt>Output digest</dt><dd className="mono">{digest('outputDigest')}</dd></div>
        <div><dt>Policy digest</dt><dd className="mono">{job.live ? (receipt?.policyDigest || job.policyDigest || 'Recorded on run') : 'Not generated in preview'}</dd></div>
        <div><dt>Cell report ID</dt><dd className="mono">{receipt?.cellReportId || job.reportId || 'Not issued'}</dd></div>
        <div><dt>ProofGate signer</dt><dd className="mono">{signature?.keyId || 'None'}</dd></div>
      </dl><div className="evidence-actions"><button className="button button-secondary" onClick={onCopy} disabled={job.live && !verified}><Icon name="copy" size={15}/>{job.live ? verified ? 'Copy signed receipt' : 'Receipt not issued' : 'Copy sample reference'}</button><button className="button button-secondary" onClick={onDownload} disabled={job.live && !verified}><Icon name="download" size={15}/>{job.live ? verified ? 'Download signed evidence' : 'Evidence not issued' : 'Download sample JSON'}</button></div></section>
      <section className="panel settlement-panel"><div className="panel-heading"><div><span className="section-kicker">PAYMENT STATE</span><h2>Settlement</h2></div><span className="settlement-lock"><Icon name="lock" size={16}/></span></div><div className="amount-display"><span>Proposed reward</span><b>{job.amount} <small>NEAR</small></b></div><div className="settlement-row"><span>Network</span><b>NEAR Testnet <Badge tone="demo">Offline</Badge></b></div><div className="settlement-row"><span>Beneficiary</span><b>{job.beneficiary || 'sample-agent.testnet'}</b></div><div className="settlement-row"><span>Contract</span><b>Not connected</b></div><div className="settlement-row"><span>Transaction</span><b>No transaction</b></div><div className="settlement-disclosure"><Icon name="alert" size={15}/><span>A verified receipt alone does not move funds. This local preview has no escrow contract or chain connection.</span></div></section>
    </div>
    <section className="panel log-panel"><div className="panel-heading"><div><span className="section-kicker">{job.live ? 'LOCAL EVENT LOG' : 'SAMPLE EVENT LOG'}</span><h2>What happened</h2></div><Badge tone={job.live ? 'neutral' : 'demo'}>{job.live ? 'Local record' : 'Illustrative'}</Badge></div><ol className="event-list"><li><span className="event-marker event-blue"/><time>01</time><div><b>Job submitted</b><p>{job.live ? job.languageLabel + ' workload and policy stored locally.' : 'Sample job record created in the preview.'}</p></div></li>{verified ? <li><span className="event-marker event-green"/><time>02</time><div><b>Cell evidence verified</b><p>Cell signature, tenant, runtime policy, output, freshness, and single-use report checks passed.</p></div></li> : isBlocked ? <li><span className="event-marker event-red"/><time>02</time><div><b>Run blocked</b><p>{job.error?.message || 'The verifier did not accept the run.'}</p></div></li> : <li><span className="event-marker event-violet"/><time>02</time><div><b>{job.live ? 'Waiting for Cell run' : 'Illustrative state only'}</b><p>{job.live ? 'No execution report has been accepted for this job.' : 'The displayed state is not a verifier result.'}</p></div></li>}</ol></section>
  </div>;
}

function Receipts({ jobs, selectedJob, receiptBundle, apiOnline, recordsAreLocal, onOpenJob, onCopy, onDownload }) {
  const focused = selectedJob || jobs[0] || null;
  const verified = focused?.live && focused.apiState === 'Verified';
  const signedReceipt = receiptBundle?.receipt;
  const signature = signedReceipt?.signatures?.[0];
  const checks = verified ? 'pass' : 'unknown';
  return <div className="content-stack">
    <section className="receipt-intro"><div className="receipt-icon-large"><Icon name="receipt" size={22}/></div><div><h2>What a receipt can tell you</h2><p>A signature links a statement to a key. Independent policy checks decide whether that statement is eligible for a job.</p></div></section>
    <div className="disclosure-strip"><Icon name="alert" size={17}/><p>{recordsAreLocal ? 'A signature does not prove host integrity or arbitrary program correctness. Verified records remain unpaid until a NEAR contract confirms settlement.' : 'A signature does not prove the host was untampered or that arbitrary program output is correct. All records below are illustrative samples.'}</p></div>
    <section className="panel receipt-layout"><div className="receipt-job-list"><div className="panel-heading"><div><span className="section-kicker">{recordsAreLocal ? 'LOCAL RECORDS' : 'SAMPLE RECORDS'}</span><h2>Receipts</h2></div><Badge tone={recordsAreLocal ? 'neutral' : 'demo'}>{jobs.length} {recordsAreLocal ? 'jobs' : 'samples'}</Badge></div>
      {jobs.map((job) => <button className={'receipt-job ' + (focused && job.id === focused.id ? 'selected' : '')} key={job.id} onClick={() => onOpenJob(job)}><span className="receipt-job-mark"><Icon name="receipt" size={16}/></span><span className="receipt-job-copy"><b>{job.id}</b><small>{job.name}</small></span><StatusGlyph tone={job.tone}/></button>)}
      {!jobs.length && <div className="empty-state compact-empty"><b>No jobs yet</b><p>Create a protected job to start.</p></div>}
    </div>
      {focused ? <div className="receipt-inspector"><div className="inspector-heading"><div><span className="section-kicker">{verified ? 'VERIFIED RECEIPT' : focused.live ? 'LOCAL JOB' : 'SELECTED SAMPLE'}</span><h2>{focused.id}</h2></div><Badge tone={verified ? 'verified' : focused.live ? 'pending' : 'demo'}>{verified ? 'Verified' : focused.live ? 'No receipt yet' : 'Not verified'}</Badge></div>
        <div className="fingerprint-box"><span>{verified ? 'Cell report' : 'Receipt reference'}</span><code>{focused.reportId || focused.receipt}</code><button className="icon-button" onClick={onCopy} disabled={focused.live && !verified} aria-label="Copy selected receipt"><Icon name="copy" size={15}/></button></div>
        {verified && <div className="evidence-list receipt-facts"><div><dt>Source language</dt><dd>{focused.languageLabel || focused.language}</dd></div><div><dt>ABI / runtime profile</dt><dd>{runtimeLabel(focused)}</dd></div><div><dt>Program digest</dt><dd className="mono">{signedReceipt?.payload?.programDigest || 'Bound in signed receipt'}</dd></div><div><dt>ProofGate signer</dt><dd className="mono">{signature?.keyId || 'Available in downloaded receipt'}</dd></div></div>}
        <div className="check-list"><CheckRow label="Cell evidence schema accepted" state={checks} text={verified ? 'Passed' : 'Not checked'}/><CheckRow label="Cell signature matches trusted key" state={checks} text={verified ? 'Passed' : 'Not checked'}/><CheckRow label="Job, tenant, and policy bindings match" state={checks} text={verified ? 'Passed' : 'Not checked'}/><CheckRow label="Fresh, single-use report" state={checks} text={verified ? 'Passed' : 'Not checked'}/><CheckRow label="Output matches expected result" state={checks} text={verified ? 'Passed' : 'Not checked'}/></div>
        <div className="inspector-actions"><button className="button button-secondary" onClick={onDownload} disabled={focused.live && !verified}><Icon name="download" size={15}/>{verified ? 'Download signed evidence' : focused.live ? 'Receipt not issued' : 'Download sample JSON'}</button><span>{verified ? 'Payment remains unpaid.' : 'Verification requires a Cell run.'}</span></div>
      </div> : <div className="empty-state"><b>Select a job</b><p>Receipt details will appear here.</p></div>}
    </section>
  </div>;
}

function CheckRow({ label, state, text }) {
  return <div className="check-row"><span className={`check-symbol check-${state}`}>{state === 'pass' ? <Icon name="check" size={12}/> : state === 'fail' ? <Icon name="alert" size={12}/> : <span>—</span>}</span><span>{label}</span><b>{text}</b></div>;
}

function Settlements({ jobs, apiOnline, recordsAreLocal, onOpenJob }) {
  return <div className="content-stack"><div className="settlement-banner"><div className="banner-icon"><Icon name="wallet" size={19}/></div><div><b>No chain connection</b><p>{recordsAreLocal ? 'Cell receipts can be verified locally, but no escrow balance or transaction exists.' : 'There are no real escrow balances or transactions in this preview.'}</p></div><Badge tone="demo">NEAR offline</Badge></div><section className="panel list-panel"><div className="panel-heading"><div><span className="section-kicker">{recordsAreLocal ? 'PROPOSED PAYMENTS' : 'SAMPLE PAYMENT RECORDS'}</span><h2>Settlement activity</h2></div></div>{jobs.length ? <div className="records-table-wrap"><table className="records-table full-table"><thead><tr><th>Job</th><th>Beneficiary</th><th>Amount</th><th>Payment state</th><th>Transaction</th><th></th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><span className="job-id">{job.id}</span><b>{job.name}</b></td><td>{job.beneficiary || 'sample-agent.testnet'}</td><td>{job.amount} NEAR</td><td><Badge tone={job.tone === 'verified' ? 'pending' : job.tone}>{job.tone === 'verified' ? 'Verified · unpaid' : job.tone === 'blocked' ? 'Payout blocked' : 'Not funded'}</Badge></td><td className="muted-cell">No transaction</td><td><button type="button" className="row-open" aria-label={`Open job ${job.id}: ${job.name}`} onClick={() => onOpenJob(job)}><Icon name="arrow" size={16}/></button></td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-glyph"><Icon name="wallet" size={19}/></span><b>No proposed payments</b><p>Each job will remain unpaid until a NEAR escrow contract is connected.</p></div>}</section><p className="settlement-footnote"><Icon name="alert" size={15}/>A job remains unpaid until the chain confirms its final state.</p></div>;
}

function Security({ connection }) {
  const apiOnline = connection.apiReachable === true;
  const cellReady = connection.connected === true;
  return <div className="content-stack">
    <section className="security-hero"><div className="security-shield"><Icon name="shield" size={24}/></div><div><span className="section-kicker">TRUST BOUNDARY</span><h2>Keep execution and payment authority apart.</h2><p>Untrusted code works inside the Cell boundary. Evidence review and settlement authorization stay outside it.</p></div></section>
    <div className="security-grid"><section className="panel boundary-panel"><div className="panel-heading"><div><span className="section-kicker">AUTHORITY MAP</span><h2>Who can do what</h2></div></div><div className="boundary-row"><span className="boundary-symbol agent-symbol"><Icon name="play" size={16}/></span><div><b>Agent workload</b><p>Runs the submitted task with declared capabilities.</p></div><Badge tone="verified">No payment key</Badge></div><div className="boundary-row"><span className="boundary-symbol cell-symbol"><Icon name="shield" size={16}/></span><div><b>Ephemora Cell</b><p>Constrains each reviewed guest and reports its actual outcome.</p></div><Badge tone={cellReady ? 'verified' : 'demo'}>{cellReady ? 'Connected' : 'Unavailable'}</Badge></div><div className="boundary-row"><span className="boundary-symbol verify-symbol"><Icon name="receipt" size={16}/></span><div><b>ProofGate verifier</b><p>Checks signer trust, job binding, policy, freshness, output, and replay state.</p></div><Badge tone={apiOnline ? 'verified' : 'demo'}>{apiOnline ? 'Local verifier' : 'Not connected'}</Badge></div><div className="boundary-row"><span className="boundary-symbol contract-symbol"><Icon name="wallet" size={16}/></span><div><b>NEAR escrow</b><p>Settlement is not available until a contract is connected.</p></div><Badge tone="demo">Offline</Badge></div></section>
      <section className="panel guardrail-panel"><div className="panel-heading"><div><span className="section-kicker">FAIL-CLOSED DEFAULTS</span><h2>Guardrails</h2></div></div><CheckRow label="Worker receives signing keys" state={apiOnline ? 'pass' : 'unknown'} text={apiOnline ? 'Not exposed to guest' : 'Not connected'}/><CheckRow label="Unknown evidence schema" state={apiOnline ? 'pass' : 'unknown'} text={apiOnline ? 'Rejected' : 'Not checked'}/><CheckRow label="Repeated Cell report" state={apiOnline ? 'pass' : 'unknown'} text={apiOnline ? 'Rejected' : 'Not checked'}/><CheckRow label="Unconfirmed transaction" state={apiOnline ? 'pass' : 'unknown'} text={apiOnline ? 'Never shown as paid' : 'Not checked'}/><div className="guardrail-note"><Badge tone={apiOnline ? 'verified' : 'demo'}>{apiOnline ? 'Local verifier active' : 'Design intent'}</Badge><span>{apiOnline ? 'These checks run in the local API. NEAR settlement remains disconnected.' : 'Start the local API to execute the verifier path.'}</span></div></section></div>
    <div className="security-note"><Icon name="lock" size={16}/><span>Signed execution evidence is not a mathematical proof of correctness, host integrity, or runtime isolation.</span></div>
  </div>;
}

function Settings({ theme, setTheme, connection, nearStatus, checkingNear, onCheckNearStatus }) {
  const apiOnline = connection.apiReachable === true;
  const connectionLost = connection.connectedOnce === true && !apiOnline;
  const cellReady = connection.connected === true;
  const guests = availableLanguageCatalog(connection);
  const guestLabels = [...new Map(guests.map((guest) => [guest.id, guest.label || guest.id])).values()];
  const guestProfiles = [...new Map(guests.map((guest) => [
    guest.id,
    `${guest.label || guest.id}: ${runtimeLabel(guest)}`,
  ])).values()];
  const rpcTone = nearStatus?.connected ? 'verified' : checkingNear ? 'pending' : nearStatus ? 'blocked' : 'demo';
  const rpcLabel = nearStatus?.connected ? 'Reachable · read-only' : checkingNear ? 'Checking' : nearStatus ? 'Unavailable' : 'Not checked';

  return <div className="content-stack settings-grid">
    <section className="panel settings-panel">
      <div className="panel-heading"><div><span className="section-kicker">APPEARANCE</span><h2>Choose a theme</h2></div></div>
      <div className="theme-options">
        <button className={theme === 'light' ? 'theme-option selected' : 'theme-option'} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><span className="theme-preview light-preview"><i/><i/><i/></span><b>Light</b><small>Clear evidence, calm canvas</small></button>
        <button className={theme === 'dark' ? 'theme-option selected' : 'theme-option'} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><span className="theme-preview dark-preview"><i/><i/><i/></span><b>Dark</b><small>Low-light review</small></button>
      </div>
    </section>

    <section className="panel settings-panel">
      <div className="panel-heading"><div><span className="section-kicker">NETWORK</span><h2>NEAR Testnet</h2></div><Badge tone={rpcTone}>{rpcLabel}</Badge></div>
      <div className="settings-row"><span>Read-only RPC</span><b>{nearStatus?.connected ? `${nearStatus.provider} · block ${nearStatus.latestBlockHeight}` : nearStatus?.error || 'Not checked'}</b></div>
      {nearStatus?.connected && <div className="settings-row"><span>Latest block time</span><b>{nearStatus.latestBlockTime ? new Date(nearStatus.latestBlockTime).toLocaleString() : 'Not reported'}</b></div>}
      <div className="settings-row"><span>Escrow contract</span><b className="muted-cell">Not deployed</b></div>
      <div className="settings-row"><span>Mainnet transfers</span><b className="muted-cell">Not available</b></div>
      <div className="settings-actions"><button className="button button-secondary" onClick={onCheckNearStatus} disabled={!apiOnline || checkingNear}>{checkingNear ? 'Checking Testnet…' : 'Check Testnet RPC'}</button><span className="settings-hint">Read-only status call. No wallet, contract write, or transaction.</span></div>
      <div className="settings-warning"><Icon name="alert" size={15}/><span>{apiOnline ? 'Network reachability does not mean an escrow contract is connected.' : 'Reconnect the local API before checking the Testnet RPC.'}</span></div>
    </section>

    <section className="panel settings-panel">
      <div className="panel-heading"><div><span className="section-kicker">RUNTIME INFORMATION</span><h2>Execution source</h2></div><Badge tone={cellReady ? 'verified' : 'demo'}>{cellReady ? 'Connected' : 'Offline'}</Badge></div>
      <div className="settings-row"><span>Cell version</span><b>{connection.cell?.version || 'Not connected'}</b></div>
      <div className="settings-row"><span>Available languages</span><b>{guestLabels.join(', ') || (cellReady ? 'No guest reported' : 'Not connected')}</b></div>
      <div className="settings-row"><span>ABI / runtime profiles</span><b>{guestProfiles.join(' · ') || 'Not reported'}</b></div>
      <div className="settings-row"><span>Receipt verifier</span><b>{apiOnline ? 'Local API' : 'Not connected'}</b></div>
    </section>

    <section className="panel settings-panel">
      <div className="panel-heading"><div><span className="section-kicker">LOCAL DATA</span><h2>Preview boundaries</h2></div></div>
      <p className="settings-paragraph">{apiOnline ? 'Jobs, signed Cell evidence, and ProofGate receipts are stored in a local SQLite database. NEAR settlement is not connected.' : connectionLost ? 'Saved SQLite records remain in the browser view, but the local API is unreachable. Reconnect before taking actions.' : 'These records are sample data held in this browser session and are not an audit log.'}</p>
      <Badge tone="demo">No real payment</Badge>
    </section>
  </div>;
}

function NewJobDialog({ onClose, onSubmit, apiOnline, connectionLost, languages, returnFocusRef }) {
  const configuredLanguages = apiOnline ? languages.filter((language) => language.available) : connectionLost ? [] : [
    { id: 'rust', label: 'Rust · sample' },
    { id: 'c', label: 'C · sample' },
    { id: 'zig', label: 'Zig · sample' },
    { id: 'go', label: 'Go · sample' },
    { id: 'assemblyscript', label: 'AssemblyScript · sample' },
    { id: 'python', label: 'Python · sample' },
    { id: 'javascript', label: 'JavaScript · sample' },
  ];
  const available = [...new Map(configuredLanguages.map((language) => [language.id, language])).values()];
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const defaultLanguage = available[0]?.id || '';
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const focusable = () => [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') || [])];
    const initialField = dialog?.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled])');
    (initialField || focusable()[0] || dialog)?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); dialog?.focus(); return; }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const returnTarget = returnFocusRef.current || previousFocus;
      if (returnTarget instanceof HTMLElement && returnTarget.isConnected) returnTarget.focus();
      returnFocusRef.current = null;
    };
  }, [returnFocusRef]);
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog" ref={dialogRef} tabIndex="-1" role="dialog" aria-modal="true" aria-labelledby="new-job-title" aria-describedby="new-job-description"><div className="dialog-header"><div><span className="section-kicker">{apiOnline ? 'LOCAL CELL RUN' : connectionLost ? 'LOCAL API OFFLINE' : 'OFFLINE PREVIEW'}</span><h2 id="new-job-title">{connectionLost ? 'Reconnect to continue' : apiOnline ? 'Create a protected job' : 'Create a sample job'}</h2></div><button type="button" className="icon-button close-button" onClick={onClose} aria-label="Close dialog">×</button></div>
    <p className="dialog-copy" id="new-job-description">{connectionLost ? 'Saved records remain visible, but job creation and execution are unavailable until the local API reconnects.' : apiOnline ? available.length ? 'Choose an available, reviewed language guest and give it bounded text input. Each guest uses the runtime profile reported by the local API. ProofGate stores the job locally; no NEAR funds move.' : 'The local API reports no available language guests. Check the runtime setup before creating a protected job.' : 'This adds an illustrative record to the current browser session. Language labels are examples only; it does not start a Cell run or create a NEAR transaction.'}</p>
    <form onSubmit={onSubmit}>
      <label className="field-label">Job name<input name="jobName" required maxLength="64" placeholder="e.g. Normalize public data" autoFocus/></label>
      <label className="field-label">Input text<textarea name="input" required maxLength="512" rows="3" placeholder="Paste a short line of text to normalize"/><small>Up to 512 bytes · ASCII letters, numbers, punctuation, and spaces</small></label>
      <div className="form-two"><label className="field-label">Language<select name="language" defaultValue={defaultLanguage} required disabled={!available.length}>{available.map((language) => { const profile = [language.abi, language.runtimeProfile].filter(Boolean).join(' · ') || language.detail; return <option key={language.id} value={language.id}>{language.label || language.id}{profile ? ` · ${profile}` : ''}</option>; })}</select><small>{apiOnline ? available.length ? `${available.length} language guest${available.length === 1 ? '' : 's'} available from the local API` : 'No guest is currently available' : 'Sample labels only · no runtime is invoked'}</small></label><label className="field-label">Proposed reward<input type="number" name="amount" min="0.01" max="10" step="0.01" defaultValue="0.10" required/><small>NEAR · not funded</small></label></div>
      {apiOnline && <label className="field-label">Beneficiary account<input name="beneficiary" required minLength="2" maxLength="64" pattern="[a-z0-9._-]+" defaultValue="local-agent.testnet"/><small>Recorded in the receipt; no payout is configured</small></label>}
      <div className="dialog-policy"><Icon name="lock" size={15}/><span>Signing keys stay outside the guest workload.</span></div>
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Close</button><button className="button button-primary" type="submit" disabled={connectionLost || (apiOnline && !available.length)}>{apiOnline ? 'Create local job' : connectionLost ? 'API unavailable' : 'Add sample job'} <Icon name="arrow" size={15}/></button></div>
    </form></section></div>;
}

export default App;
