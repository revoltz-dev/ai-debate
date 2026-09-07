import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, ArrowDown, Plus, Settings2, Radio, WifiOff, Copy, Check, Pencil, Trash2, X, Send, Users, MessageSquare, FileText, Flag, Lightbulb, KeyRound, SkipForward, Gavel, Square, ChevronDown, Volume2, VolumeX, Globe2, PanelLeft, LoaderCircle, Terminal, ExternalLink, CircleCheck, Clock3, LockKeyhole, AtSign } from 'lucide-react';
import { AgentIdentity, AgentMentions, ThinkingOrb, AppBrand, agentColor } from './ui-visuals.js';
import { messages, resolveLanguage } from './i18n.js';
import { useAutosave } from './use-autosave.js';
import { referenceChoices, mentionQuery, matchingReferences, referencesInText } from './mention-utils.js';

const Language = createContext({ lang: 'pt', t: messages.pt });
const useLanguage = () => useContext(Language);
const readLocal = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const writeLocal = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const renewModeratorSession = () => { try { const key = 'aidebate.session-refresh'; if (sessionStorage.getItem(key) === '1') return false; sessionStorage.setItem(key, '1'); location.reload(); return true; } catch { return false; } };
const scoped = (path, id) => id ? `${path}${path.includes('?') ? '&' : '?'}debate=${encodeURIComponent(id)}` : path;
async function request(path, { method = 'GET', body, id } = {}) {
  const response = await fetch(scoped(path, id), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.message || data.error || 'request_failed'); error.code = data.error; error.waitingFor = data.waitingFor; error.presence = data.presence; throw error; }
  return data;
}
const kindNames = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
const providerIdentities = Object.entries(kindNames).map(([kind, name]) => ({ id: kind, kind, name }));
const isRunning = d => !d.presence.waiting && d.agents.length >= 2 && (d.state !== 'closed' || ['pending', 'ready'].includes(d.implementation?.status));
const workflowAgentId = d => d.implementation?.status === 'ready' ? d.implementation.consultation?.pending?.[0]?.id || d.implementation.agentId : d.turn;
const isVisible = d => d.count || d.agents.length || d.topic?.trim();
const formatDate = (ts, lang, timeOnly = false) => new Date(ts).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US', timeOnly ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

let audioContext;
let audioEnabled = readLocal('aidebate.sound', 'true') !== 'false';
let nextTone = 0;
async function unlockAudio() {
  if (!audioEnabled) return false;
  const Audio = window.AudioContext;
  if (!Audio) return false;
  try {
    audioContext ||= new Audio();
    if (audioContext.state === 'suspended') await audioContext.resume();
    return audioContext.state === 'running';
  } catch { return false; }
}
function playMessageSound() {
  if (!audioEnabled || audioContext?.state !== 'running') return false;
  const start = Math.max(audioContext.currentTime + .01, nextTone);
  nextTone = start + .28;
  [660, 880].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    const at = start + index * .075;
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(.055, at + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, at + .21);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(at); oscillator.stop(at + .22);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
  return true;
}

function Button({ children, icon: Icon, tone = '', small, className = '', ...props }) {
  return <button type="button" className={`button ${tone} ${small ? 'small' : ''} ${className}`} {...props}>{Icon && <Icon size={16} />}{children}</button>;
}
function IconButton({ label, icon: Icon, ...props }) { return <button type="button" className="icon-button" aria-label={label} title={label} {...props}><Icon size={17}/></button>; }
function Badge({ debate }) {
  const { t } = useLanguage();
  const state = debate.state === 'closed' ? 'closed' : debate.state === 'agreed' ? 'agreed' : debate.agents.length < 2 ? 'draft' : 'open';
  const label = debate.presence.waiting ? t.waitingForAgents : debate.phase === 'review' ? t.reviewPhase : debate.implementation?.status === 'pending' ? t.implementationChoice : debate.implementation?.status === 'ready' ? debate.implementation.consultation?.pending?.length ? t.consultationPending : t.reviewWaiting : t[{ closed: 'closedState', agreed: 'agreedState', open: 'openState', draft: 'draft' }[state]];
  return <span className={`badge ${debate.phase === 'review' ? 'open' : state}`}><span className="status-dot"/>{label}</span>;
}
function Elapsed({ since, relative = false, compact = false }) {
  const { t, lang } = useLanguage();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const total = Math.max(0, Math.floor((now - Date.parse(since || new Date(now).toISOString())) / 1000));
  const duration = total < 60 ? `${total}s` : total < 3600 ? `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s` : `${Math.floor(total / 3600)}h ${String(Math.floor(total / 60) % 60).padStart(2, '0')}m ${String(total % 60).padStart(2, '0')}s`;
  return <time className="elapsed" dateTime={`PT${total}S`} data-elapsed={total}>{relative && lang === 'pt' ? `${t.ago} ` : ''}{compact ? duration.replaceAll(' ', '') : duration}{relative && lang === 'en' ? ` ${t.ago}` : ''}</time>;
}
function Identity({ id, agents, ...props }) {
  const { t } = useLanguage();
  if (!id || id === 'human' || id === 'system') return <span className="human-identity"><Users size={14}/>{id === 'system' ? t.systemAuthor : t.moderator}</span>;
  return <AgentIdentity agent={agents.find(a => a.id === id) || { id, name: id, kind: 'other' }} {...props}/>;
}
function Connection({ online }) {
  const { t } = useLanguage();
  return <span className={`connection ${online ? '' : 'disconnected'}`} title={t.synced}>{online ? <Radio size={13}/> : <WifiOff size={13}/>}{online ? t.live : t.offline}</span>;
}

function ToastList({ items, agents }) {
  return <div className="toasts" role="status" aria-live="polite">{items.map(item => <div className={`toast ${item.bad ? 'bad' : ''}`} key={item.id}>{item.bad ? <X size={15}/> : <Check size={15}/>}<AgentMentions text={item.text} agents={agents}/></div>)}</div>;
}

function Dialog({ spec, onClose, feedback }) {
  const { t } = useLanguage();
  const ref = useRef(null), [manualValue, setManualValue] = useState(spec.value || '');
  const automatic = useAutosave({ key: spec.key || 'dialog', value: spec.value || '', onSave: value => spec.autosave(value.trim()), enabled: Boolean(spec.autosave), validate: value => value.trim() ? '' : t.requiredField });
  const value = spec.autosave ? automatic.value : manualValue, setValue = spec.autosave ? automatic.setValue : setManualValue;
  useEffect(() => { const previous = document.activeElement; ref.current.showModal(); return () => previous?.focus?.(); }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="dialog-title" onCancel={e => { e.preventDefault(); onClose(null); }} onClick={e => { if (e.target === ref.current) onClose(null); }}>
    <form onSubmit={e => { e.preventDefault(); onClose(spec.input ? value : true); }}>
      <div className="row between"><h2 id="dialog-title">{spec.title}</h2><IconButton label={t.close} icon={X} onClick={() => onClose(null)}/></div>
      {spec.body && <p className="muted dialog-body">{spec.body}</p>}
      {spec.input && (spec.multiline ? <textarea autoFocus rows={7} value={value} onChange={e => setValue(e.target.value)} placeholder={spec.placeholder} aria-label={spec.title}/> : <input autoFocus value={value} onChange={e => setValue(e.target.value)} aria-label={spec.title}/>)}
      {spec.autosave && automatic.error && <p className="field-error" role="status">{automatic.error}</p>}
      <div className="row end dialog-actions">{!spec.autosave && <Button onClick={() => onClose(null)}>{t.cancel}</Button>}<button className={`button ${spec.danger ? 'danger' : 'primary'}`} type="submit">{spec.autosave ? t.close : spec.ok || t.confirm}</button></div>
    </form>
    {feedback}
  </dialog>;
}

function Preferences({ preference, setPreference, sound, setSound, close, notify, feedback }) {
  const { t, lang } = useLanguage();
  const ref = useRef(null);
  useEffect(() => { const previous = document.activeElement; ref.current.showModal(); return () => previous?.focus?.(); }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="preferences-title" onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === ref.current) close(); }}>
    <div className="row between"><h2 id="preferences-title"><Settings2 size={19}/>{t.settings}</h2><IconButton label={t.close} icon={X} onClick={close}/></div>
    <div className="preference"><label htmlFor="language"><Globe2 size={18}/>{t.language}</label><select id="language" value={preference} onChange={e => setPreference(e.target.value)}><option value="system">{t.system} · {resolveLanguage('system') === 'pt' ? 'Português' : 'English'}</option><option value="pt">Português</option><option value="en">English</option></select><p className="muted">{t.languageHelp}</p></div>
    <div className="preference"><div className="row between"><label htmlFor="sound"><Volume2 size={18}/>{t.sound}</label><input id="sound" type="checkbox" role="switch" checked={sound} onChange={e => setSound(e.target.checked)}/></div><p className="muted">{t.soundHelp}</p><Button small icon={Volume2} disabled={!sound} onClick={async () => { await unlockAudio(); if (!playMessageSound()) notify(t.soundBlocked); }}>{t.testSound}</Button></div>
    <div className="row end"><Button tone="primary" onClick={close}>{t.close}</Button></div>
    {feedback}
  </dialog>;
}

