import { useEffect, useMemo, useRef, useState } from 'react';

const navItems = [
  ['Overview', 'grid'],
  ['Executions', 'play'],
  ['Receipts', 'receipt'],
  ['Settlements', 'wallet'],
  ['Challenge', 'spark'],
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
  const settlement = job.settlement && typeof job.settlement === 'object' ? job.settlement : null;
  const settled = job.settled === true && settlement?.status === 'Paid';
  const probe = job.probe === true;
  const tone = settled || job.state === 'Verified' ? 'verified' : job.state === 'Blocked' ? 'blocked' : 'pending';
  const label = settled ? 'Settled' : probe && job.state === 'Blocked' ? 'Blocked by policy' : {
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
    settlement,
    settled,
    probe,
    live: true,
  };
}

const challengeVerifierCommand = 'python3 apps/api/verify_bundle.py --evidence apps/api/tests/fixtures/cell-evidence.json --receipt apps/api/tests/fixtures/proofgate-receipt.json --cell-key apps/api/tests/fixtures/cell-evidence-public.pem --receipt-key apps/api/tests/fixtures/proofgate-receipt-public.pem --expect-tenant PG-67F9819A --input apps/api/tests/fixtures/input.txt --output apps/api/tests/fixtures/output.json --now 2026-11-09T10:09:57Z';
const challengeChecklist = [
  ['Public GitHub repository', 'Required before 14 Nov 2026 · 23:59 UTC'],
  ['Public X demo post + video', 'Say built at NEAR HACKATHON; tag @NEARProtocol and #NEARHackathon'],
  ['One final submission', 'After public links, confirmed Mainnet payout address, and approval of exact payload'],
];

const challengeProofSources = {
  challenge: 'https://github.com/MichaelS1011/Ephemora-ProofGate/blob/main/docs/CHALLENGE_STRATEGY.md',
  README: 'https://github.com/MichaelS1011/Ephemora-ProofGate/blob/main/README.md',
  verifier: 'https://github.com/MichaelS1011/Ephemora-ProofGate/blob/main/apps/api/verify_bundle.py',
  fixtures: 'https://github.com/MichaelS1011/Ephemora-ProofGate/tree/main/apps/api/tests/fixtures',
  offlineEvidence: 'https://github.com/MichaelS1011/Ephemora-ProofGate/blob/main/apps/api/tests/fixtures/cell-evidence.json',
  offlineReceipt: 'https://github.com/MichaelS1011/Ephemora-ProofGate/blob/main/apps/api/tests/fixtures/proofgate-receipt.json',
};

const pageCopy = {
  Overview: ['Execution overview', 'Review the run, its evidence, and the payment state in one place.'],
  Challenge: ['Challenge proof', 'A guided index of recorded Cell, verifier, and NEAR Testnet evidence.'],
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
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', focusable: 'false', 'aria-hidden': true };
  const paths = {
    grid: <><rect x="3.75" y="3.75" width="6.5" height="6.5" rx="1.8"/><rect x="13.75" y="3.75" width="6.5" height="6.5" rx="1.8"/><rect x="3.75" y="13.75" width="6.5" height="6.5" rx="1.8"/><rect x="13.75" y="13.75" width="6.5" height="6.5" rx="1.8"/></>,
    play: <><circle cx="12" cy="12" r="8.5"/><path d="m10 8.7 5.2 3.3-5.2 3.3z" fill="currentColor" stroke="none"/></>,
    receipt: <><path d="M6 3.5h12v17l-2.6-1.8-2.4 1.8-2.4-1.8L8 20.5 5.5 22V4a.5.5 0 0 1 .5-.5Z"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4.5"/></>,
    wallet: <><rect x="3.5" y="5.5" width="17" height="14" rx="3.5"/><path d="M3.8 9.5h16.7M16.1 14.5h.01"/><path d="M17 12.5h3.5v4H17a2 2 0 0 1 0-4Z"/></>,
    shield: <><path d="M12 3 19 5.8v5.1c0 4.1-2.6 7.6-7 10.1-4.4-2.5-7-6-7-10.1V5.8L12 3Z"/><path d="m9 12 2 2 4-4"/></>,
    settings: <><circle cx="12" cy="12" r="3.1"/><path d="M19.1 13.6a7.2 7.2 0 0 0 0-3.2l1.5-1.1-1.5-2.6-1.8.7a7.5 7.5 0 0 0-2.8-1.6L14.2 4h-2.8l-.3 1.8a7.5 7.5 0 0 0-2.8 1.6l-1.8-.7L5 9.3l1.5 1.1a7.2 7.2 0 0 0 0 3.2L5 14.7l1.5 2.6 1.8-.7a7.5 7.5 0 0 0 2.8 1.6l.3 1.8h2.8l.3-1.8a7.5 7.5 0 0 0 2.8-1.6l1.8.7 1.5-2.6-1.5-1.1Z"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.6"/><path d="m15.7 15.7 4 4"/></>,
    chevron: <><path d="m8 10 4 4 4-4"/></>,
    copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/></>,
    external: <><path d="M13 5h6v6M19 5l-8 8"/><path d="M18 13v4.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H11"/></>,
    check: <><path d="m5 12.5 4.1 4.1L19 6.7"/></>,
    alert: <><path d="m10.4 4.7-7 12.1A1.5 1.5 0 0 0 4.7 19h14.6a1.5 1.5 0 0 0 1.3-2.2l-7-12.1a1.8 1.8 0 0 0-3.2 0Z"/><path d="M12 9v4.2M12 16.2h.01"/></>,
    clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2.75v1.5m0 15.5v1.5M4.9 4.9l1.1 1.1m11.9 11.9 1.1 1.1M2.75 12h1.5m15.5 0h1.5M4.9 19.1l1.1-1.1m11.9-11.9 1.1-1.1"/></>,
    moon: <><path d="M19.2 15.2A8.5 8.5 0 0 1 8.8 4.8a8.5 8.5 0 1 0 10.4 10.4Z"/><path d="M15.8 4.8h.01"/></>,
    download: <><path d="M12 3.5v11m0 0 4-4m-4 4-4-4"/><path d="M4.5 16v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3"/></>,
    menu: <><path d="M4.5 7h15M4.5 12h15M4.5 17h15"/></>,
    lock: <><rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.4a4 4 0 0 1 8 0V10M12 14v3"/></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/></>,
  };
  return <svg {...common}>{paths[name] || paths.grid}</svg>;
}

function Mark() {
  return <svg className="brand-mark" viewBox="0 0 44 44" aria-hidden="true">
    <rect x="1" y="1" width="42" height="42" rx="14" fill="var(--accent-fill)"/>
    <path d="M22 9.5 33 14v7.7c0 6-4 10.9-11 14.3-7-3.4-11-8.3-11-14.3V14l11-4.5Z" fill="none" stroke="var(--on-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M22 10v25.4m-5.1-13.1 3.4 3.4 6.7-6.7" fill="none" stroke="var(--on-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}

function Badge({ tone = 'neutral', children, icon }) {
  return <span className={`badge badge-${tone}`}>{icon && <Icon name={icon} size={13} />}{children}</span>;
}

function StatusGlyph({ tone, illustrative = false }) {
  return <span className={`status-glyph ${illustrative ? 'glyph-demo' : `glyph-${tone}`}`} aria-hidden="true">{illustrative ? <Icon name="spark" size={12} /> : tone === 'verified' ? <Icon name="check" size={12} /> : tone === 'blocked' ? <Icon name="alert" size={12} /> : <Icon name="clock" size={12} />}</span>;
}

function displayJobStatus(job) {
  if (job?.live) return job.state;
  const status = job?.state || 'Status unavailable';
  return status.startsWith('Sample ·') ? status : `Sample · ${status}`;
}

function challengeDate(value) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(value));
}