function Home({ debates, online, open, create, rename, remove, settings, busy, loaded }) {
  const { t, lang } = useLanguage();
  const visible = debates.filter(isVisible), running = visible.filter(isRunning);
  return <main className="home page">
    <header className="home-header"><div><AppBrand name={t.appName}/><p className="brand-tagline">{t.tagline}</p></div><div className="row"><Connection online={online}/><IconButton label={t.settings} icon={Settings2} onClick={settings}/><Button tone="primary" icon={Plus} onClick={create}>{t.newDebate}</Button></div></header>
    <section className="home-intro"><div><span className="eyebrow">{t.workspace}</span><h1>{t.homeTitle}</h1><p>{t.homeDescription}</p></div><div className="home-stats"><div><strong>{visible.length}</strong><span>{t.debates}</span></div><div><strong>{running.length}</strong><span>{t.liveCount}</span></div></div></section>
    {running.length > 0 && <div className="running-banner"><Radio size={18}/><div><strong>{t.running}</strong><p>{t.runningHelp}</p></div><span className="badge open">{running.length} {t.liveCount}</span></div>}
    <div className="section-heading"><h2>{t.debates}</h2><span className="counter">{visible.length}</span></div>
    {!loaded ? <div className="empty"><LoaderCircle className="spin"/><p>{t.loading}</p></div> : visible.length ? <div className="debate-grid">{visible.map((d, index) => <article className={`debate-card ${isRunning(d) ? 'is-running' : ''} ${d.presence.waiting ? 'is-waiting' : ''}`} style={{ '--card-accent': agentColor(d.agents.find(a => a.id === workflowAgentId(d)) || { kind: 'gemini' }) }} key={d.id}>
      <div className="card-orbit" aria-hidden="true"><span/><span/><span/></div>
      <div className="row between card-top"><span className="date">{formatDate(d.createdAt, lang)}</span><Badge debate={d}/></div>
      <div className="card-heading"><span className="card-kicker">{t.cardConversation} / {String(index + 1).padStart(2, '0')}</span><h2><button className="title-link" onClick={() => open(d.id)}><AgentMentions text={d.title} agents={d.agents}/></button></h2></div>
      <p className="card-topic"><AgentMentions text={d.topic?.split('\n').find(line => line.trim()) || t.noTopic} agents={d.agents}/></p>
      <div className="card-participants"><div className="card-avatar-group">{d.agents.map(a => <AgentIdentity key={a.id} agent={a} size={30} showName={false}/>)}</div><span className="card-participant-label">{d.agents.length} {t.participants}</span><span className="card-message-count"><MessageSquare size={13}/>{d.totalCount}</span></div>
      <div className="card-activity"><span className="card-activity-label">{d.presence.waiting ? t.presence : isRunning(d) ? t.cardActivity : d.state === 'closed' ? t.closedState : t.draft}</span><div className="card-activity-row">{d.presence.waiting ? <><Users size={16}/><span>{d.presence.confirmed}/{d.presence.total} {t.presenceCount}</span></> : d.turn && d.state !== 'closed' ? <><Identity id={d.turn} agents={d.agents} size={19}/><span className="card-activity-time">{t.elapsed} <Elapsed since={d.turnStartedAt}/></span></> : d.implementation?.status === 'ready' ? <><Identity id={workflowAgentId(d)} agents={d.agents} size={19}/><span className="card-activity-note">{d.implementation.consultation?.pending?.length ? t.consultationPending : t.reviewWaiting}</span></> : d.implementation?.status === 'pending' ? <><Terminal size={16}/><span>{t.awaitingImplementer}</span></> : d.final ? <><CircleCheck size={16}/><span>{t.writtenBy}</span><Identity id={d.final.writer} agents={d.agents} size={19}/></> : <><MessageSquare size={16}/><span>{d.agents.length < 2 ? t.draft : t.noMessages}</span></>}</div></div>
      <div className="card-footer"><Button small tone={isRunning(d) ? 'primary' : ''} icon={d.presence.waiting ? Users : isRunning(d) ? ArrowRight : d.final ? FileText : MessageSquare} onClick={() => open(d.id)}>{d.presence.waiting ? t.openReadiness : isRunning(d) ? t.backToDebate : t.open}</Button><div className="card-actions"><IconButton label={t.rename} icon={Pencil} disabled={busy} onClick={() => rename(d)}/><IconButton label={t.delete} icon={Trash2} disabled={busy} onClick={() => remove(d)}/></div></div>
    </article>)}</div> : <div className="empty empty-home"><img src="/logos/app.png" width="82" height="82" alt=""/><h2>{t.emptyTitle}</h2><p>{t.emptyBody}</p><Button tone="primary" icon={Plus} onClick={create}>{t.firstDebate}</Button><div className="empty-brands">{Object.entries(kindNames).map(([kind, name]) => <AgentIdentity agent={{ kind, name }} key={kind}/>)}</div></div>}
    <footer className="home-footer"><span>{t.appName}</span><span><span className="status-dot"/>{t.synced}</span></footer>
  </main>;
}

function ReadinessModal({ debate: d, copyPrompt, busy, feedback }) {
  const { t } = useLanguage();
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  const pending = d.agents.filter(a => !a.confirmedAt);
  return <main className="readiness-screen">
    <div className="readiness-backdrop" aria-hidden="true"><AppBrand name={t.appName}/><span>{d.title}</span></div>
    <dialog className="readiness-dialog" ref={dialog} aria-labelledby="readiness-title" aria-describedby="readiness-help" onCancel={e => e.preventDefault()}>
    <section className="readiness-content" aria-labelledby="readiness-title">
      <div className="readiness-heading"><div className="readiness-hub" style={{ '--readiness-progress': `${d.presence.confirmed / Math.max(2, d.presence.total) * 360}deg` }} aria-hidden="true"><span className="readiness-hub-ring"/><span className="readiness-hub-ring secondary"/><span className="readiness-hub-core"><AppBrand compact name=""/></span><span className="readiness-hub-node node-one"/><span className="readiness-hub-node node-two"/><span className="readiness-hub-node node-three"/></div><span className="eyebrow"><AgentMentions text={d.title} agents={d.agents}/></span><span className="readiness-stage"><span className="status-dot"/>{t.presence}</span><h1 id="readiness-title">{t.readinessTitle}</h1><p className="muted" id="readiness-help">{t.presenceHelp}</p></div>
      <div className="readiness-progress"><progress value={d.presence.confirmed} max={Math.max(2, d.presence.total)} aria-label={t.presenceCount}/><span role="status">{d.presence.confirmed}/{d.presence.total} {t.presenceCount}</span></div>
      <div className="readiness-grid">{d.agents.map((a, i) => <article className={`readiness-card ${a.confirmedAt ? 'confirmed' : ''}`} key={a.id} style={{ '--agent-accent': agentColor(a) }}><span className="readiness-card-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span><div className="readiness-avatar"><AgentIdentity agent={a} size={72} showName={false}/><span className="readiness-mark">{a.confirmedAt ? <Check aria-hidden="true"/> : <X aria-hidden="true"/>}</span></div><h2>{a.name}</h2><p className="readiness-state">{a.confirmedAt ? <CircleCheck size={15} aria-hidden="true"/> : <X size={15} aria-hidden="true"/>}{a.confirmedAt ? t.presenceConfirmed : t.presencePending}</p><Button small icon={Copy} autoFocus={i === 0} disabled={busy} onClick={() => copyPrompt(a.id)}>{t.copyPrompt}</Button></article>)}</div>
      {pending.length > 0 && <div className="readiness-pending" role="status"><span>{t.waitingForRelease}</span><div className="row wrap center">{pending.map(a => <AgentIdentity key={a.id} agent={a} size={21}/>)}</div></div>}
      <p className="readiness-note"><LockKeyhole size={16} aria-hidden="true"/>{t.readinessLocked}</p>
    </section>
    {feedback}
    </dialog>
  </main>;
}

function Wizard({ wizard, setWizard, debate, busy, run, mutate, createDebate, goHome, open, ask, settings, saveSettings }) {
  const { t } = useLanguage();
  const [kind, setKind] = useState('claude'), [name, setName] = useState(''), [role, setRole] = useState('');
  const agents = debate?.agents || [];
  const update = patch => setWizard(w => ({ ...w, ...patch }));
  const next = () => {
    if (wizard.step === 2) { open(wizard.id); return; }
    return run(async () => {
      if (wizard.topic.trim().length < 20) return;
      if (!wizard.id) { const d = await createDebate(wizard); update({ id: d.id, step: 2 }); }
      else { await mutate('/admin/topic', { text: wizard.topic }, 'PUT', wizard.id); if (wizard.title.trim()) await mutate(`/admin/debates/${wizard.id}`, { title: wizard.title }, 'PUT', wizard.id); update({ step: 2 }); }
    });
  };
  return <main className="wizard page"><header className="home-header"><AppBrand name={t.appName}/><div className="row"><IconButton label={t.settings} icon={Settings2} onClick={settings}/><Button small icon={X} onClick={goHome}>{t.cancel}</Button></div></header>
    <div className="wizard-heading"><span className="eyebrow">{t.newDebate}</span><p>{t.step} {wizard.step} {t.of} 3</p></div>
    <ol className="steps">{[t.topic, t.agents, t.presence].map((label, i) => <li className={wizard.step >= i + 1 ? 'current' : ''} key={label}><span>{wizard.step > i + 1 ? <Check size={14}/> : i + 1}</span>{label}</li>)}</ol>
    {wizard.step === 1 && <section className="wizard-panel"><h1>{t.topicTitle}</h1><p className="muted intro">{t.topicHelp}</p><label htmlFor="wTitle">{t.title}</label><input id="wTitle" value={wizard.title} onChange={e => update({ title: e.target.value })} placeholder={t.titlePlaceholder}/><label htmlFor="wTopic">{t.topic}</label><textarea id="wTopic" rows={8} value={wizard.topic} onChange={e => update({ topic: e.target.value })} placeholder={t.topicPlaceholder}/><p className="tip"><Lightbulb size={17}/>{t.projectTip}</p></section>}
    {wizard.step === 2 && <section className="wizard-panel"><h1>{t.agentsTitle}</h1><p className="muted intro">{t.agentsHelp}</p><div className="wizard-agents">{agents.map((a, i) => <div className="wizard-agent" key={a.id}><div className="grow"><AgentIdentity agent={a} size={30}/><span className="role-label">{i === 0 ? t.proposer : t.critic}</span><p className="muted"><AgentMentions text={a.role} agents={agents}/></p></div><IconButton label={t.editRole} icon={Pencil} disabled={busy} onClick={() => ask({ key: `role:${wizard.id}:${a.id}`, title: t.editRole, body: <AgentIdentity agent={a}/>, value: a.role, input: true, multiline: true, autosave: role => saveSettings(`/admin/agents/${a.id}`, { role }, wizard.id) })}/><IconButton label={t.remove} icon={X} disabled={busy || debate?.count > 0} onClick={() => run(() => mutate(`/admin/agents/${a.id}`, undefined, 'DELETE', wizard.id))}/></div>)}</div>
      <div className="agent-add"><h3>{t.addAI}</h3><div className="kind-picker">{['claude', 'codex', 'gemini', 'other'].map(k => <button key={k} className={kind === k ? 'selected' : ''} onClick={() => setKind(k)}><AgentIdentity agent={{ kind: k, name: kindNames[k] || t.otherAI }} size={38}/></button>)}</div><form onSubmit={e => { e.preventDefault(); run(async () => { await mutate('/admin/agents', { name: name.trim() || kindNames[kind] || t.otherAI, kind, role }, 'POST', wizard.id); setName(current => current === name ? '' : current); setRole(current => current === role ? '' : current); }); }}><div className="row"><input value={name} onChange={e => setName(e.target.value)} placeholder={`${t.name} · ${kindNames[kind] || t.otherAI}`} aria-label={t.name}/><button type="submit" className="button primary" disabled={busy || debate?.count > 0}><Plus size={16}/>{t.add}</button></div><input value={role} onChange={e => setRole(e.target.value)} placeholder={t.optionalRole} aria-label={t.role}/></form></div>
    </section>}
    {wizard.step === 2 && <details className="side-detail"><summary><Settings2 size={16}/>{t.implementation}<ChevronDown size={14}/></summary><div className="detail-body"><Implementation debate={debate} mutate={mutate} run={run} busy={busy} saveSettings={saveSettings}/></div></details>}
    <div className="wizard-footer"><Button icon={ArrowLeft} disabled={busy} onClick={() => wizard.step > 1 ? update({ step: wizard.step - 1 }) : goHome()}>{t.back}</Button><Button tone="primary" icon={ArrowRight} disabled={busy || (wizard.step === 1 ? wizard.topic.trim().length < 20 : agents.length < 2)} onClick={next}>{t.next}</Button></div>
  </main>;
}

function Implementation({ debate: d, mutate, run, busy, saveSettings, final = false }) {
  const { t } = useLanguage();
  const config = d.implementation;
  const ready = ['ready', 'reviewing', 'completed'].includes(config.status);
  const firstAgent = d.agents[0]?.id || '';
  const autosave = useAutosave({
    key: `implementation:${d.id}`,
    value: { mode: config.mode, agentId: config.mode === 'agent' ? config.configuredAgentId || firstAgent : null, unanimousOnly: config.unanimousOnly, reviewAfter: config.reviewAfter },
    onSave: value => saveSettings('/admin/implementation', value, d.id),
    delay: 200,
    enabled: !ready && !final,
    validate: value => value.mode === 'agent' && !d.agents.some(a => a.id === value.agentId) ? t.selectAI : ''
  });
  const { mode, agentId, unanimousOnly, reviewAfter } = autosave.value;
  const update = patch => autosave.setValue(current => ({ ...current, ...patch }));
  const [manualSelection, setManualSelection] = useState({ debateId: d.id, id: config.agentId || firstAgent });
  const manualAgentId = manualSelection.debateId === d.id && d.agents.some(a => a.id === manualSelection.id) ? manualSelection.id : config.agentId || firstAgent;
  const adopted = d.final?.proposal != null && d.final?.text;
  const permitted = adopted && !(config.unanimousOnly && d.forced);
  if (ready) return <div className={final ? 'implementation-panel' : 'implementation-status'}>{final && <h3>{config.status === 'reviewing' ? t.reviewPhase : config.status === 'completed' ? config.reviewAfter ? t.reviewComplete : t.implementationCompleted : t.implementation}</h3>}<p className="row wrap"><CircleCheck size={17}/>{t.implementationAssigned} <Identity id={config.agentId} agents={d.agents} size={23}/></p><p className="muted">{config.status === 'ready' ? config.reviewAfter ? t.reviewWaitingHelp : t.completionReportHelp : config.status === 'reviewing' ? t.reviewInProgressHelp : t.closedHelp}</p></div>;
  return <div className={final ? 'implementation-panel' : ''}>{final && <h3>{t.implementation}</h3>}<p className="muted">{final ? config.status === 'pending' ? t.awaitingImplementer : !adopted ? t.implementationNoSolution : config.unanimousOnly && d.forced ? t.implementationNoConsensus : t.implementationSkipped : t.implementationHelp}</p>
    <div className="implementation-options">{!final && <><label>{t.implementation}<select aria-label={t.implementation} value={mode} disabled={ready} onChange={e => { const next = e.target.value; update({ mode: next, agentId: next === 'agent' ? agentId || firstAgent : null }); }}><option value="proposal">{t.proposalAgent}</option><option value="choose">{t.chooseAtEnd}</option><option value="agent">{t.specificAgent}</option><option value="none">{t.noImplementation}</option></select></label>{mode === 'proposal' && <p className="muted">{t.automaticChoiceHelp}</p>}{mode === 'agent' && <Recipient agents={d.agents} value={agentId} setValue={value => { if (value) update({ agentId: value }); }} onlyAgents disabled={ready}/>}<label className="switch-option"><span>{t.unanimousOnly}</span><input type="checkbox" checked={unanimousOnly} disabled={ready} onChange={e => update({ unanimousOnly: e.target.checked })}/></label><p className="muted">{t.anyDecision}</p><label className="switch-option"><span>{t.reviewAfter}</span><input type="checkbox" checked={reviewAfter} disabled={ready} onChange={e => update({ reviewAfter: e.target.checked })}/></label><p className="muted">{t.reviewAfterHelp}</p>{autosave.error && <p className="autosave-error" role="alert">{autosave.error === t.selectAI ? autosave.error : t.requestError}</p>}</>}
    {final && adopted && config.status === 'pending' && <><div className="row wrap"><span className="muted">{t.implementer}</span><Recipient agents={d.agents} value={manualAgentId} setValue={value => { if (value) setManualSelection({ debateId: d.id, id: value }); }} onlyAgents disabled={busy}/></div><Button small tone="primary" icon={ArrowRight} disabled={busy || !permitted || !manualAgentId} onClick={() => run(() => mutate('/admin/implement', { agentId: manualAgentId }, 'POST', d.id))}>{t.implementNow}</Button><p className="muted">{t.implementationManualHelp}</p></>}
    </div></div>;
}

function AgentRow({ agent: a, debate: d, copyPrompt, busy }) {
  const { t, lang } = useLanguage();
  const [expanded, setExpanded] = useState(false), ref = useRef(null);
  const { lastMessage, acceptance } = a.activity;
  const active = d.turn === a.id && d.state !== 'closed';
  const implementing = d.implementation?.status === 'ready' && d.implementation.agentId === a.id;
  const consultationPending = d.implementation?.consultation?.pending?.some(agent => agent.id === a.id);
  const highlighted = active || implementing || consultationPending;
  useEffect(() => {
    if (!expanded) return;
    const outside = e => { if (!ref.current?.contains(e.target)) setExpanded(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [expanded]);
  return <div ref={ref} data-agent-id={a.id} className={`side-agent ${highlighted ? 'has-turn' : ''}`} style={{ '--agent-accent': agentColor(a) }} onKeyDown={e => { if (e.key === 'Escape') { setExpanded(false); ref.current.querySelector('.agent-name-toggle').focus(); } }}>
    <div className="agent-line"><button type="button" className="agent-name-toggle" aria-label={`${t.activityDetails} ${a.name}`} aria-expanded={expanded} aria-controls={`activity-${a.id}`} onClick={() => setExpanded(!expanded)}><AgentIdentity agent={a} size={24}/></button><span className={`agent-presence-mark ${a.confirmedAt ? 'confirmed' : ''}`} aria-label={a.confirmedAt ? t.presenceConfirmed : t.presencePending} title={a.confirmedAt ? `${t.presenceConfirmed} · ${formatDate(a.confirmedAt, lang)}` : t.presencePending}>{a.confirmedAt ? <CircleCheck size={12}/> : <Clock3 size={12}/>}</span><span className={`agent-acceptance ${acceptance?.active ? 'accepted' : ''}`} title={acceptance ? `${acceptance.active ? t.supports : t.previousAcceptance} #${acceptance.proposalId} · ${formatDate(acceptance.ts, lang)}` : t.noAcceptance} aria-label={acceptance ? `${acceptance.active ? t.supports : t.previousAcceptance} #${acceptance.proposalId}` : t.noAcceptance}><Check size={11}/>{acceptance ? `#${acceptance.proposalId}` : '—'}</span><span className="agent-last-age" title={lastMessage ? `${t.lastMessage} #${lastMessage.id} · ${formatDate(lastMessage.ts, lang)}\n${lastMessage.text}` : t.noAgentMessage} aria-label={t.lastMessage}><MessageSquare size={11}/>{lastMessage ? <Elapsed since={lastMessage.ts} relative compact/> : '—'}</span><IconButton label={`${t.copyPrompt} · ${a.name}`} icon={Copy} disabled={busy} onClick={() => copyPrompt(a.id)}/></div>
    {(active || implementing) && <span className="agent-turn-orb" aria-hidden="true"><ThinkingOrb agent={a} compact/></span>}
    <div className="agent-detail" id={`activity-${a.id}`} hidden={!expanded}><div className="agent-detail-heading"><AgentIdentity agent={a} size={22}/><span>{consultationPending ? t.consultationPending : active ? t.turnOf : implementing ? t.implementing : d.state === 'closed' ? t.closedState : t.awaitingTurn}</span></div><div className="agent-detail-item"><span>{t.presence}</span><p><CircleCheck size={13}/>{a.confirmedAt ? <>{t.presenceConfirmed} · <Elapsed since={a.confirmedAt}/></> : t.presencePending}</p></div><div className="agent-detail-item"><span>{t.acceptance}</span><p className={acceptance?.active ? 'positive' : ''}>{acceptance ? <>{acceptance.active ? t.supports : t.previousAcceptance} #{acceptance.proposalId} · <Elapsed since={acceptance.ts}/></> : t.noAcceptance}</p></div><div className="agent-detail-item"><span>{t.lastMessage}{lastMessage && <> #{lastMessage.id} · <Elapsed since={lastMessage.ts} relative compact/></>}</span><p className="agent-last-message">{lastMessage ? <AgentMentions text={lastMessage.text} agents={d.agents}/> : t.noAgentMessage}</p></div></div>
  </div>;
}

function Sidebar({ debate: d, home, copyPrompt, mutate, run, ask, busy, create, settings, saveSettings }) {
  const { t } = useLanguage();
  const topic = useAutosave({ key: `topic:${d.id}`, value: d.topic, onSave: text => saveSettings('/admin/topic', { text }, d.id), delay: 500 });
  return <div className="sidebar-content"><div className="sidebar-brand"><AppBrand name={t.appName} compact/><div><strong>{t.appName}</strong><span>{t.synced}</span></div></div><div className="sidebar-navigation"><Button small icon={ArrowLeft} onClick={home}>{t.history}</Button></div>
    <div className="section-heading"><h2>{t.agents}</h2><span>{d.agents.length}</span></div><div className="agent-stack">{d.agents.map(a => <AgentRow key={a.id} agent={a} debate={d} copyPrompt={copyPrompt} busy={busy}/>)}</div>
    <details className="side-detail"><summary><FileText size={16}/>{t.topic}<ChevronDown size={14}/></summary><div className="detail-body"><textarea rows={7} aria-label={t.topic} value={topic.value} onChange={e => topic.setValue(e.target.value)}/>{topic.error && <p className="autosave-error" role="alert">{t.requestError}</p>}</div></details>
    <details className="side-detail" open><summary><Settings2 size={16}/>{t.controls}<ChevronDown size={14}/></summary><div className="detail-body controls"><Button small icon={SkipForward} disabled={busy || d.agents.length < 2 || (d.state === 'closed' && !(d.phase === 'implementation' && d.implementation.status === 'ready' && d.implementation.consultation?.pending?.length))} onClick={() => run(() => mutate('/admin/skip'))}>{t.skip}</Button>
      <Button small icon={Gavel} disabled={busy || d.state !== 'open' || d.agents.length < 2 || d.presence.waiting} onClick={() => run(async () => { if (await ask({ title: t.requestDecision, body: t.requestDecisionBody })) await mutate('/admin/decision-request'); })}>{t.requestDecision}</Button>
      <Button small tone="danger" icon={Square} disabled={busy || d.phase === 'finished'} onClick={() => run(async () => { const text = await ask({ title: t.stopTitle, body: t.stopBody, input: true, multiline: true, placeholder: t.finalPlaceholder, danger: true, ok: t.stop }); if (text !== null) await mutate('/admin/close', { text }); })}>{t.stop}</Button>
    </div></details>
    <details className="side-detail" open><summary><Terminal size={16}/>{t.implementation}<ChevronDown size={14}/></summary><div className="detail-body"><Implementation debate={d} mutate={mutate} run={run} busy={busy} saveSettings={saveSettings}/></div></details>
    <details className="side-detail"><summary><Terminal size={16}/>{t.connectHelp}<ChevronDown size={14}/></summary><div className="detail-body muted"><p>{t.promptsHelp}</p><p><AgentMentions text={t.codexHelp} agents={providerIdentities}/></p><p><AgentMentions text={t.claudeHelp} agents={providerIdentities}/></p><p>{t.server}: <code>{d.url}</code></p>{d.agents.map(a => <div className="token-row" key={a.id}><AgentIdentity agent={a} size={18}/><IconButton label={t.newToken} icon={KeyRound} disabled={busy} onClick={() => run(async () => { if (await ask({ title: t.newToken, body: t.newTokenBody })) await mutate(`/admin/agents/${a.id}/token`); })}/></div>)}</div></details>
    <div className="side-bottom"><Button small icon={Plus} onClick={create}>{t.newDebate}</Button><Button small icon={Settings2} onClick={settings}>{t.settings}</Button></div>
  </div>;
}

function StatusBar({ debate: d }) {
  const { t } = useLanguage();
  const turn = d.agents.find(a => a.id === d.turn);
  const missing = d.proposal ? d.agents.filter(a => d.positions[a.id] !== d.proposal.id) : [];
  const consultation = d.implementation?.consultation?.pending || [];
  return <div className="status-section"><div className="status-chips"><Badge debate={d}/>{d.presence.waiting && <span className="chip presence-progress"><Users size={13}/><b>{d.presence.confirmed}/{d.presence.total}</b><span>{t.presenceCount}</span></span>}{turn && d.state !== 'closed' && <span className="chip turn-chip"><span>{d.state === 'agreed' ? t.writing : t.turnOf}</span><AgentIdentity agent={turn} size={18}/><span className="muted">{t.elapsed} <Elapsed since={d.turnStartedAt}/></span></span>}{d.implementation?.status === 'ready' && <span className="chip"><Terminal size={13}/><span>{t.implementer}</span><Identity id={d.implementation.agentId} agents={d.agents} size={17}/></span>}{d.state !== 'closed' && <span className="chip"><span>{t.round}</span><b>{d.round}</b></span>}{consultation.length > 0 && <span className="chip consultation-chip"><MessageSquare size={13}/><span>{t.consultationWaiting}</span>{consultation.map(agent => <Identity id={agent.id} agents={d.agents} size={17} key={agent.id}/>)}</span>}<span className="chip"><MessageSquare size={13}/><b>{d.totalCount}</b><span>{t.messages}</span></span></div>
    {d.proposal && <div className="proposal-line"><FileText size={14}/><span>{t.proposal} <b>#{d.proposal.id}</b></span><span className="separator">·</span><span>{t.implements}</span><Identity id={d.proposal.writer} agents={d.agents} size={17}/><span className="separator">·</span>{missing.length ? <><span>{t.waitingFor}</span>{missing.map(a => <AgentIdentity agent={a} key={a.id} size={16}/>)}</> : <span className="positive">{t.unanimous}</span>}{d.forced && <span className="warning">{t.forced}</span>}</div>}
  </div>;
}

const Message = React.memo(function Message({ message: m, agents }) {
  const { t, lang } = useLanguage();
  if (m.kind === 'system') return <div className="system-message"><span/><div><AgentMentions text={m.text} agents={agents}/></div><span/></div>;
  const tag = m.implementationReport ? `${t.reviewReport} #${m.id}` : { propose: `${t.proposed} #${m.id}`, agree: `${t.agreedWith} #${m.agree}`, pass: t.passed, final: t.finalText, hint: t.hint, decision_request: t.decisionRequest, implementation_update: t.implementationUpdate, implementation_reply: t.implementationReply, implementation_transfer: t.implementationTransfer }[m.kind];
  return <article className={`message ${m.kind} ${m.from === 'human' ? 'human' : ''}`} data-message-id={m.id}><div className="message-head"><Identity id={m.from} agents={agents} size={25}/><time dateTime={m.ts} title={formatDate(m.ts, lang)}>#{m.id} · {formatDate(m.ts, lang, true)}</time>{tag && <span className={`message-tag ${m.kind}`}>{tag}</span>}{m.replyTo && <span className="message-recipient">{t.replyToMessage} #{m.replyTo}</span>}{m.to && <span className="message-recipient">{t.to} <Identity id={m.to} agents={agents} size={17}/></span>}{m.writer && <span className="message-recipient">{t.implements} <Identity id={m.writer} agents={agents} size={17}/></span>}</div><div className="message-text"><AgentMentions text={m.text} agents={agents}/></div>{m.references.length > 0 && <div className="message-references">{m.references.map(reference => <details className="message-reference" key={`${reference.type}:${reference.token}`} data-reference-type={reference.type}><summary>{reference.type === 'agent' ? <Identity id={reference.id} agents={agents} size={15}/> : <>{reference.type === 'message' ? <MessageSquare size={13}/> : <FileText size={13}/>}<AgentMentions text={reference.label} agents={agents}/></>}<ChevronDown size={12}/></summary><div className="reference-preview"><span>{reference.truncated ? t.referenceTruncated : t.referenceSnapshot}</span><p><AgentMentions text={reference.text || reference.label} agents={agents}/></p></div></details>)}</div>}</article>;
});

function FinalSolution({ debate: d, copy, mutate, run, busy, saveSettings }) {
  const { t, lang } = useLanguage();
  return <section className="final-solution" id="final-solution"><div className="row between"><h2><Flag size={18}/>{t.finalSolution}</h2><Button small icon={Copy} onClick={() => copy(d.final.text)}>{t.copy}</Button></div><div className="final-meta">{d.final.proposal ? `${t.proposal} #${d.final.proposal} · ${d.final.forced ? t.forced : t.unanimous}` : t.noAgreement}<span>·</span><span>{t.writtenBy}</span><Identity id={d.final.writer} agents={d.agents} size={18}/><time dateTime={d.final.ts}>{formatDate(d.final.ts, lang)}</time></div><div className="message-text"><AgentMentions text={d.final.text} agents={d.agents}/></div><p className="muted final-file">{t.finalSaved}</p><Implementation debate={d} mutate={mutate} run={run} busy={busy} saveSettings={saveSettings} final/></section>;
}

function Recipient({ agents, value, setValue, onlyAgents = false, disabled = false }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false), ref = useRef(null);
  useEffect(() => { if (disabled) setExpanded(false); }, [disabled]);
  useEffect(() => { const outside = e => { if (!ref.current?.contains(e.target)) setExpanded(false); }; document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside); }, []);
  return <div className="recipient-picker" ref={ref}><button type="button" className="recipient-button" disabled={disabled} aria-label={onlyAgents ? t.implementer : t.selectRecipient} aria-haspopup="listbox" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} onKeyDown={e => { if (e.key === 'Escape') setExpanded(false); }}>{value ? <Identity id={value} agents={agents} size={18}/> : <><Users size={15}/>{onlyAgents ? t.selectAI : t.everyone}</>}<ChevronDown size={13}/></button>{expanded && <div role="listbox" aria-label={onlyAgents ? t.implementer : t.selectRecipient} className="recipient-menu">{(onlyAgents ? agents : [{ id: '', name: t.everyone }, ...agents]).map(a => <button type="button" role="option" disabled={disabled} aria-selected={a.id === value} key={a.id} onClick={() => { setValue(a.id); setExpanded(false); }}>{a.id ? <AgentIdentity agent={a} size={20}/> : <><Users size={16}/>{a.name}</>}</button>)}</div>}</div>;
}

function MessageComposer({ debate: d, hint, setHint, recipient, setRecipient, busy, onSend, awaitingReport, workflowLabel }) {
  const { t, lang } = useLanguage();
  const [mention, setMention] = useState(null), [activeIndex, setActiveIndex] = useState(0);
  const textarea = useRef(null), container = useRef(null), optionsRef = useRef(null), pendingCaret = useRef(null);
  const choices = referenceChoices(d, lang, t), options = mention ? matchingReferences(choices, mention.query) : [];
  const references = referencesInText(hint, choices), tooMany = references.length > 12;
  const selected = Math.min(activeIndex, Math.max(0, options.length - 1));
  useLayoutEffect(() => {
    const el = textarea.current;
    el.style.height = '0px'; el.style.height = `${Math.min(112, Math.max(38, el.scrollHeight))}px`;
    if (pendingCaret.current !== null) { const caret = pendingCaret.current; pendingCaret.current = null; el.focus(); el.setSelectionRange(caret, caret); }
  }, [hint]);
  useEffect(() => {
    const outside = event => { if (!container.current?.contains(event.target)) setMention(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => { optionsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected, mention?.query]);
  const cursorChanged = element => { setMention(mentionQuery(element.value, element.selectionStart)); setActiveIndex(0); };
  const insertReference = choice => {
    if (!mention || !choice) return;
    const value = hint.slice(0, mention.start) + choice.token + ' ' + hint.slice(mention.end);
    const caret = mention.start + choice.token.length + 1;
    pendingCaret.current = caret;
    setHint(value); setMention(null);
  };
  const triggerMention = () => {
    const el = textarea.current, start = el.selectionStart, end = el.selectionEnd;
    const current = mentionQuery(hint, start);
    if (current) { setMention(current); setActiveIndex(0); el.focus(); return; }
    const prefix = start > 0 && !/\s/.test(hint[start - 1]) ? ' @' : '@';
    let value = hint.slice(0, start) + prefix + hint.slice(end), caret = start + prefix.length;
    if (!mentionQuery(value, caret)) { value = `${hint}${hint && !/\s$/.test(hint) ? ' ' : ''}@`; caret = value.length; }
    if (!mentionQuery(value, caret)) { el.focus(); return; }
    pendingCaret.current = caret;
    setHint(value); setMention(mentionQuery(value, caret)); setActiveIndex(0);
  };
  const send = () => { if (!busy && hint.trim() && !tooMany) { setMention(null); onSend(references); } };
  const keyDown = event => {
    if (event.nativeEvent.isComposing) return;
    if (mention) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMention(null); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((selected + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, options.length)) % Math.max(1, options.length)); return; }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) { if (options.length) { event.preventDefault(); insertReference(options[selected]); } else if (event.key === 'Enter') { event.preventDefault(); setMention(null); } return; }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
  };
  return <footer className="composer" ref={container}>{d.state === 'closed' && <div className="closed-note" role="status"><CircleCheck size={17}/>{awaitingReport ? workflowLabel : d.implementation.status === 'pending' ? t.awaitingImplementer : d.phase === 'implementation' ? t.implementation : t.closedHelp}</div>}<form onSubmit={event => { event.preventDefault(); send(); }}>
    {mention && <div className="mention-menu"><div className="mention-heading"><AtSign size={15}/><span>{t.citeAnything}</span></div><div className="mention-options" id="mention-options" role="listbox" aria-label={t.citeAnything} ref={optionsRef}>{options.length ? options.map((choice, index) => <button type="button" className="mention-option" role="option" id={`mention-option-${index}`} aria-selected={selected === index} data-mention-type={choice.type} data-mention-id={choice.id} key={`${choice.type}:${choice.token}`} onPointerDown={event => event.preventDefault()} onClick={() => insertReference(choice)} onMouseEnter={() => setActiveIndex(index)}><span className="mention-option-icon">{choice.agent ? <AgentIdentity agent={choice.agent} size={24} showName={false}/> : choice.type === 'topic' ? <FileText size={19}/> : <MessageSquare size={19}/>}</span><span className="mention-option-content"><strong style={{ color: choice.agent ? agentColor(choice.agent) : undefined }}>{choice.label}</strong><span>{choice.text || choice.token}</span></span><span className="mention-option-token">{choice.token}</span></button>) : <div className="mention-empty">{t.noReferences}</div>}</div><div className="mention-help">{t.citeHelp}</div></div>}
    <div className="composer-entry"><button type="button" className="composer-mention-button" aria-label={t.cite} aria-haspopup="listbox" aria-expanded={Boolean(mention)} title={t.cite} onClick={triggerMention}><AtSign size={18}/></button><textarea ref={textarea} id="hintText" rows={1} aria-label={t.hint} aria-autocomplete="list" aria-controls={mention ? 'mention-options' : undefined} aria-activedescendant={mention && options.length ? `mention-option-${selected}` : undefined} value={hint} placeholder={t.hintPlaceholder} onChange={event => { setHint(event.target.value); cursorChanged(event.target); }} onClick={event => cursorChanged(event.target)} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) cursorChanged(event.target); }} onBlur={event => { if (!event.relatedTarget?.closest('.mention-menu,.composer-mention-button')) setMention(null); }} onKeyDown={keyDown}/><button className="button primary composer-send" type="submit" aria-label={t.send} title={t.send} disabled={busy || !hint.trim() || tooMany}><Send size={16}/></button></div><div className="composer-bottom"><span className="composer-help">{t.hintHelp}</span><Recipient agents={d.agents} value={recipient} setValue={setRecipient}/></div>{tooMany && <p className="field-error" role="alert">{t.referenceLimit}</p>}
  </form></footer>;
}

function Live({ debate: d, home, copyPrompt, copy, mutate, run, ask, busy, create, settings, rename, online, sound, toggleSound, saveSettings }) {
  const { t } = useLanguage();
  const [drawer, setDrawer] = useState(false), [hint, setHint] = useState(() => readLocal(`aidebate.hint.${d.id}`, '')), [recipient, setRecipient] = useState(''), [unseen, setUnseen] = useState(false);
  const chat = useRef(null), nearBottom = useRef(true);
  const turn = d.agents.find(a => a.id === d.turn);
  const awaitingReport = d.implementation.status === 'ready';
  const consultationAgent = awaitingReport && d.agents.find(a => a.id === d.implementation.consultation?.pending?.[0]?.id);
  const workingAgent = turn || consultationAgent || (awaitingReport ? d.agents.find(a => a.id === d.implementation.agentId) : null);
  const workflowLabel = consultationAgent ? t.consultationPending : t.reviewWaiting;
  const scrollBottom = () => { const el = chat.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' }); nearBottom.current = true; setUnseen(false); };
  useLayoutEffect(() => { if (nearBottom.current) scrollBottom(); else setUnseen(true); }, [d.messages.length, d.final?.ts, d.turn]);
  useEffect(() => { writeLocal(`aidebate.hint.${d.id}`, hint); }, [hint, d.id]);
  useEffect(() => { const onKey = e => { if (e.key === 'Escape') setDrawer(false); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, []);
  const submit = references => run(async () => { const submitted = hint; if (!submitted.trim()) return; await mutate('/admin/hint', { text: submitted.trim(), to: recipient || undefined, references }, 'POST', d.id); setHint(current => current === submitted ? '' : current); });
  const sideProps = { debate: d, home, copyPrompt, mutate, run, ask, busy, create, settings, saveSettings };
  return <div className="live-layout"><aside className={`sidebar ${drawer ? 'drawer-open' : ''}`}><Sidebar {...sideProps}/>{drawer && <IconButton label={t.close} icon={X} onClick={() => setDrawer(false)}/>}</aside>{drawer && <button className="drawer-backdrop" aria-label={t.close} onClick={() => setDrawer(false)}/>}
    <main className="live-main"><header className="live-header"><div className="row between live-title"><div className="row grow"><span className="mobile-only"><IconButton label={t.agents} icon={PanelLeft} onClick={() => setDrawer(true)}/></span><h1><AgentMentions text={d.title} agents={d.agents}/></h1><IconButton label={t.rename} icon={Pencil} disabled={busy} onClick={() => rename(d)}/></div><div className="row"><Connection online={online}/><IconButton label={sound ? t.soundOn : t.soundOff} icon={sound ? Volume2 : VolumeX} onClick={toggleSound}/><IconButton label={t.settings} icon={Settings2} onClick={settings}/></div></div><StatusBar debate={d}/></header>
      <div id="chat" className="chat" ref={chat} role="log" aria-label={t.messages} aria-live="polite" aria-relevant="additions" onScroll={() => { const el = chat.current; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; if (nearBottom.current) setUnseen(false); }}><div className="chat-inner">{d.messages.length ? d.messages.map(m => <Message key={m.id} message={m} agents={d.agents}/>) : <div className="empty chat-empty"><MessageSquare size={30}/><h2>{t.noMessages}</h2><p>{t.noMessagesHelp}</p><div className="row wrap center">{d.agents.map(a => <Button key={a.id} small onClick={() => copyPrompt(a.id)}><AgentIdentity agent={a} size={20}/><Copy size={14}/></Button>)}</div></div>}
      {d.final && <FinalSolution debate={d} copy={copy} mutate={mutate} run={run} busy={busy} saveSettings={saveSettings}/>}
      {workingAgent && (d.state !== 'closed' || awaitingReport) && <div className="thinking-card" style={{ '--agent-accent': agentColor(workingAgent) }}><ThinkingOrb agent={workingAgent} label={`${workingAgent.name}: ${awaitingReport ? workflowLabel : t.thinking}`}/><div><div className="row wrap"><AgentIdentity agent={workingAgent} size={21}/><span className="thinking-dots"><i/><i/><i/></span></div><p>{awaitingReport ? workflowLabel : d.state === 'agreed' ? t.writing : t.thinking}</p><span className="thinking-time"><Clock3 size={12}/><Elapsed since={awaitingReport ? d.implementation.assignedAt : d.turnStartedAt}/></span></div></div>}
      </div></div>{unseen && <Button className="new-messages-button" small tone="primary" icon={ArrowDown} onClick={scrollBottom}>{t.newMessages}</Button>}
      <MessageComposer debate={d} hint={hint} setHint={setHint} recipient={recipient} setRecipient={setRecipient} busy={busy} onSend={submit} awaitingReport={awaitingReport} workflowLabel={workflowLabel}/>
    </main>
  </div>;
}

function App() {
  const [preference, updatePreference] = useState(() => readLocal('aidebate.language', 'system'));
  const [lang, setLang] = useState(() => resolveLanguage(readLocal('aidebate.language', 'system')));
  const t = messages[lang];
  const languageRef = useRef({ preference, lang, t }); languageRef.current = { preference, lang, t };
  const [sound, updateSound] = useState(audioEnabled), [online, setOnline] = useState(true), [loaded, setLoaded] = useState(false), [preferencesLoaded, setPreferencesLoaded] = useState(false), [busy, setBusy] = useState(false);
  const busyRef = useRef(false), [debates, setDebates] = useState([]), [states, setStates] = useState({}), [settingsOpen, setSettingsOpen] = useState(false), [dialog, setDialog] = useState(null), [toasts, setToasts] = useState([]);
  const initialId = new URLSearchParams(location.hash.slice(1)).get('debate');
  const [route, setRoute] = useState({ view: initialId ? 'live' : 'home', id: initialId });
  const [wizard, setWizard] = useState({ step: 1, title: '', topic: '', id: null });
  const selection = useRef(null); selection.current = route.view === 'wizard' ? wizard.id : route.id;
  const dataRef = useRef({}), watermarks = useRef(new Map()), syncLock = useRef(false), syncAgain = useRef(false), dead = useRef(false);
  const syncRef = useRef(null), toastTimers = useRef(new Set());
  const notify = useCallback((text, bad = false) => { const id = crypto.randomUUID(); setToasts(items => [...items.filter(item => item.text !== text || item.bad !== bad).slice(-2), { id, text, bad }]); const timer = setTimeout(() => { toastTimers.current.delete(timer); setToasts(items => items.filter(item => item.id !== id)); }, 4200); toastTimers.current.add(timer); }, []);
  const errorMessage = error => {
    const tr = languageRef.current.t;
    if (error.code === 'waiting_for_agents') return [error.presence.total < 2 ? tr.readinessNeedsAgents : '', error.waitingFor.length ? `${tr.waitingForRelease} ${error.waitingFor.map(a => a.name).join(', ')}` : ''].filter(Boolean).join(' ');
    const known = { bad_admin: tr.badAdmin, no_such_debate: tr.notFound, debate_started: lang === 'pt' ? 'O debate já começou; os participantes não podem ser alterados.' : 'The debate has started; participants cannot be changed.' };
    return known[error.code] || (error.code ? `${tr.requestError} (${error.code})` : error.message || tr.requestError);
  };
  const sync = useCallback(async () => {
    if (syncLock.current) { syncAgain.current = true; return; }
    syncLock.current = true;
    try {
      do {
        syncAgain.current = false;
        const list = await request('/admin/debates');
        if (dead.current) return;
        const wanted = new Set(selection.current ? [selection.current] : []);
        for (const d of list) {
          const seen = watermarks.current.get(d.id);
          if (seen && (seen.count !== d.count || seen.updatedAt !== d.updatedAt)) wanted.add(d.id);
          if (!seen) watermarks.current.set(d.id, { count: d.count, id: d.lastAgentMessageId, updatedAt: d.updatedAt, initial: true });
        }
        const fetched = await Promise.all([...wanted].map(async id => {
          try { return await request('/state', { id }); }
          catch (e) { if (e.code === 'no_such_debate') return { id, deleted: true }; throw e; }
        }));
        if (dead.current) return;
        const next = { ...dataRef.current };
        for (const d of fetched) {
          if (d.deleted) { delete next[d.id]; continue; }
          const seen = watermarks.current.get(d.id);
          const ai = d.messages.filter(m => m.from !== 'human' && m.from !== 'system');
          if (seen && !seen.initial) {
            const fresh = ai.filter(m => m.id > seen.id);
            for (const m of fresh) playMessageSound();
          }
          watermarks.current.set(d.id, { id: ai.at(-1)?.id || 0, count: d.count, updatedAt: d.updatedAt, initial: false });
          next[d.id] = d;
        }
        for (const d of list) {
          const seen = watermarks.current.get(d.id);
          if (seen?.initial) watermarks.current.set(d.id, { ...seen, initial: false });
        }
        const ids = new Set(list.map(d => d.id));
        for (const id of Object.keys(next)) if (!ids.has(id)) delete next[id];
        dataRef.current = next; setStates(next); setDebates(list); setOnline(true); setLoaded(true); try { sessionStorage.removeItem('aidebate.session-refresh'); } catch {}
      } while (syncAgain.current && !dead.current);
    } catch (error) { if (!dead.current) { setOnline(false); if (error.code === 'bad_admin' && !renewModeratorSession()) notify(languageRef.current.t.badAdmin, true); } }
    finally { syncLock.current = false; }
  }, [notify]);
  syncRef.current = sync;
  useEffect(() => {
    dead.current = false;
    const unlock = () => { void unlockAudio(); };
    document.addEventListener('pointerdown', unlock); document.addEventListener('keydown', unlock);
    sync();
    const events = new EventSource('/events');
    const change = () => sync();
    events.addEventListener('ready', change); events.addEventListener('change', change); events.onerror = () => setOnline(false);
    const resyncTimer = setInterval(sync, 10000);
    const visible = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', visible); window.addEventListener('online', change);
    request('/admin/settings').then(settings => { if (dead.current) return; const pref = settings.languagePreference; updatePreference(pref); setLang(resolveLanguage(pref)); writeLocal('aidebate.language', pref); setPreferencesLoaded(true); }).catch(() => {});
    return () => { dead.current = true; events.close(); clearInterval(resyncTimer); document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', change); for (const timer of toastTimers.current) clearTimeout(timer); };
  }, [sync]);
  useEffect(() => { const onHash = () => { const id = new URLSearchParams(location.hash.slice(1)).get('debate'); setRoute({ view: id ? 'live' : 'home', id }); }; window.addEventListener('hashchange', onHash); window.addEventListener('popstate', onHash); return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('popstate', onHash); }; }, []);
  useEffect(() => { sync(); }, [route.id, wizard.id, sync]);
  useEffect(() => {
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
    document.title = t.appName;
    const changed = () => { if (preference === 'system') setLang(resolveLanguage('system')); };
    window.addEventListener('languagechange', changed);
    return () => window.removeEventListener('languagechange', changed);
  }, [preference, lang, t]);
  useEffect(() => {
    if (!loaded || !preferencesLoaded) return;
    request('/admin/settings', { method: 'PUT', id: selection.current || undefined, body: { languagePreference: preference, language: lang } }).then(sync).catch(() => {});
  }, [lang, preference, loaded, preferencesLoaded]);
  const run = async fn => { if (busyRef.current) return; busyRef.current = true; setBusy(true); try { return await fn(); } catch (error) { notify(errorMessage(error), true); } finally { busyRef.current = false; setBusy(false); } };
  const mutate = async (path, body, method = 'POST', id = selection.current) => { const result = await request(path, { method, body, id }); await sync(); return result; };
  const saveSettings = async (path, body, id) => { try { const result = await request(path, { method: 'PUT', body, id }); await sync(); notify(languageRef.current.t.saved); return result; } catch (error) { notify(errorMessage(error), true); throw error; } };
  const ask = spec => new Promise(resolve => setDialog({ ...spec, resolve }));
  const copy = async text => {
    try { await navigator.clipboard.writeText(text); }
    catch { throw new Error(t.copyError); }
    notify(t.copied);
  };
  const setPreference = value => run(async () => {
    const resolved = resolveLanguage(value);
    await request('/admin/settings', { method: 'PUT', id: selection.current || undefined, body: { languagePreference: value, language: resolved } });
    updatePreference(value); setLang(resolved); writeLocal('aidebate.language', value); await sync(); notify(messages[resolved].saved);
  });
  const setSound = value => { audioEnabled = value; updateSound(value); writeLocal('aidebate.sound', String(value)); if (value) void unlockAudio(); notify(t.saved); };
  const home = () => { if (busyRef.current) return; history.pushState(null, '', location.pathname); setRoute({ view: 'home', id: null }); sync(); };
  const open = id => { if (busyRef.current) return; history.pushState(null, '', `#debate=${encodeURIComponent(id)}`); setRoute({ view: 'live', id }); };
  const create = () => { if (busyRef.current) return; setWizard({ step: 1, title: '', topic: '', id: null }); setRoute({ view: 'wizard', id: null }); history.pushState(null, '', location.pathname); };
  const setup = d => { if (busyRef.current) return; setWizard({ step: 2, title: d.title, topic: d.topic, id: d.id }); setRoute({ view: 'wizard', id: null }); history.pushState(null, '', location.pathname); };
  const rename = d => ask({ key: `title:${d.id}`, title: t.renameTitle, input: true, value: d.title, autosave: title => saveSettings(`/admin/debates/${d.id}`, { title }, d.id) });
  const remove = d => run(async () => { if (await ask({ title: t.deleteTitle, body: t.deleteBody, danger: true, ok: t.delete })) await mutate(`/admin/debates/${d.id}`, undefined, 'DELETE', d.id); });
  const copyPrompt = id => run(async () => {
    const current = selection.current;
    await request('/admin/settings', { method: 'PUT', id: current, body: { language: lang } });
    const agents = await request('/admin/agents', { id: current });
    const a = agents.find(a => a.id === id); if (!a) throw new Error(t.notFound);
    await copy(a.prompt);
  });
  const selected = states[selection.current];
  const waitingForPresence = route.view === 'live' && selected?.presence.waiting && selected.agents.length >= 2;
  const feedback = <ToastList items={toasts} agents={selected?.agents || providerIdentities}/>;
  useEffect(() => { if (!busy && route.view === 'live' && selected?.presence.waiting && selected.agents.length < 2) setup(selected); }, [busy, route.view, selected?.id, selected?.presence.waiting, selected?.agents.length]);
  return <Language.Provider value={{ lang, t }}>
    {route.view === 'home' && <Home debates={debates} online={online} loaded={loaded} open={open} create={create} rename={rename} remove={remove} settings={() => setSettingsOpen(true)} busy={busy}/>}
    {route.view === 'wizard' && <Wizard wizard={wizard} setWizard={setWizard} debate={selected} busy={busy} run={run} mutate={mutate} saveSettings={saveSettings} createDebate={async w => { const d = await request('/admin/debates', { method: 'POST', body: { title: w.title.trim(), topic: w.topic, language: lang } }); dataRef.current = { ...dataRef.current, [d.id]: d }; setStates(dataRef.current); await sync(); return d; }} goHome={home} open={open} ask={ask} settings={() => setSettingsOpen(true)}/>}
    {route.view === 'live' && (selected ? selected.presence.waiting ? waitingForPresence && <ReadinessModal key={selected.id} debate={selected} copyPrompt={copyPrompt} busy={busy} feedback={feedback}/> : <Live key={selected.id} debate={selected} home={home} copyPrompt={copyPrompt} copy={text => run(() => copy(text))} mutate={mutate} run={run} ask={ask} busy={busy} create={create} settings={() => setSettingsOpen(true)} rename={rename} online={online} sound={sound} toggleSound={() => setSound(!sound)} saveSettings={saveSettings}/> : <div className="empty"><LoaderCircle className="spin"/><p>{loaded ? t.notFound : t.loading}</p><Button onClick={home} icon={ArrowLeft}>{t.history}</Button></div>)}
    {settingsOpen && <Preferences preference={preference} setPreference={setPreference} sound={sound} setSound={setSound} close={() => setSettingsOpen(false)} notify={notify} feedback={feedback}/>}
    {dialog && <Dialog spec={dialog} feedback={feedback} onClose={value => { const resolve = dialog.resolve; setDialog(null); resolve(value); }}/>}
    {!online && <div className="offline-banner" role="status"><WifiOff size={14}/>{t.offline}</div>}
    {!waitingForPresence && !settingsOpen && !dialog && feedback}
  </Language.Provider>;
}

createRoot(document.getElementById('app')).render(<App/>);