function StageTrack({ state = 'verified' }) {
  const stages = ['Submitted', 'Sandboxed', 'Signed', 'Verified', 'Settled'];
  const active = state === 'sample' ? -1 : state === 'settled' ? 5 : state === 'verified' ? 3 : state === 'blocked' ? 1 : state === 'running' ? 1 : 0;
  return <ol className={`stage-track stage-${state}`} aria-label={state === 'sample' ? 'Illustrative execution stages, not a real run' : 'Execution stages'}>
    {stages.map((stage, i) => <li key={stage} className={i < active ? 'stage-done' : i === active && state === 'blocked' ? 'stage-failed' : i === active ? 'stage-current' : ''}>
      <span className="stage-dot">{i < active ? <Icon name="check" size={12} /> : i === active && state === 'blocked' ? <Icon name="alert" size={12} /> : state === 'sample' ? <Icon name="spark" size={11} /> : i + 1}</span>
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
  const [probeBusy, setProbeBusy] = useState(false);
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
  const jobActionLabel = connection.checking
    ? 'Checking local service…'
    : connectionLost ? 'API unavailable' : apiOnline ? 'Create protected job' : 'Create sample job';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a0d12' : '#f2ece1');
    localStorage.setItem('proofgate-theme', theme);
  }, [theme]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

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
    if (!selectedJob?.live || selectedJob.apiState !== 'Verified' || receiptBundles[selectedJob.id]) return undefined;
    let active = true;
    apiRequest('/jobs/' + encodeURIComponent(selectedJob.id) + '/receipt')
      .then((bundle) => {
        if (active) setReceiptBundles((current) => ({ ...current, [selectedJob.id]: bundle }));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [selectedJob?.id, selectedJob?.apiState, selectedJob?.live, receiptBundles]);

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

  async function runDeniedProbe() {
    if (connectionLost) {
      setNotice('The local API is unavailable. Reconnect it before running the probe.');
      return;
    }
    setProbeBusy(true);
    try {
      const result = await apiRequest('/probes/denied-network', { method: 'POST', body: '{}' });
      const job = mapApiJob(result.job);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setSelectedId(job.id);
      setPage('Execution ' + job.id);
      setNotice(result.job.error?.code === 'capability_denied'
        ? 'Cell denied the network attempt with ENOTSOCK. The probe is blocked.'
        : 'The denial probe finished.');
    } catch (error) {
      setNotice('Denial probe failed: ' + error.message);
      await refreshBackend();
    } finally {
      setProbeBusy(false);
    }
  }

  function navTo(label) {
    setPage(label);
    setSearch('');
  }

  function openNewJob(event) {
    if (connection.checking || connectionLost) return;
    if (event?.currentTarget) newJobReturnFocusRef.current = event.currentTarget;
    setShowNewJob(true);
  }

  return <div className="app-frame">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand-lockup"><Mark /><div><strong>Ephemora</strong><span>ProofGate</span></div></div>
      <div className="nav-caption">Workspace</div>
      <nav className="nav-list">
        {navItems.map(([label, icon]) => <button key={label} className={`nav-item ${page === label ? 'is-active' : ''}`} onClick={() => navTo(label)} aria-label={label} title={label} aria-current={page === label ? 'page' : undefined}>
          <Icon name={icon} size={18} /><span>{label}</span>{label === 'Security' && <span className="nav-pip" aria-hidden="true" />}
        </button>)}
      </nav>
      <div className="sidebar-spacer" />
      <div className={`sidebar-runtime ${apiOnline ? 'runtime-connected' : connectionLost ? 'runtime-unavailable' : 'runtime-preview'}`}>
        <span className="runtime-orb"><span /></span>
        <div><b>{apiOnline ? 'Local ProofGate' : recordsAreLocal ? 'Cached local records' : 'Preview mode'}</b><span>{cellReady ? 'Cell route ready' : connectionLost ? 'API unavailable' : 'Cell route unavailable'}</span></div>
        <span className="runtime-info" title="Evidence appears here only after the local service returns it" aria-hidden="true">i</span>
      </div>
      <div className="sidebar-footer"><span className="mini-lock"><Icon name="lock" size={13} /></span><span>Keys stay outside the workload</span></div>
    </aside>

    <main className="main-area" id="main-content" tabIndex="-1">
      <header className="topbar">
        <div className="mobile-brand"><Mark /><span>ProofGate</span></div>
        <div className="crumb"><span>Workspace</span><span className="crumb-slash">/</span><b>{page}</b></div>
        <div className="topbar-actions">
          <span className="network-pill"><span className={'network-dot ' + (nearStatus?.connected ? 'connected' : 'offline')} /><span className="network-name">NEAR</span><span className="network-state"> · {nearPillLabel}</span></span>
          <Badge tone={apiOnline ? 'neutral' : recordsAreLocal ? 'pending' : 'demo'}>{apiOnline ? 'Local only' : recordsAreLocal ? 'API unavailable' : 'Demo data'}</Badge>
          <button className="icon-button theme-button" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} appearance`} aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={17} /></button>
          <button className="avatar-button" aria-label="Local operator profile">E</button>
        </div>
      </header>

      <div className={'demo-banner ' + (apiOnline ? 'banner-local' : recordsAreLocal ? 'banner-unavailable' : 'banner-preview')} role="note"><span className="demo-spark" aria-hidden="true"><Icon name="spark" size={15}/></span><span>{connection.checking ? 'Checking local services' : apiOnline ? (cellReady ? 'Local Cell route ready' : 'ProofGate API online') : recordsAreLocal ? 'Local API unavailable · cached records' : 'Offline sample environment'}</span><span className="banner-divider" /><span>{connection.checking ? 'Checking runtime and stored jobs' : apiOnline ? (cellReady ? `${languageSummary || 'No reviewed guests available'} · evidence after a completed Cell run · ${nearPillLabel.replace('Testnet · read-only', 'NEAR Testnet RPC read-only')}` : 'Cell or local signing keys need setup') : recordsAreLocal ? 'Reconnect to refresh or execute · escrow contract remains offline' : 'Cell, verifier, and NEAR network are not connected'}</span><span className="banner-end">{apiOnline ? 'Local records' : recordsAreLocal ? 'Cached local records' : 'Sample values only'}</span></div>

      <section className="page-heading">
        <div>
          <p className="eyebrow">Protected compute</p>
          <h1>{copy[0]}</h1>
          <p className="page-subtitle">{copy[1]}</p>
        </div>
        <div className="heading-actions">
          {page !== 'Challenge' && <button className="button button-secondary" onClick={() => recordsAreLocal ? refreshBackend(true) : setNotice('Sample data is already current.')}>{recordsAreLocal ? apiOnline ? 'Refresh' : 'Reconnect' : 'Refresh sample'}</button>}
          {page !== 'Challenge' && !connectionLost && <button
            className="button button-primary"
            onClick={openNewJob}
            disabled={connection.checking}
            aria-describedby={connection.checking ? 'job-action-guidance' : undefined}
          ><Icon name={apiOnline ? 'plus' : 'spark'} size={17} />{jobActionLabel}</button>}
        </div>
      </section>
      {connectionLost && <p className="job-action-guidance" id="job-action-guidance" role="status">The local ProofGate API is unavailable. Reconnect before creating or running jobs.</p>}

      {page === 'Overview' && <Overview jobs={jobs} apiOnline={apiOnline} recordsAreLocal={recordsAreLocal} connectionLost={connectionLost} cellReady={cellReady} onOpenJob={openJob} onNewJob={openNewJob} onReconnect={() => refreshBackend(true)} onNavigate={navTo} />}
      {page === 'Executions' && <Executions jobs={filteredJobs} apiOnline={apiOnline} recordsAreLocal={recordsAreLocal} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} onOpenJob={openJob} />}
      {page === 'Receipts' && <Receipts jobs={jobs} selectedJob={selectedJob} receiptBundle={selectedJob ? receiptBundles[selectedJob.id] : null} apiOnline={apiOnline} recordsAreLocal={recordsAreLocal} onOpenJob={openJob} onCopy={copyReceipt} onDownload={downloadReceipt} />}
      {page === 'Settlements' && <Settlements jobs={jobs} apiOnline={apiOnline} recordsAreLocal={recordsAreLocal} onOpenJob={openJob} />}
      {page === 'Security' && <Security connection={connection} jobs={jobs} onRunProbe={runDeniedProbe} probeBusy={probeBusy} onOpenJob={openJob} />}
      {page === 'Challenge' && <ChallengeProof onNavigate={navTo} />}
      {page === 'Settings' && <Settings theme={theme} setTheme={setTheme} connection={connection} nearStatus={nearStatus} checkingNear={checkingNear} onCheckNearStatus={checkNearStatus} jobs={jobs} />}
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

function Overview({ jobs, apiOnline, recordsAreLocal, connectionLost, cellReady, onOpenJob, onNewJob, onReconnect, onNavigate }) {
  const featured = jobs.find((job) => job.live && (job.settled || job.apiState === 'Verified')) || jobs[0];
  const anySettled = jobs.some((job) => job.settled);
  return <div className="content-stack">
    {!recordsAreLocal && <div className="sample-disclosure" role="note"><Icon name="spark" size={15}/><span><b>Illustrative samples</b> · These browser-only examples are not Cell runs, verifier results, or NEAR transactions.</span></div>}
    <section className="journey-panel">
      <div className="journey-intro">
        <div><span className="section-kicker">The ProofGate journey</span><h2>Policy first. Payment last.</h2><p>Each stage leaves evidence. A successful run and a confirmed payment are different events.</p></div>
        <span className="journey-seal" aria-hidden="true"><Icon name="shield" size={28}/></span>
      </div>
      <div className="journey-rail" role="group" aria-label="Policy to settlement flow">
        <div className="journey-node node-policy"><span className="journey-icon"><Icon name="shield" size={18}/></span><div><b>Policy</b><small>Set allowed work</small></div></div><span className="journey-link"><i/></span>
        <div className="journey-node node-run"><span className="journey-icon"><Icon name="play" size={18}/></span><div><b>Execute</b><small>Cell boundary</small></div></div><span className="journey-link"><i/></span>
        <div className="journey-node node-evidence"><span className="journey-icon"><Icon name="receipt" size={18}/></span><div><b>Verify</b><small>Inspect evidence</small></div></div><span className="journey-link"><i/></span>
        <div className="journey-node node-payment"><span className="journey-icon"><Icon name="wallet" size={18}/></span><div><b>Settle</b><small>Confirm on NEAR</small></div></div>
      </div>
      <div className="journey-foot"><span><span className="tiny-ring"/>Policy checks happen outside the untrusted workload</span><button className="text-link" onClick={() => onNavigate('Security')}>Review security model <Icon name="arrow" size={14}/></button></div>
    </section>

    <div className="overview-grid">
      <section className="panel execution-panel">
        <div className="panel-heading"><div><span className="section-kicker">{recordsAreLocal ? 'Latest local job' : 'Latest sample'}</span><h2>Execution chain</h2></div><Badge tone={recordsAreLocal ? 'neutral' : 'demo'} icon={recordsAreLocal ? undefined : 'spark'}>{recordsAreLocal ? 'Local record' : 'Sample data'}</Badge></div>
        {featured ? <>
          <div className="featured-job-line"><div className="job-monogram"><Icon name="receipt" size={18}/></div><div className="featured-job-name"><b>{featured.name}</b><span>{featured.id} <span className="inline-dot">·</span> {featured.agent}</span></div><Badge tone={featured.live ? (featured.settled ? 'chain' : featured.tone) : 'demo'} icon={featured.live ? featured.tone === 'verified' ? 'check' : featured.tone === 'blocked' ? 'alert' : 'clock' : 'spark'}>{displayJobStatus(featured)}</Badge></div>
          <StageTrack state={!featured.live ? 'sample' : featured.settled ? 'settled' : featured.tone === 'blocked' ? 'blocked' : featured.tone === 'pending' ? 'pending' : 'verified'} />
          <div className="chain-summary">
            <div><span>{featured.live ? 'Receipt reference' : 'Sample reference'}</span><b className="mono">{featured.receipt}</b></div>
            <div><span>{featured.live ? 'Reward' : 'Illustrative reward'}</span><b>{featured.amount} <small>NEAR</small></b></div>
            <div><span>Settlement</span><b className={featured.settled ? 'settlement-done' : 'settlement-wait'}>{featured.settled && <span className="small-state-dot"/>}{featured.settled ? 'Settled · confirmed' : featured.live ? 'Not confirmed' : 'Not applicable · sample'}</b></div>
          </div>
          <div className="panel-actions"><button className="button button-secondary" onClick={() => onOpenJob(featured)}>Inspect {featured.live ? 'job' : 'sample'} details <Icon name="arrow" size={15}/></button><span className="micro-note">{featured.settled ? 'Settlement recorded from the local escrow bridge.' : 'No NEAR transaction is connected.'}</span></div>
        </> : <div className="empty-state compact-empty"><span className="empty-glyph"><Icon name="play" size={19}/></span><b>No jobs yet</b><p>{connectionLost ? 'Reconnect the local API before creating a job.' : apiOnline ? 'Create a job and choose a reviewed language guest.' : 'Add an illustrative sample. It will not run in Cell or move NEAR funds.'}</p><button className="button button-primary" onClick={connectionLost ? onReconnect : onNewJob}><Icon name={connectionLost ? 'clock' : apiOnline ? 'plus' : 'spark'} size={15}/>{connectionLost ? 'Reconnect to continue' : apiOnline ? 'Create a protected job' : 'Create a sample job'}</button></div>}
      </section>

      <section className="panel policy-panel">
        <div className="panel-heading"><div><span className="section-kicker">{apiOnline && cellReady ? 'Declared before run' : 'Illustrative policy'}</span><h2>{apiOnline && cellReady ? 'Current policy' : 'Policy preview'}</h2></div><span className="panel-icon"><Icon name="lock" size={16}/></span></div>
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
      <div className="panel-heading activity-heading"><div><span className="section-kicker">{recordsAreLocal ? 'Local records' : 'Illustrative sample records'}</span><h2>Recent executions</h2></div><button className="text-link" onClick={() => onNavigate('Executions')}>All executions <Icon name="arrow" size={14}/></button></div>
      <div className="records-table-wrap"><table className="records-table"><thead><tr><th>Job</th><th>Agent</th><th>Status</th><th>Reward</th><th>Updated</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>
        {jobs.slice(0, 3).map((job) => <tr key={job.id}>
          <td><span className="job-id">{job.id}</span><b>{job.name}</b></td><td data-label="Agent">{job.agent}</td><td data-label="Status"><Badge tone={job.live ? (job.settled ? 'chain' : job.tone) : 'demo'} icon={job.live ? job.tone === 'verified' ? 'check' : job.tone === 'blocked' ? 'alert' : 'clock' : 'spark'}>{displayJobStatus(job)}</Badge></td><td data-label="Reward">{job.amount} NEAR</td><td data-label="Updated">{job.time}</td><td><button type="button" className="row-open" aria-label={`Open job ${job.id}: ${job.name}`} onClick={() => onOpenJob(job)}><Icon name="arrow" size={16}/></button></td>
        </tr>)}
      </tbody></table></div>
    </section>

    <section className="demo-explainer"><span className="demo-explainer-icon"><Icon name="lock" size={16}/></span><div><b>{anySettled ? 'Settlement is a separate, chain-confirmed event' : recordsAreLocal ? 'NEAR payout is not connected' : 'This is a visual preview · sample data only'}</b><p>{anySettled ? 'A settlement record appears only after the local escrow bridge reports the transfer as final. Verified evidence alone never moves funds.' : apiOnline ? 'Cell evidence can be generated locally. Settlement stays unpaid until an authorized NEAR escrow release is confirmed.' : recordsAreLocal ? 'These are saved local records. Reconnect the ProofGate API before creating or running another job.' : 'Sample values and receipt references are fictional. Start the local API to create signed Cell evidence.'}</p></div><button className="text-link" onClick={onNewJob}>Create {recordsAreLocal ? 'a protected job' : 'a local sample job'} <Icon name="arrow" size={14}/></button></section>
  </div>;
}

function Executions({ jobs, apiOnline, recordsAreLocal, search, setSearch, filter, setFilter, onOpenJob }) {
  return <div className="content-stack">
    <section className="panel list-panel">
      <div className="list-controls"><label className="search-field"><Icon name="search" size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={recordsAreLocal ? 'Search local jobs' : 'Search sample jobs'} aria-label={recordsAreLocal ? 'Search local jobs' : 'Search sample jobs'}/></label>
        <label className="select-wrap"><span className="sr-only">Filter jobs</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">{recordsAreLocal ? 'All jobs' : 'All sample jobs'}</option><option value="verified">Verified</option><option value="blocked">Blocked</option><option value="pending">Pending</option></select><Icon name="chevron" size={15}/></label>
      </div>
      {jobs.length ? <div className="records-table-wrap"><table className="records-table full-table"><thead><tr><th>Job</th><th>Agent</th><th>Status</th><th>Reward</th><th>Updated</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><span className="job-id">{job.id}</span><b>{job.name}</b></td><td data-label="Agent">{job.agent}</td><td data-label="Status"><Badge tone={job.live ? (job.settled ? 'chain' : job.tone) : 'demo'} icon={!job.live ? 'spark' : undefined}>{displayJobStatus(job)}</Badge></td><td data-label="Reward">{job.amount} NEAR</td><td data-label="Updated">{job.time}</td><td><button type="button" className="row-open" onClick={() => onOpenJob(job)} aria-label={`Open job ${job.id}: ${job.name}`}><Icon name="arrow" size={16}/></button></td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-glyph"><Icon name="search" size={19}/></span><b>{recordsAreLocal ? 'No jobs match' : 'No sample jobs match'}</b><p>{recordsAreLocal ? 'Create a job or change the search filters.' : 'Try a different search or filter.'}</p></div>}
      <div className="table-foot"><Badge tone={recordsAreLocal ? 'neutral' : 'demo'}>{recordsAreLocal ? 'Local records' : 'Demo data'}</Badge><span>{jobs.length} {recordsAreLocal ? 'saved jobs' : 'illustrative records'}</span></div>
    </section>
  </div>;
}

function ExecutionDetail({ job, receiptBundle, cellReady, busy, onRun, onCopy, onDownload, onNavigate }) {
  const isBlocked = job.live && job.tone === 'blocked';
  const settlement = job.settlement && typeof job.settlement === 'object' ? job.settlement : null;
  const settled = job.settled === true && settlement?.status === 'Paid';
  const probe = job.probe === true;
  const verified = job.live && job.apiState === 'Verified';
  const ready = job.apiState === 'Ready';
  const receipt = receiptBundle?.receipt?.payload;
  const signature = receiptBundle?.receipt?.signatures?.[0];
  const explorer = settlement?.network === 'testnet' && settlement.txHash ? `https://explorer.testnet.near.org/transactions/${settlement.txHash}` : null;
  const stage = settled ? 'settled' : isBlocked ? 'blocked' : verified ? 'verified' : job.apiState === 'Executing' ? 'running' : 'pending';
  const outcomeTitle = probe ? 'Network attempt denied' : settled ? 'Settled · payment confirmed' : verified ? 'Evidence verified · payment not made' : isBlocked ? 'Execution blocked' : job.live ? (ready ? 'Ready for a Cell run' : 'Execution in progress') : 'No payment has been confirmed';
  const outcomeText = probe
    ? 'The reviewed guest attempted a network socket. Cell returned ENOTSOCK; /sandbox was the only preopen. The job is blocked and cannot be settled.'
    : settled
      ? `The escrow contract confirmed the transfer to ${settlement.beneficiary}. The signed receipt remains the execution record; settlement is a separate event.`
      : verified
      ? 'Cell signed the execution report. ProofGate checked the signature, job binding, freshness, policy limits, output, and replay state.'
      : isBlocked ? (job.error?.message || 'The verifier rejected this execution.')
        : job.live ? 'This local job has not produced accepted Cell evidence yet.'
          : 'This sample has no verified Cell receipt or NEAR transaction behind it.';
  const digest = (name) => receipt?.[name] || (verified ? 'Not present in receipt' : probe ? 'Not issued for this probe' : 'Generated after a verified run');

  return <div className="content-stack">
    <section className="panel detail-hero">
      <div className="detail-title-row"><div><button className="back-link" onClick={() => onNavigate('Executions')}>← All executions</button><div className="detail-id-line"><span className="detail-id">{job.id}</span><Badge tone={job.live ? 'neutral' : 'demo'}>{job.live ? 'Local record' : 'Sample record'}</Badge></div><h2>{job.name}</h2><p>{job.agent} <span className="inline-dot">·</span> {job.live ? `${job.languageLabel} · ${runtimeLabel(job)}` : 'Sample runtime profile'}</p></div><Badge tone={job.live ? (job.settled ? 'chain' : job.tone) : 'demo'} icon={job.live ? isBlocked ? 'alert' : verified ? 'check' : 'clock' : 'spark'}>{displayJobStatus(job)}</Badge></div>
      <StageTrack state={!job.live ? 'sample' : stage} />
      <div className={'detail-outcome ' + (isBlocked ? 'outcome-blocked' : verified ? 'outcome-verified' : 'outcome-neutral')}><span className="outcome-icon"><Icon name={!job.live ? 'spark' : isBlocked ? 'alert' : verified ? 'check' : 'clock'} size={17}/></span><div><b>{job.live ? outcomeTitle : 'Sample scenario · not executed'}</b><p>{outcomeText}</p></div></div>
      {job.live && ready && <div className="run-action"><button className="button button-primary" onClick={onRun} disabled={!cellReady || busy} aria-busy={busy}><Icon name={busy ? 'clock' : 'play'} size={15}/>{busy ? 'Running in Cell…' : 'Run in Ephemora Cell'}</button><span>{cellReady ? 'Uses the reviewed ' + job.languageLabel + ' guest and current Cell limits.' : 'Cell and local signing keys must be ready before execution.'}</span></div>}
      {job.live && job.input && <div className="job-input"><span className="section-kicker">Job input · {new TextEncoder().encode(job.input).length} bytes</span><code>{job.input}</code></div>}
      {verified && job.output && <div className="job-output"><span className="section-kicker">Verified output</span><pre>{JSON.stringify(job.output, null, 2)}</pre></div>}
    </section>
    <div className="detail-grid">
      <section className="panel evidence-panel"><div className="panel-heading"><div><span className="section-kicker">{verified ? 'Signed ProofGate receipt' : 'Evidence status'}</span><h2>Execution evidence</h2></div><Badge tone={verified ? 'verified' : 'demo'} icon={!verified ? 'spark' : 'check'}>{verified ? 'Verified' : job.live ? 'Not issued' : 'Sample · not signed'}</Badge></div><dl className="evidence-list">
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
      {probe ? <section className="panel settlement-panel"><div className="panel-heading"><div><span className="section-kicker">Policy outcome</span><h2>Capability check</h2></div><span className="settlement-lock"><Icon name="shield" size={16}/></span></div><div className="settlement-row"><span>Attempted</span><b>Network socket</b></div><div className="settlement-row"><span>Cell result</span><b>{job.output?.wasiErrno || 'ENOTSOCK'}</b></div><div className="settlement-row"><span>Preopens</span><b className="mono">{Array.isArray(job.output?.preopens) ? job.output.preopens.join(', ') : '/sandbox'}</b></div><div className="settlement-row"><span>Cell report</span><b className="mono">{job.reportId || 'Not issued'}</b></div><div className="settlement-disclosure"><Icon name="alert" size={15}/><span>A denied capability cannot authorize a payment. This probe is not a paid job.</span></div></section> :       <section className="panel settlement-panel"><div className="panel-heading"><div><span className="section-kicker">Payment state</span><h2>Settlement</h2></div><span className={settled ? 'settlement-lock is-settled' : 'settlement-lock'}><Icon name={settled ? 'check' : 'lock'} size={16}/></span></div><div className="amount-display"><span>{settled ? 'Settled amount' : 'Proposed reward'}</span><b>{job.amount} <small>NEAR</small></b></div>{settlement ? <><div className="settlement-row"><span>Network</span><b>{settlement.network === 'testnet' ? 'NEAR Testnet' : 'NEAR sandbox'} <Badge tone="chain">Confirmed</Badge></b></div><div className="settlement-row"><span>Beneficiary</span><b>{settlement.beneficiary}</b></div><div className="settlement-row"><span>Contract</span><b className="mono">{settlement.contractId}</b></div><div className="settlement-row"><span>Receipt digest</span><b className="mono">{settlement.receiptDigest}</b></div><div className="settlement-row"><span>Transaction</span><b className="mono">{explorer ? <a href={explorer} target="_blank" rel="noreferrer">{settlement.txHash}</a> : settlement.txHash}</b></div><div className="settlement-disclosure settlement-confirmed"><Icon name="check" size={15}/><span>Stored from the local bridge's final-transfer report; this interface does not independently verify chain state.</span></div></> : <><div className="settlement-row"><span>Network</span><b>NEAR Testnet <Badge tone="demo">Offline</Badge></b></div><div className="settlement-row"><span>Beneficiary</span><b>{job.beneficiary || 'sample-agent.testnet'}</b></div><div className="settlement-row"><span>Contract</span><b>Not connected</b></div><div className="settlement-row"><span>Transaction</span><b>No transaction</b></div><div className="settlement-disclosure"><Icon name="alert" size={15}/><span>{verified ? 'The receipt is verified, but no escrow transfer is recorded yet.' : 'A verified receipt alone does not move funds. No escrow transfer is recorded for this job.'}</span></div></>}</section>}
    </div>
    <section className="panel log-panel"><div className="panel-heading"><div><span className="section-kicker">{job.live ? 'Local event log' : 'Illustrative sequence · not an event log'}</span><h2>What happened</h2></div><Badge tone={job.live ? 'neutral' : 'demo'} icon={job.live ? undefined : 'spark'}>{job.live ? 'Local record' : 'Illustrative'}</Badge></div><ol className="event-list"><li><span className="event-marker event-blue"/><time>01</time><div><b>Job submitted</b><p>{job.live ? job.languageLabel + ' workload and policy stored locally.' : 'Illustrative sample · no workload submitted.'}</p></div></li>{verified ? <li><span className="event-marker event-green"/><time>02</time><div><b>Cell evidence verified</b><p>Cell signature, tenant, runtime policy, output, freshness, and single-use report checks passed.</p></div></li> : isBlocked ? <li><span className="event-marker event-red"/><time>02</time><div><b>Run blocked</b><p>{job.error?.message || 'The verifier did not accept the run.'}</p></div></li> : <li><span className="event-marker event-violet"/><time>02</time><div><b>{job.live ? 'Waiting for Cell run' : 'Illustrative · not executed'}</b><p>{job.live ? 'No execution report has been accepted for this job.' : 'The displayed state is not a verifier result.'}</p></div></li>}</ol></section>
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
    <section className="panel receipt-layout"><div className="receipt-job-list"><div className="panel-heading"><div><span className="section-kicker">{recordsAreLocal ? 'Local records' : 'Illustrative samples'}</span><h2>Receipts</h2></div><Badge tone={recordsAreLocal ? 'neutral' : 'demo'}>{jobs.length} {recordsAreLocal ? 'jobs' : 'samples'}</Badge></div>
      {jobs.map((job) => <button className={'receipt-job ' + (focused && job.id === focused.id ? 'selected' : '')} key={job.id} onClick={() => onOpenJob(job)}><span className="receipt-job-mark"><Icon name="receipt" size={16}/></span><span className="receipt-job-copy"><b>{job.id}</b><small>{job.name}</small></span><StatusGlyph tone={job.tone} illustrative={!job.live}/></button>)}
      {!jobs.length && <div className="empty-state compact-empty"><b>No jobs yet</b><p>Create a protected job to start.</p></div>}
    </div>
      {focused ? <div className="receipt-inspector"><div className="inspector-heading"><div><span className="section-kicker">{verified ? 'Verified receipt' : focused.live ? 'Local job' : 'Illustrative sample'}</span><h2>{focused.id}</h2></div><Badge tone={verified ? 'verified' : focused.live ? 'pending' : 'demo'} icon={focused.live ? undefined : 'spark'}>{verified ? 'Verified' : focused.live ? 'No receipt yet' : 'Sample · not verified'}</Badge></div>
        <div className="fingerprint-box"><span>{verified ? 'Cell report' : 'Receipt reference'}</span><code>{focused.reportId || focused.receipt}</code><button className="icon-button" onClick={onCopy} disabled={focused.live && !verified} aria-label="Copy selected receipt"><Icon name="copy" size={15}/></button></div>
        {verified && <div className="evidence-list receipt-facts"><div><dt>Source language</dt><dd>{focused.languageLabel || focused.language}</dd></div><div><dt>ABI / runtime profile</dt><dd>{runtimeLabel(focused)}</dd></div><div><dt>Program digest</dt><dd className="mono">{signedReceipt?.payload?.programDigest || 'Bound in signed receipt'}</dd></div><div><dt>ProofGate signer</dt><dd className="mono">{signature?.keyId || 'Available in downloaded receipt'}</dd></div></div>}
        <div className="check-list"><CheckRow label="Cell evidence schema accepted" state={checks} text={verified ? 'Passed' : 'Not checked'}/><CheckRow label="Cell signature matches trusted key" state={checks} text={verified ? 'Passed' : 'Not checked'}/><CheckRow label="Job, tenant, and policy bindings match" state={checks} text={verified ? 'Passed' : 'Not checked'}/><CheckRow label="Fresh, single-use report" state={checks} text={verified ? 'Passed' : 'Not checked'}/><CheckRow label="Output matches expected result" state={checks} text={verified ? 'Passed' : 'Not checked'}/></div>
        <div className="inspector-actions"><button className="button button-secondary" onClick={onDownload} disabled={focused.live && !verified}><Icon name="download" size={15}/>{verified ? 'Download signed evidence' : focused.live ? 'Receipt not issued' : 'Download sample JSON'}</button><span>{verified ? 'Payment remains unpaid.' : focused.live ? 'Verification requires a Cell run.' : 'Illustrative data · not verified.'}</span></div>
      </div> : <div className="empty-state"><b>Select a job</b><p>Receipt details will appear here.</p></div>}
    </section>
  </div>;
}

function CheckRow({ label, state, text }) {
  return <div className="check-row"><span className={`check-symbol check-${state}`}>{state === 'pass' ? <Icon name="check" size={12}/> : state === 'fail' ? <Icon name="alert" size={12}/> : <span>—</span>}</span><span>{label}</span><b>{text}</b></div>;
}

function Settlements({ jobs, apiOnline, recordsAreLocal, onOpenJob }) {
  const hasSettlements = jobs.some((job) => job.settlement && typeof job.settlement === 'object');
  return <div className="content-stack"><div className="settlement-banner"><div className="banner-icon"><Icon name="wallet" size={19}/></div><div><b>{hasSettlements ? 'Confirmed settlement records' : recordsAreLocal ? 'No settlement recorded' : 'Illustrative payment scenarios'}</b><p>{hasSettlements ? 'A settlement appears here only after the local escrow bridge reports the transfer as final. Verification and settlement remain separate.' : recordsAreLocal ? 'Cell receipts can be verified locally, but no escrow balance or transaction exists.' : 'These sample rewards and statuses are illustrative only. No Testnet transaction or escrow balance is connected.'}</p></div><Badge tone={hasSettlements ? 'chain' : 'demo'} icon={hasSettlements ? 'check' : 'spark'}>{hasSettlements ? 'Chain-confirmed' : recordsAreLocal ? 'No settlement' : 'Sample data'}</Badge></div><section className="panel list-panel"><div className="panel-heading"><div><span className="section-kicker">{recordsAreLocal ? 'Settlement records' : 'Sample payment records'}</span><h2>Settlement activity</h2></div></div>{jobs.length ? <div className="records-table-wrap"><table className="records-table full-table"><thead><tr><th>Job</th><th>Beneficiary</th><th>Amount</th><th>Payment state</th><th>Transaction</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{jobs.map((job) => {
    const settlement = job.settlement && typeof job.settlement === 'object' ? job.settlement : null;
    const explorer = settlement?.network === 'testnet' && settlement.txHash ? `https://explorer.testnet.near.org/transactions/${settlement.txHash}` : null;
    return <tr key={job.id}><td><span className="job-id">{job.id}</span><b>{job.name}</b></td><td data-label="Beneficiary">{job.beneficiary || 'sample-agent.testnet'}</td><td data-label="Amount">{job.amount} NEAR</td><td data-label="Payment state"><Badge tone={!job.live ? 'demo' : job.settled ? 'chain' : job.tone === 'verified' ? 'pending' : job.tone} icon={!job.live ? 'spark' : job.settled ? 'check' : undefined}>{!job.live ? 'Sample · illustrative only' : job.settled ? 'Settled' : job.tone === 'verified' ? 'Verified · unpaid' : job.tone === 'blocked' ? 'Payout blocked' : 'Not funded'}</Badge></td><td data-label="Transaction" className="muted-cell">{settlement ? (explorer ? <a href={explorer} target="_blank" rel="noreferrer">{settlement.txHash.slice(0, 12)}…</a> : `Sandbox · ${settlement.txHash.slice(0, 12)}…`) : job.live ? 'No transaction' : 'Sample · no transaction'}</td><td><button type="button" className="row-open" aria-label={`Open job ${job.id}: ${job.name}`} onClick={() => onOpenJob(job)}><Icon name="arrow" size={16}/></button></td></tr>;
  })}</tbody></table></div> : <div className="empty-state"><span className="empty-glyph"><Icon name="wallet" size={19}/></span><b>No proposed payments</b><p>Each job will remain unpaid until a NEAR escrow release is confirmed.</p></div>}</section><p className="settlement-footnote"><Icon name="alert" size={15}/>{hasSettlements ? 'Settled is shown only from a recorded, final bridge result.' : recordsAreLocal ? 'A job remains unpaid until the escrow bridge records a final transfer.' : 'Sample data does not represent a funded job or real payment state.'}</p></div>;
}

function ChallengeProof({ onNavigate }) {
  const transactions = [
    { label: 'Create escrow job', id: '9CKcAHi2jVLwrV8ABiR36PcXcz9YLRg3A2nsNXc9sa5T' },
    { label: 'Release after verified receipt', id: '2uWSy1DKhvuBnM5QchW9fPKek6V7rLH8Rhpw2tuoMQaK' },
    { label: 'Separate contract flow · expiry refund', id: '2ugVw8PFo2t9gr3rvwz1UThbJcVpjHsEKKASSA3w1Ua6' },
  ];
  return <div className="content-stack challenge-proof">
    <section className="challenge-proof-banner">
      <span className="challenge-proof-icon"><Icon name="receipt" size={21}/></span>
      <div><b>Recorded evidence, not a live connection</b><p>These events were recorded on NEAR Testnet on 9 November 2026. This screen reads no wallet, does not query the chain, and cannot initiate a transaction.</p></div>
      <Badge tone="neutral" icon="clock">Evidence dated 9 Nov 2026</Badge>
    </section>

    <section className="challenge-proof-flow" aria-label="Recorded ProofGate execution and settlement evidence">
      <article className="panel challenge-step">
        <div className="challenge-step-marker"><span>1</span></div>
        <div className="challenge-step-body">
          <div className="challenge-step-heading"><div><span className="section-kicker">Successful execution · PG-16EA8CE4</span><h2>Cell ran the reviewed Rust workload</h2></div><Badge tone="neutral">Testnet-linked job</Badge></div>
          <p>The recorded output was <code>{'{"normalized":"proofgate settles on testnet","wordCount":4}'}</code>. Cell report <code>a8af9e3b6ad34ed9930873dac4a8b24d</code>. The job was verified but still unpaid at this point.</p>
          <dl className="challenge-facts"><div><dt>Job created · UTC</dt><dd><time dateTime="2026-11-09T10:56:51.019Z">9 Nov 2026, 10:56:51 UTC</time></dd></div><div><dt>Policy digest</dt><dd className="mono">4afb7f6acf128b393264a15b1140cbc3732b8e0d186ef8894535fac2010c2748</dd></div><div><dt>Runtime</dt><dd>Rust · WASI Preview1 · agent-readonly</dd></div></dl>
          <a className="text-link" href={challengeProofSources.README} target="_blank" rel="noreferrer">Project record and demo evidence <Icon name="external" size={14}/></a>
        </div>
      </article>

    </section>

    <section className="challenge-probe-section" aria-labelledby="challenge-probe-title">
      <div className="challenge-probe-heading"><div><span className="section-kicker">Separate failure-path evidence · recorded later</span><h2 id="challenge-probe-title">Network denial probe</h2></div><Badge tone="blocked" icon="alert">Blocked · no payment</Badge></div>
      <article className="panel challenge-step challenge-probe-card">
        <div className="challenge-step-body">
          <div className="challenge-step-heading"><div><span className="section-kicker">Probe PG-C57DEC37</span><h2>Cell denied a network socket</h2></div></div>
          <p>This was a separate, later run—not part of the paid job. Cell returned <code>ENOTSOCK</code>, with <code>/sandbox</code> as the only preopen. ProofGate recorded <code>capability_denied</code>; no receipt or payment was created for the probe.</p>
          <dl className="challenge-facts"><div><dt>Probe recorded · UTC</dt><dd><time dateTime="2026-11-09T12:03:55.142Z">9 Nov 2026, 12:03:55 UTC</time></dd></div><div><dt>Cell report</dt><dd className="mono">787c6d1e85b74c63ad9e5f67f8380d82</dd></div><div><dt>Recorded result</dt><dd>ENOTSOCK · /sandbox only</dd></div></dl>
          <a className="text-link" href={challengeProofSources.challenge} target="_blank" rel="noreferrer">Probe and trust-boundary record <Icon name="external" size={14}/></a>
        </div>
      </article>
    </section>

    <section className="challenge-proof-flow" aria-label="Receipt and settlement evidence"><article className="panel challenge-step">
        <div className="challenge-step-marker"><span>2</span></div>
        <div className="challenge-step-body">
          <div className="challenge-step-heading"><div><span className="section-kicker">Signed ProofGate receipt</span><h2>Evidence bound to the job and beneficiary</h2></div><Badge tone="verified" icon="check">Verified · not paid</Badge></div>
          <p>The signed receipt records “verified; not paid.” Its digest was later supplied to the escrow flow; evidence verification and payment remained separate decisions.</p>
          <dl className="challenge-facts"><div><dt>Receipt issued · UTC</dt><dd><time dateTime="2026-11-09T10:56:51.378Z">9 Nov 2026, 10:56:51 UTC</time></dd></div><div><dt>Receipt digest</dt><dd className="mono">sha256:d31e510a8d949fb5f9ae212805873b5b0caf8a8a7c200e1f6b1eeaa732b1a25a</dd></div><div><dt>Beneficiary</dt><dd className="mono">beneficiary.proofgate-mw952xad.testnet</dd></div></dl>
          <p className="challenge-caveat"><Icon name="alert" size={14}/>The Testnet receipt bundle is in ignored local state, not included in the public checkout. The clean-checkout verifier fixture below is a separate reproducibility example (tenant PG-67F9819A), not this Testnet receipt.</p>
        </div>
      </article>

      <article className="panel challenge-step">
        <div className="challenge-step-marker"><span>4</span></div>
        <div className="challenge-step-body">
          <div className="challenge-step-heading"><div><span className="section-kicker">NEAR Testnet settlement</span><h2>The verifier-approved job settled once</h2></div><Badge tone="chain" icon="check">Paid · confirmed</Badge></div>
          <p>On Testnet, the escrow contract paid <strong>0.10 NEAR</strong> to the recorded beneficiary. This is testnet-only evidence—not a Mainnet payment. The transaction explorer is the independent chain reference.</p>
          <dl className="challenge-facts"><div><dt>Settlement recorded · UTC</dt><dd><time dateTime="2026-11-09T10:57:06.670Z">9 Nov 2026, 10:57:06 UTC</time></dd></div><div><dt>Escrow contract</dt><dd className="mono">escrow-mw956wm0.proofgate-mw952xad.testnet</dd></div><div><dt>Network</dt><dd>NEAR Testnet · 0.10 NEAR</dd></div></dl>
          <div className="challenge-link-row">
            <a className="button button-secondary" href="https://explorer.testnet.near.org/transactions/2uWSy1DKhvuBnM5QchW9fPKek6V7rLH8Rhpw2tuoMQaK" target="_blank" rel="noreferrer">Open paid transaction <Icon name="external" size={14}/></a>
            <a className="text-link" href={challengeProofSources.challenge} target="_blank" rel="noreferrer">Create, release, and refund records <Icon name="external" size={14}/></a>
          </div>
          <div className="challenge-tx-list">{transactions.map((transaction) => <div key={transaction.id}><span>{transaction.label}</span><a href={`https://explorer.testnet.near.org/transactions/${transaction.id}`} target="_blank" rel="noreferrer">{transaction.id.slice(0, 12)}… <Icon name="external" size={13}/></a></div>)}</div>
        </div>
      </article>
    </section>

    <section className="panel challenge-repro-panel">
      <div className="panel-heading"><div><span className="section-kicker">Independent reproducibility</span><h2>Verify the clean-checkout fixture offline</h2></div><Badge tone="verified" icon="check">Recorded check · 9 Nov 2026</Badge></div>
      <p>This command checks a committed Cell evidence / ProofGate receipt fixture without Cell or NEAR access. It is deliberately separate from the private Testnet receipt bundle shown above.</p>
      <details className="challenge-command"><summary>Show verifier command</summary><code>{challengeVerifierCommand}</code></details>
      <div className="challenge-link-row"><a className="text-link" href={challengeProofSources.verifier} target="_blank" rel="noreferrer">Offline verifier source <Icon name="external" size={14}/></a><a className="text-link" href={challengeProofSources.offlineEvidence} target="_blank" rel="noreferrer">Open committed evidence fixture <Icon name="external" size={14}/></a><a className="text-link" href={challengeProofSources.offlineReceipt} target="_blank" rel="noreferrer">Open committed receipt fixture <Icon name="external" size={14}/></a></div>
    </section>

    <section className="challenge-proof-footer"><Icon name="lock" size={16}/><p>No Mainnet key, live wallet, payout action, or submission is exposed here.</p><button className="text-link" onClick={() => onNavigate('Security')}>Review security boundaries <Icon name="arrow" size={14}/></button></section>
  </div>;
}

function Security({ connection, jobs, onRunProbe, probeBusy, onOpenJob }) {
  const apiOnline = connection.apiReachable === true;
  const cellReady = connection.connected === true;
  const lastProbe = jobs.find((job) => job.probe) || null;
  return <div className="content-stack">
    <section className="security-hero"><div className="security-shield"><Icon name="shield" size={24}/></div><div><span className="section-kicker">Trust boundary</span><h2>Keep execution and payment authority apart.</h2><p>Untrusted code works inside the Cell boundary. Evidence review and settlement authorization stay outside it.</p></div></section>
    <div className="security-grid"><section className="panel boundary-panel"><div className="panel-heading"><div><span className="section-kicker">Authority map</span><h2>Who can do what</h2></div></div><div className="boundary-row"><span className="boundary-symbol agent-symbol"><Icon name="play" size={16}/></span><div><b>Agent workload</b><p>Runs the submitted task with declared capabilities.</p></div><Badge tone={apiOnline ? 'neutral' : 'demo'} icon={apiOnline ? undefined : 'spark'}>{apiOnline ? 'No payment key' : 'Design claim · offline'}</Badge></div><div className="boundary-row"><span className="boundary-symbol cell-symbol"><Icon name="shield" size={16}/></span><div><b>Ephemora Cell</b><p>Constrains each reviewed guest and reports its actual outcome.</p></div><Badge tone={cellReady ? 'verified' : 'demo'}>{cellReady ? 'Connected' : apiOnline ? 'Unavailable' : 'Design claim · offline'}</Badge></div><div className="boundary-row"><span className="boundary-symbol verify-symbol"><Icon name="receipt" size={16}/></span><div><b>ProofGate verifier</b><p>Checks signer trust, job binding, policy, freshness, output, and replay state.</p></div><Badge tone={apiOnline ? 'verified' : 'demo'}>{apiOnline ? 'Local verifier' : 'Design claim · offline'}</Badge></div><div className="boundary-row"><span className="boundary-symbol contract-symbol"><Icon name="wallet" size={16}/></span><div><b>NEAR escrow</b><p>Settlement records are accepted only from the local bridge after the escrow transfer completes.</p></div><Badge tone={connection.settlementBridge ? 'verified' : 'demo'}>{connection.settlementBridge ? 'Bridge configured' : apiOnline ? 'Offline' : 'Design claim · offline'}</Badge></div></section>
      <section className="panel guardrail-panel"><div className="panel-heading"><div><span className="section-kicker">Fail-closed defaults</span><h2>Guardrails</h2></div></div><CheckRow label="Worker receives signing keys" state={apiOnline ? 'pass' : 'unknown'} text={apiOnline ? 'Not exposed to guest' : 'Not connected'}/><CheckRow label="Unknown evidence schema" state={apiOnline ? 'pass' : 'unknown'} text={apiOnline ? 'Rejected' : 'Not checked'}/><CheckRow label="Repeated Cell report" state={apiOnline ? 'pass' : 'unknown'} text={apiOnline ? 'Rejected' : 'Not checked'}/><CheckRow label="Unconfirmed transaction" state={apiOnline ? 'pass' : 'unknown'} text={apiOnline ? 'Never shown as paid' : 'Not checked'}/><div className="guardrail-note"><Badge tone={apiOnline ? 'verified' : 'demo'}>{apiOnline ? 'Local verifier active' : 'Design intent'}</Badge><span>{apiOnline ? 'These checks run in the local API. Settlement records arrive only from the local bridge.' : 'Start the local API to execute the verifier path.'}</span></div></section></div>
    <section className="panel probe-panel">
      <div className="panel-heading"><div><span className="section-kicker">Live check</span><h2>Network denial probe</h2></div><Badge tone={lastProbe?.live ? 'blocked' : 'demo'} icon={lastProbe?.live ? 'alert' : 'spark'}>{lastProbe?.live ? 'Cell denial recorded' : lastProbe ? 'Sample · not a Cell proof' : 'Not run'}</Badge></div>
      <p className="probe-copy">Run the reviewed C guest that attempts a socket operation. Cell must return ENOTSOCK and list /sandbox as the only preopen. A denied capability cannot authorize payment.</p>
      <div className="probe-actions">
        <button className="button button-secondary" onClick={onRunProbe} disabled={!apiOnline || probeBusy}><Icon name="shield" size={15}/>{probeBusy ? 'Running probe…' : 'Run denial probe'}</button>
        {lastProbe?.live ? <button className="text-link" onClick={() => onOpenJob(lastProbe)}>Open blocked record <Icon name="arrow" size={14}/></button> : <span className="probe-hint">{lastProbe ? 'The selected sample is illustrative; it does not contain Cell evidence.' : 'Runs through the local Cell boundary; no payment is involved.'}</span>}
      </div>
      {lastProbe?.live && <dl className="probe-facts"><div><dt>Result</dt><dd>{lastProbe.output?.wasiErrno || 'ENOTSOCK'}</dd></div><div><dt>Preopens</dt><dd className="mono">{Array.isArray(lastProbe.output?.preopens) ? lastProbe.output.preopens.join(', ') : '/sandbox'}</dd></div><div><dt>Cell report</dt><dd className="mono">{lastProbe.reportId || 'Not issued'}</dd></div></dl>}
    </section>
    <div className="security-note"><Icon name="lock" size={16}/><span>Signed execution evidence is not a mathematical proof of correctness, host integrity, or runtime isolation.</span></div>
  </div>;
}

function Settings({ theme, setTheme, connection, nearStatus, checkingNear, onCheckNearStatus, jobs }) {
  const apiOnline = connection.apiReachable === true;
  const connectionLost = connection.connectedOnce === true && !apiOnline;
  const cellReady = connection.connected === true;
  const settlement = jobs.map((job) => job.settlement).find((value) => value && typeof value === 'object') || null;
  const guests = availableLanguageCatalog(connection);
  const guestLabels = [...new Map(guests.map((guest) => [guest.id, guest.label || guest.id])).values()];
  const guestProfiles = [...new Map(guests.map((guest) => [
    guest.id,
    `${guest.label || guest.id}: ${runtimeLabel(guest)}`,
  ])).values()];
  const rpcTone = nearStatus?.connected ? 'chain' : checkingNear ? 'pending' : nearStatus ? 'blocked' : 'demo';
  const rpcLabel = nearStatus?.connected ? 'Reachable · read-only' : checkingNear ? 'Checking' : nearStatus ? 'Unavailable' : 'Not checked';

  return <div className="content-stack settings-grid">
    <section className="panel settings-panel">
      <div className="panel-heading"><div><span className="section-kicker">Appearance</span><h2>Choose a theme</h2></div></div>
      <div className="theme-options">
        <button className={theme === 'light' ? 'theme-option selected' : 'theme-option'} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><span className="theme-preview light-preview"><i/><i/><i/></span><b>Light</b><small>Clear evidence, calm canvas</small></button>
        <button className={theme === 'dark' ? 'theme-option selected' : 'theme-option'} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><span className="theme-preview dark-preview"><i/><i/><i/></span><b>Dark</b><small>Low-light review</small></button>
      </div>
    </section>

    <section className="panel settings-panel">
      <div className="panel-heading"><div><span className="section-kicker">Network</span><h2>NEAR Testnet</h2></div><Badge tone={rpcTone}>{rpcLabel}</Badge></div>
      <div className="settings-row"><span>Read-only RPC</span><b>{nearStatus?.connected ? `${nearStatus.provider} · block ${nearStatus.latestBlockHeight}` : nearStatus?.error || 'Not checked'}</b></div>
      {nearStatus?.connected && <div className="settings-row"><span>Latest block time</span><b>{nearStatus.latestBlockTime ? new Date(nearStatus.latestBlockTime).toLocaleString() : 'Not reported'}</b></div>}
      <div className="settings-row"><span>Escrow contract</span><b className="muted-cell">{settlement ? settlement.contractId : 'No settlement recorded'}</b></div>
      <div className="settings-row"><span>Settlement bridge</span><b className="muted-cell">{connection.settlementBridge ? 'Configured · local bridge only' : 'Not configured'}</b></div>
      <div className="settings-row"><span>Mainnet transfers</span><b className="muted-cell">Not available</b></div>
      <div className="settings-actions"><button className="button button-secondary" onClick={onCheckNearStatus} disabled={!apiOnline || checkingNear}>{checkingNear ? 'Checking Testnet…' : 'Check Testnet RPC'}</button><span className="settings-hint">Read-only status call. No wallet, contract write, or transaction.</span></div>
      <div className="settings-warning"><Icon name="alert" size={15}/><span>{apiOnline ? (settlement ? 'Settlement records come only from the local bridge; the RPC check remains read-only.' : 'Network reachability does not mean an escrow contract is connected.') : 'Reconnect the local API before checking the Testnet RPC.'}</span></div>
    </section>

    <section className="panel settings-panel">
      <div className="panel-heading"><div><span className="section-kicker">Runtime information</span><h2>Execution source</h2></div><Badge tone={cellReady ? 'verified' : 'demo'}>{cellReady ? 'Connected' : 'Design claim · offline'}</Badge></div>
      <div className="settings-row"><span>Cell version</span><b>{connection.cell?.version || 'Not connected'}</b></div>
      <div className="settings-row"><span>Available languages</span><b>{guestLabels.join(', ') || (cellReady ? 'No guest reported' : 'Not connected')}</b></div>
      <div className="settings-row"><span>ABI / runtime profiles</span><b>{guestProfiles.join(' · ') || 'Not reported'}</b></div>
      <div className="settings-row"><span>Receipt verifier</span><b>{apiOnline ? 'Local API' : 'Not connected'}</b></div>
    </section>

    <section className="panel settings-panel">
      <div className="panel-heading"><div><span className="section-kicker">Local data</span><h2>Preview boundaries</h2></div></div>
      <p className="settings-paragraph">{apiOnline ? (settlement ? 'Jobs, signed Cell evidence, ProofGate receipts, and bridge-confirmed settlement records are stored in a local SQLite database. Sandbox settlement is not a Mainnet payment.' : 'Jobs, signed Cell evidence, and ProofGate receipts are stored in a local SQLite database. NEAR settlement is not connected.') : connectionLost ? 'Saved SQLite records remain in the browser view, but the local API is unreachable. Reconnect before taking actions.' : 'These records are sample data held in this browser session and are not an audit log.'}</p>
      <Badge tone={settlement ? 'chain' : 'demo'}>{settlement ? 'Sandbox settlement · no Mainnet payment' : 'No real payment'}</Badge>
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
  const [selectedLanguageId, setSelectedLanguageId] = useState(defaultLanguage);
  const selectedLanguage = available.find((language) => language.id === selectedLanguageId) || available[0] || null;
  const selectedProfile = selectedLanguage ? [selectedLanguage.abi, selectedLanguage.runtimeProfile].filter(Boolean).join(' · ') || selectedLanguage.detail || '' : '';
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
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog" ref={dialogRef} tabIndex="-1" role="dialog" aria-modal="true" aria-labelledby="new-job-title" aria-describedby="new-job-description"><div className="dialog-header"><div><span className="section-kicker">{apiOnline ? 'Local Cell run' : connectionLost ? 'Local API offline' : 'Offline preview'}</span><h2 id="new-job-title">{connectionLost ? 'Reconnect to continue' : apiOnline ? 'Create a protected job' : 'Create a sample job'}</h2></div><button type="button" className="icon-button close-button" onClick={onClose} aria-label="Close dialog">×</button></div>
    <p className="dialog-copy" id="new-job-description">{connectionLost ? 'Saved records remain visible, but job creation and execution are unavailable until the local API reconnects.' : apiOnline ? available.length ? 'Choose an available, reviewed language guest and give it bounded text input. Each guest uses the runtime profile reported by the local API. ProofGate stores the job locally; no NEAR funds move.' : 'The local API reports no available language guests. Check the runtime setup before creating a protected job.' : 'This adds an illustrative record to the current browser session. Language labels are examples only; it does not start a Cell run or create a NEAR transaction.'}</p>
    <form onSubmit={onSubmit}>
      <label className="field-label">Job name<input name="jobName" required maxLength="64" placeholder="e.g. Normalize public data" autoFocus/></label>
      <label className="field-label">Input text<textarea name="input" required maxLength="512" rows="3" placeholder="Paste a short line of text to normalize"/><small>Up to 512 bytes · ASCII letters, numbers, punctuation, and spaces</small></label>
      <div className="form-two"><label className="field-label">Language<select name="language" value={selectedLanguage?.id || ''} onChange={(event) => setSelectedLanguageId(event.target.value)} required disabled={!available.length}>{available.map((language) => <option key={language.id} value={language.id}>{language.label || language.id}</option>)}</select><small>{apiOnline ? available.length ? `${selectedProfile || 'Runtime profile reported by the API'} · ${available.length} guest${available.length === 1 ? '' : 's'} available` : 'No guest is currently available' : 'Sample labels only · no runtime is invoked'}</small></label><label className="field-label">Proposed reward<input type="number" name="amount" min="0.01" max="10" step="0.01" defaultValue="0.10" required/><small>NEAR · not funded</small></label></div>
      {apiOnline && <label className="field-label">Beneficiary account<input name="beneficiary" required minLength="2" maxLength="64" pattern="[a-z0-9._-]+" defaultValue="local-agent.testnet"/><small>Recorded in the receipt; settlement is a separate verifier decision</small></label>}
      <div className="dialog-policy"><Icon name="lock" size={15}/><span>Signing keys stay outside the guest workload.</span></div>
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Close</button><button className="button button-primary" type="submit" disabled={connectionLost || (apiOnline && !available.length)}>{apiOnline ? 'Create local job' : connectionLost ? 'API unavailable' : 'Add sample job'} <Icon name="arrow" size={15}/></button></div>
    </form></section></div>;
}

export default App;
