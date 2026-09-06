'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

const PORT = +(process.argv[2] || process.env.PORT || 8787);
const P = f => path.join(__dirname, f);
const URL_ = `http://127.0.0.1:${PORT}`;
const LIMIT = 262144;
const KINDS = {
  claude: { color: '#d97757', wait: 50, maxTime: 60 },
  codex:  { color: '#10a37f', wait: 8,  maxTime: 15 },
  gemini: { color: '#4285f4', wait: 20, maxTime: 30 },
  other:  { color: '#6b7280', wait: 20, maxTime: 30 },
};
const rnd = n => crypto.randomBytes(n).toString('hex');
const fresh = () => ({ state: 'open', phase: 'debate', phaseStartId: 1, reviewCycle: 0, turn: null, turnStartedAt: null, writer: null, forced: false, agreedOn: null, messages: [], final: null });
const languageOf = value => String(value || '').toLowerCase().startsWith('en') ? 'en' : 'pt';
const implementationModes = ['choose', 'proposal', 'agent', 'none'];
const normalizeImplementation = d => {
  const value = d.implementation || {}, mode = implementationModes.includes(value.mode) ? value.mode : 'proposal';
  const hasFinal = d.agreedOn != null && d.final?.writer !== 'human' && Boolean(String(d.final?.text || '').trim());
  const reason = d.state !== 'closed' ? null : mode === 'none' ? 'disabled_by_moderator' : !hasFinal ? 'no_final_solution' : value.unanimousOnly && d.forced ? 'unanimity_required' : null;
  return {
    mode, agentId: typeof value.agentId === 'string' ? value.agentId : null, unanimousOnly: value.unanimousOnly === true, reviewAfter: value.reviewAfter === true,
    status: ['waiting', 'pending', 'ready', 'reviewing', 'completed', 'disabled'].includes(value.status) ? value.status : d.state === 'closed' ? reason ? 'disabled' : 'pending' : 'waiting',
    reason: ['disabled_by_moderator', 'no_final_solution', 'unanimity_required', 'agent_unavailable', 'moderator_stop'].includes(value.reason) ? value.reason : reason,
    assignedAt: value.assignedAt || null, assignmentId: value.assignmentId || null, report: value.report || null, completedAt: value.completedAt || null
  };
};

const DATA = P('data'), DEBS = path.join(DATA, 'debates');
const debFile = id => path.join(DEBS, id + '.json');
const iso = () => new Date().toISOString();
const pad = n => String(n).padStart(2, '0');
const newId = () => { const d = new Date();
  const base = `d${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  let id = base, k = 2; while (fs.existsSync(debFile(id)) || debates.has(id)) id = `${base}-${k++}`; return id; };
const titleNow = language => { const d = new Date(); return `${language === 'en' ? 'Debate' : 'Debate de'} ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const okId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const normalize = d => { const implementation = normalizeImplementation(d);
  const fields = Object.fromEntries(['id', 'title', 'topic', 'maxRounds', 'createdAt', 'updatedAt', 'state', 'turn', 'writer', 'forced', 'agreedOn', 'final'].filter(key => Object.hasOwn(d, key)).map(key => [key, d[key]]));
  return ({ ...fresh(), title: '', topic: '', maxRounds: 6, createdAt: iso(), updatedAt: iso(), ...fields, language: languageOf(d.language),
  implementation, phase: ['debate', 'implementation', 'review', 'finished'].includes(d.phase) ? d.phase : d.state === 'closed' ? ['pending', 'ready'].includes(implementation.status) ? 'implementation' : 'finished' : 'debate',
  phaseStartId: Number.isInteger(d.phaseStartId) && d.phaseStartId > 0 ? d.phaseStartId : 1, reviewCycle: Number.isInteger(d.reviewCycle) && d.reviewCycle >= 0 ? d.reviewCycle : 0,
  turnStartedAt: d.turnStartedAt || (Array.isArray(d.messages) ? d.messages : []).findLast(m => m.from !== 'human')?.ts || d.createdAt || iso(),
  agents: Array.isArray(d.agents) ? d.agents.map(a => ({ ...a, confirmedAt: typeof a.confirmedAt === 'string' ? a.confirmedAt : null })) : [], messages: Array.isArray(d.messages) ? d.messages : [] }); };
const freshDebate = (o = {}) => { const language = languageOf(o.language || APP?.language); return normalize({ id: newId(), language, title: String(o.title || '').trim() || titleNow(language), topic: String(o.topic || ''), createdAt: iso(), updatedAt: iso() }); };
const debateIds = () => { try { return fs.readdirSync(DEBS).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(okId); } catch { return []; } };
const loadDebate = id => { if (!okId(id)) return null;
  try { const d = JSON.parse(fs.readFileSync(debFile(id), 'utf8')); return d && typeof d === 'object' ? normalize({ ...d, id }) : null; } catch { return null; } };

let APP, S;
let waiters = [];
const debates = new Map(), subscribers = new Set(), pendingWrites = new Map();

let dirty = false;
const writeJson = (file, obj) => { const json = JSON.stringify(obj, null, 1);
  try { fs.mkdirSync(DEBS, { recursive: true }); fs.writeFileSync(file + '.tmp', json); fs.renameSync(file + '.tmp', file); return true; }
  catch (e1) { try { fs.writeFileSync(file, json); return true; } catch (e2) { console.error(`${path.basename(file)} nao gravado, tento de novo em 3 s:`, e2.code || e2.message); return false; } } };
const writeDebate = d => { d.updatedAt = iso(); return writeJson(debFile(d.id), d); };
const saveApp = () => writeJson(path.join(DATA, 'app.json'), { admin: APP.admin, waitSeconds: APP.waitSeconds, activeId: APP.activeId, languagePreference: APP.languagePreference, language: APP.language });
const save = () => { debates.set(S.id, S); const a = saveApp(), b = writeDebate(S); if (b) pendingWrites.delete(S.id); else pendingWrites.set(S.id, S); dirty = !a || pendingWrites.size > 0; };
setInterval(() => { if (!dirty) return; const a = saveApp(); for (const [id, d] of pendingWrites) if (writeDebate(d)) pendingWrites.delete(id); dirty = !a || pendingWrites.size > 0; }, 3000).unref();

(function boot() {
  try { fs.mkdirSync(DEBS, { recursive: true }); } catch {}
  try { APP = JSON.parse(fs.readFileSync(path.join(DATA, 'app.json'), 'utf8')) || {}; } catch { APP = {}; }
  if (typeof APP !== 'object' || Array.isArray(APP)) APP = {};
  APP.admin = APP.admin || rnd(8);
  APP.waitSeconds = +APP.waitSeconds >= 5 ? +APP.waitSeconds : 50;
  APP.languagePreference = ['system', 'pt', 'en'].includes(APP.languagePreference) ? APP.languagePreference : 'system';
  APP.language = languageOf(APP.language);
  S = loadDebate(APP.activeId) || loadDebate(debateIds().sort().at(-1)) || freshDebate();
  APP.activeId = S.id;
  debates.set(S.id, S);
})();
const getDebate = id => { if (!okId(id)) return null; if (debates.has(id)) return debates.get(id); const d = loadDebate(id); if (d) debates.set(id, d); return d; };
const localized = (pt, en) => S.language === 'en' ? en : pt;
const defaultRole = index => index === 0
  ? localized('Proponente: proponha uma solução concreta com evidências; revise quando refutado.', 'Proposer: present a concrete solution with evidence; revise when challenged.')
  : localized('Crítico: teste a proposta com evidências antes de concordar; sugira uma alternativa melhor.', 'Critic: test the proposal against evidence before agreeing; suggest a better alternative.');

const N = () => S.agents.length;
const ids = () => S.agents.map(a => a.id);
const agent = id => S.agents.find(a => a.id === id);
const nameOf = id => id === 'human' ? localized('moderador', 'moderator') : id === 'system' ? localized('sistema', 'system') : (agent(id) || {}).name || id;
const agentMsgs = () => S.messages.filter(m => m.from !== 'human' && m.from !== 'system');
const presence = () => {
  const confirmed = S.agents.filter(a => a.confirmedAt).length, total = N();
  return { required: true, waiting: S.state === 'open' && S.phase === 'debate' && agentMsgs().length === 0 && (total < 2 || confirmed < total), confirmed, total };
};
const waitingFor = () => presence().waiting ? S.agents.filter(a => !a.confirmedAt).map(a => ({ id: a.id, name: a.name })) : [];
const waitingMessage = () => {
  const pending = waitingFor(), names = new Intl.ListFormat(S.language === 'en' ? 'en' : 'pt-BR', { style: 'long', type: 'conjunction' }).format(pending.map(a => a.name));
  return [
    localized('O debate está bloqueado.', 'The debate is locked.'),
    N() < 2 ? localized('São necessárias pelo menos 2 IAs participantes.', 'At least 2 AI participants are required.') : '',
    pending.length ? localized(`Aguardando ${names} ${pending.length === 1 ? 'liberar' : 'liberarem'} o chat com POST /ready.`, `Waiting for ${names} to unlock the chat with POST /ready.`) : localized('Adicione participantes para liberar o chat.', 'Add participants to unlock the chat.')
  ].filter(Boolean).join(' ');
};
const phaseMessages = () => S.messages.filter(m => m.id >= S.phaseStartId);
const phaseAgentMsgs = () => phaseMessages().filter(m => m.from !== 'human' && m.from !== 'system' && m.kind !== 'implementation_report');
const count = () => phaseAgentMsgs().length;
const maxMessages = () => S.maxRounds * N();
const round = () => N() ? Math.min(Math.floor(count() / N()) + 1, S.maxRounds) : 1;
const nextAfter = id => { const i = S.agents.findIndex(a => a.id === id); return S.agents[(i + 1) % N()].id; };
const resumeAfter = (asker, answered) => { const r = nextAfter(asker); return r === answered ? nextAfter(answered) : r; };
const turn = () => S.state === 'closed' || presence().waiting ? null : S.state === 'agreed' ? S.writer : N() < 2 ? null
  : (S.turn && agent(S.turn) ? S.turn : S.agents[0].id);
const syncTurnStartedAt = (previousTurn, previousDebateId = S.id) => {
  const currentTurn = turn();
  if (!currentTurn) S.turnStartedAt = null;
  else if ((S.id === previousDebateId && currentTurn !== previousTurn) || !S.turnStartedAt) S.turnStartedAt = iso();
};
const proposals = () => phaseMessages().filter(m => m.kind === 'propose');
const proposal = () => proposals().at(-1) || null;
const adopted = () => (S.agreedOn != null && S.messages.find(m => m.id === S.agreedOn)) || proposal();
const activityOf = id => {
  const last = S.messages.findLast(m => m.from === id);
  const acceptance = S.messages.findLast(m => m.from === id && m.id >= S.phaseStartId && (m.kind === 'propose' || m.kind === 'agree'));
  const proposalId = acceptance ? acceptance.kind === 'propose' ? acceptance.id : acceptance.agree : null;
  return { lastMessage: last ? { id: last.id, ts: last.ts, text: last.text, kind: last.kind } : null,
    acceptance: acceptance ? { proposalId, ts: acceptance.ts, kind: acceptance.kind, active: proposalId === adopted()?.id } : null };
};
const positions = () => { const pos = {}; for (const m of phaseMessages()) { if (m.kind === 'propose') pos[m.from] = m.id; else if (m.kind === 'agree') pos[m.from] = m.agree; } return pos; };
const lastOwn = me => { const m = S.messages.findLast(x => x.from === me); return m ? m.id : 0; };
const next = me => S.state === 'closed' ? S.implementation.status === 'pending' ? 'GET /wait' : S.implementation.status === 'ready' ? S.implementation.agentId === me ? 'implement' : S.implementation.reviewAfter ? 'GET /wait' : 'stop' : 'stop' : presence().waiting && !agent(me)?.confirmedAt ? 'POST /ready' : turn() !== me ? 'GET /wait'
  : S.state === 'agreed' ? 'POST /say?final=1' : count() === 0 ? 'POST /say?propose=AGENT_ID' : 'POST /say';
const implementationView = me => ({ ...S.implementation, ...(next(me) === 'implement' ? { text: S.final.text, proposal: S.agreedOn, reportEndpoint: 'POST /implementation/report' } : {}) });
const publicProposal = p => p && { id: p.id, from: p.from, writer: p.writer, reviewCompletion: p.reviewCompletion === true };
const pub = m => ({ id: m.id, ts: m.ts, from: m.from, name: nameOf(m.from), kind: m.kind, to: m.to, writer: m.writer, agree: m.agree, text: m.text, references: m.references || [], ...(m.reviewCompletion ? { reviewCompletion: true } : {}), ...(m.implementationReport ? { implementationReport: m.implementationReport } : {}) });
const referencesFor = (input, text) => {
  const invalid = (pt, en) => ({ error: 'invalid_references', message: localized(pt, en) });
  if (input === undefined) return { references: [] };
  if (!Array.isArray(input) || input.length > 12) return invalid('Envie uma lista com no máximo 12 citações.', 'Send a list containing at most 12 references.');
  const references = [], seen = new Set();
  for (const reference of input) {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return invalid('Cada citação deve informar seu tipo e token.', 'Each reference must specify its type and token.');
    const { type, id, token } = reference;
    let expected, label, source;
    if (type === 'agent') {
      const target = typeof id === 'string' && agent(id);
      if (!target) return invalid('Escolha uma IA participante deste debate para citar.', 'Choose an AI participating in this debate to reference.');
      expected = `@${id}`; label = target.name; source = target.role;
    } else if (type === 'message') {
      const target = Number.isInteger(id) && S.messages.find(m => m.id === id);
      if (!target) return invalid('Escolha uma mensagem existente neste debate para citar.', 'Choose an existing message in this debate to reference.');
      expected = `@#${id}`; label = `#${id} · ${nameOf(target.from)}`; source = target.text;
    } else if (type === 'topic') {
      expected = ['@/assunto', '@/topic'].includes(token) ? token : '@/topic'; label = localized('Assunto', 'Topic'); source = S.topic;
    } else return invalid('O tipo da citação deve ser agent, message ou topic.', 'The reference type must be agent, message or topic.');
    if (token !== expected) return invalid(`Use o token ${expected} para esta citação.`, `Use the token ${expected} for this reference.`);
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`(?<![\\p{L}\\p{N}_@#-])${escaped}(?![\\p{L}\\p{N}_@#-])`, 'u').test(text)) return invalid(`Inclua ${token} como uma citação separada no texto da mensagem.`, `Include ${token} as a separate reference in the message text.`);
    const key = `${type}:${type === 'topic' ? '' : id}:${token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    source = String(source || '');
    references.push({ type, ...(type === 'topic' ? {} : { id }), token, label, text: source.slice(0, 2000), truncated: source.length > 2000 });
  }
  return { references };
};
const view = me => {
  const p = adopted(), first = lastOwn(me) === 0;
  return { debateId: S.id, language: S.language, state: S.state, phase: S.phase, phaseStartId: S.phaseStartId, reviewCycle: S.reviewCycle, presence: presence(), waitingFor: waitingFor(), you: me, turn: turn(), yourTurn: turn() === me, round: round(), maxRounds: S.maxRounds, count: count(), totalCount: agentMsgs().length, maxMessages: maxMessages(),
    proposal: publicProposal(p), agreedOn: S.agreedOn, positions: positions(), writer: S.writer, forced: S.forced,
    implementation: implementationView(me),
    instruction: presence().waiting ? `${waitingMessage()} ${next(me) === 'POST /ready' ? localized('Envie esse comando obrigatório com seu próprio token para liberar o chat. Copiar o prompt não libera o chat. O moderador pode enviar mensagens; elas não liberam a participação das IAs.', 'Send this mandatory command using your own token to unlock the chat. Copying the prompt does not unlock it. The moderator may send messages; they do not release AI participation.') : localized('Sua liberação já foi confirmada. Continue com GET /wait.', 'Your release is already confirmed. Continue with GET /wait.')}` : next(me) === 'implement'
      ? localized(`Implemente implementation.text e valide a mudança. Só você está autorizado. ${S.implementation.reviewAfter ? 'Depois envie POST /implementation/report com JSON {assignmentId,summary,files:[caminhos],verification,reviewRequest}, usando implementation.assignmentId e descrevendo o que mudou, onde, como verificou e pedindo opiniões. Volte a /wait para a revisão; não encerre ainda.' : 'Informe o resultado e conclua; o relatório em POST /implementation/report é opcional.'}`, `Implement implementation.text and validate the change. Only you are authorized. ${S.implementation.reviewAfter ? 'Then POST /implementation/report with JSON {assignmentId,summary,files:[paths],verification,reviewRequest}, using implementation.assignmentId and describing changes, locations, checks, and asking peers for opinions. Return to /wait for review; do not stop yet.' : 'Report the result and finish; POST /implementation/report is optional.'}`)
      : S.phase === 'review' ? localized('Revise os arquivos e testes do relatório. A proposta reviewCompletion:true aprova a implementação e encerra após o texto final; ?propose=ID propõe novas mudanças. Siga next e não edite até next:"implement".', 'Review the reported files and tests. A reviewCompletion:true proposal approves the implementation and finishes after the final text; ?propose=ID proposes new changes. Follow next and do not edit before next:"implement".')
      : localized('Responda em português. Siga next: GET /wait continua mesmo em state:"closed". Não implemente sem next:"implement"; com next:"stop", pare.', 'Respond in English. Follow next: GET /wait continues even in state:"closed". Do not implement without next:"implement"; stop only at next:"stop".'),
    ...(first ? { topic: S.topic, agents: S.agents.map(a => ({ id: a.id, name: a.name, role: a.role, confirmedAt: a.confirmedAt })) } : {}),
    messages: S.messages.filter(m => m.id > lastOwn(me)).map(pub), next: next(me) };
};
const publicState = () => ({ id: S.id, title: S.title, activeId: APP.activeId, createdAt: S.createdAt, updatedAt: S.updatedAt,
  language: S.language, languagePreference: APP.languagePreference, appLanguage: APP.language, turnStartedAt: turn() ? S.turnStartedAt : null, presence: presence(), waitingFor: waitingFor(),
  state: S.state, phase: S.phase, phaseStartId: S.phaseStartId, reviewCycle: S.reviewCycle, turn: turn(), round: round(), maxRounds: S.maxRounds, waitSeconds: APP.waitSeconds, count: count(), totalCount: agentMsgs().length, maxMessages: maxMessages(),
  writer: S.writer, forced: S.forced, agreedOn: S.agreedOn, topic: S.topic, url: URL_, proposal: publicProposal(proposal()),
  positions: positions(), agents: S.agents.map(a => ({ id: a.id, name: a.name, kind: a.kind, role: a.role, color: a.color, confirmedAt: a.confirmedAt, activity: activityOf(a.id) })), messages: S.messages.map(pub), final: S.final, implementation: { ...S.implementation },
  lastTs: (S.messages.at(-1) || {}).ts || null });

const ascii = s => s.replace(/[\u0080-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const englishHints = {
  bad_encoding: 'Write UTF-8 without BOM using the agent file-writing tool, never echo/Set-Content/Out-File.',
  to_only_with_plain_message: 'Use ?to= only with an ordinary message and no other flag.',
  empty_text: 'Send the message file using --data-binary "@.ai-debate/AGENT_ID.md".',
  not_ready: 'The moderator has not created two agents yet; use GET /wait.',
  closed: 'The debate has ended; follow next while implementation is assigned.',
  not_your_turn: 'Use GET /wait. If lastFrom is you, your previous message was accepted.',
  need_final: 'In agreed state, send POST /say?final=1 with the final solution.',
  not_agreed: 'Send the final solution only after agreement.',
  first_message_must_propose: 'Use ?propose=AGENT_ID for the chosen implementer.',
  bad_propose: 'Use ?propose=AGENT_ID for the chosen implementer.',
  no_chained_direct: 'Answer the directed question without ?to to resume the normal order.',
  no_direct_on_last_message: 'This is the final message: argue, ?agree=N, or ?pass=1.',
  last_round_no_propose: 'In the final round, argue, ?agree=N, or ?pass=1.',
  too_early_to_agree: 'Challenge the proposal with evidence in round 1; agreement begins in round 2.',
  bad_agree: 'Agree only with latestProposal; propose an older solution again to revisit it.',
  own_proposal: 'You cannot agree with your own proposal; argue or wait for others.',
  all_passed: 'All other agents passed; agree with the current proposal or propose again.',
  bad_admin: `Reload the panel at ${URL_} to receive its administration key.`,
  title_required: 'Enter a debate title.',
  debate_started: 'Create a new debate before changing its participants.',
  maxRounds_2_50: 'Choose between 2 and 50 rounds.',
  maxRounds_below_current_round: 'The debate has already reached a later round; use Force decision to finish.',
  no_proposal: 'There is no proposal to adopt yet.',
  panel_missing: 'panel.html must be beside server.js.'
};
const send = (res, code, obj) => { if (res.writableEnded) return; if (S.language === 'en' && obj?.hint) obj = { ...obj, hint: obj.duplicate ? 'Your identical previous message was accepted; read messages and respond to what followed.' : englishHints[obj.error] || obj.hint }; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(ascii(JSON.stringify(obj)) + '\n'); };
const fail = (res, code, me, obj) => send(res, code, { ...obj, you: me, state: S.state, turn: turn(), presence: presence(), implementation: implementationView(me), next: next(me) });
const rejectWaiting = (res, me) => {
  const payload = { error: 'waiting_for_agents', message: waitingMessage(), waitingFor: waitingFor(), presence: presence() };
  return me === undefined ? send(res, 409, payload) : fail(res, 409, me, payload);
};
const announce = (d = S) => { const event = `event: change\ndata: ${JSON.stringify({ debateId: d.id, updatedAt: d.updatedAt, activeId: APP.activeId })}\n\n`; for (const res of subscribers) if (!res.writableEnded) res.write(event); };
const wake = () => { const ws = waiters.filter(w => w.debateId === S.id); waiters = waiters.filter(w => w.debateId !== S.id); for (const w of ws) { clearTimeout(w.t); send(w.res, 200, view(w.me)); } announce(); };
const body = (req, cb) => { const d = S, chunks = []; let size = 0; req.on('data', chunk => { size += chunk.length; if (size <= LIMIT + 1) chunks.push(chunk); }).on('end', () => withDebate(d, () => cb(size > LIMIT ? Buffer.alloc(LIMIT + 1) : Buffer.concat(chunks)))); };
const push = (from, kind, text, extra = {}) => { const m = { id: ((S.messages.at(-1) || {}).id || 0) + 1, ts: new Date().toISOString(), from, kind, text, ...extra }; S.messages.push(m); if (from !== 'human') S.turnStartedAt = m.ts; return m; };

const evict = id => { const ws = waiters.filter(w => w.debateId === id); waiters = waiters.filter(w => w.debateId !== id); for (const w of ws) { clearTimeout(w.t); send(w.res, 410, { error: 'debate_deleted', state: 'closed', next: 'stop' }); } };
const activate = d => { save(); S = d; APP.activeId = S.id; debates.set(S.id, S); save(); };
const withDebate = (d, fn) => { const prev = S; S = d; try { return fn(); } finally { S = prev; } };
const publicStateOf = d => withDebate(d, publicState);
const summaryOf = d => withDebate(d, () => ({ id: d.id, title: d.title, topic: d.topic, state: d.state, phase: d.phase, phaseStartId: d.phaseStartId, reviewCycle: d.reviewCycle, createdAt: d.createdAt, updatedAt: d.updatedAt,
  language: d.language, presence: presence(), waitingFor: waitingFor(), turn: turn(), turnStartedAt: turn() ? d.turnStartedAt : null, lastMessageId: d.messages.at(-1)?.id || 0, lastAgentMessageId: agentMsgs().at(-1)?.id || 0, maxRounds: d.maxRounds, count: count(), totalCount: agentMsgs().length, agents: d.agents.map(a => ({ id: a.id, name: a.name, kind: a.kind, color: a.color, confirmedAt: a.confirmedAt, activity: activityOf(a.id) })),
  final: d.final ? { writer: d.final.writer, proposal: d.final.proposal, forced: d.final.forced } : null, implementation: { ...d.implementation }, active: d.id === APP.activeId }));
const allDebates = () => { for (const id of debateIds()) getDebate(id); return [...debates.values()]; };
const listDebates = () => allDebates().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(b.id).localeCompare(String(a.id))).map(summaryOf);
const debateForToken = tok => typeof tok === 'string' ? allDebates().find(d => d.agents.some(a => a.token === tok)) || null : null;

const decide = reason => {
  const pos = positions(), ps = proposals(); if (!ps.length) return false;
  const score = id => Object.values(pos).filter(v => v === id).length;
  const best = ps.reduce((b, p) => score(p.id) >= score(b.id) ? p : b, ps[0]);
  const backers = S.agents.filter(a => pos[a.id] === best.id).map(a => a.id);
  const writer = backers.includes(best.from) ? best.from : backers.includes(best.writer) ? best.writer : backers.at(-1) || best.from;
  S.state = 'agreed'; S.writer = writer; S.forced = true; S.agreedOn = best.id; S.turn = writer;
  push('system', 'system', localized(`Sem acordo unânime (${reason}). Proposta #${best.id} de ${nameOf(best.from)} adotada; ${nameOf(writer)} escreve a solução final.`, `No unanimous agreement (${reason}). Proposal #${best.id} by ${nameOf(best.from)} adopted; ${nameOf(writer)} writes the final solution.`));
  return true;
};
const hasFinalSolution = () => S.state === 'closed' && S.agreedOn != null && S.final?.writer !== 'human' && !S.final?.reviewCompletion && Boolean(S.final?.text?.trim());
const resolveImplementation = () => {
  const configuration = S.implementation;
  if (S.phase === 'review' && S.state !== 'closed') { configuration.status = 'reviewing'; configuration.reason = null; return; }
  configuration.status = 'waiting'; configuration.reason = null; configuration.assignedAt = null; configuration.assignmentId = null; configuration.report = null; configuration.completedAt = null;
  if (S.state !== 'closed') return;
  S.phase = 'implementation';
  if (configuration.mode === 'none' || !hasFinalSolution() || (configuration.unanimousOnly && S.forced)) {
    configuration.status = 'disabled';
    configuration.reason = configuration.mode === 'none' ? 'disabled_by_moderator' : !hasFinalSolution() ? 'no_final_solution' : 'unanimity_required';
    S.phase = 'finished';
    return;
  }
  if (configuration.mode === 'choose') { configuration.agentId = null; configuration.status = 'pending'; return; }
  const selected = configuration.mode === 'proposal' ? adopted()?.writer : configuration.agentId;
  if (!agent(selected)) { configuration.status = 'pending'; configuration.reason = 'agent_unavailable'; configuration.agentId = null; return; }
  configuration.agentId = selected; configuration.status = 'ready'; configuration.assignedAt = iso(); configuration.assignmentId = rnd(12);
};
const close = (writerId, text, ts) => {
  const reviewCompletion = writerId !== 'human' && S.phase === 'review' && adopted()?.reviewCompletion === true;
  S.state = 'closed'; S.turn = null;
  S.final = { text, writer: writerId, proposal: S.agreedOn, forced: S.forced, ts: ts || new Date().toISOString(), reviewCompletion };
  if (reviewCompletion) {
    S.phase = 'finished'; S.implementation.status = 'completed'; S.implementation.reason = null; S.implementation.completedAt = S.final.ts;
  } else resolveImplementation();
  const head = S.agreedOn == null ? localized('- proposta: nenhuma\n- acordo: encerrado pelo moderador', '- proposal: none\n- agreement: closed by moderator') : localized(`- proposta: #${S.agreedOn}\n- sem unanimidade: ${S.forced}`, `- proposal: #${S.agreedOn}\n- without unanimity: ${S.forced}`);
  const document = `# ${localized('Solução final', 'Final solution')}\n${head}\n- ${localized('autor', 'writer')}: ${nameOf(writerId)} (${writerId})\n- ${localized('encerrado em', 'closed at')}: ${S.final.ts}\n\n${text}\n`;
  fs.writeFileSync(path.join(DEBS, `${S.id}.md`), document);
};

function promptFor(a) {
  const k = KINDS[a.kind] || KINDS.other, u = URL_, token = a.token, file = `.ai-debate/${a.id}.md`;
  const others = S.agents.filter(x => x.id !== a.id).map(x => `${x.name} (${x.id}): ${x.role}`).join('; ');
  const wait = `curl.exe -sS --max-time ${k.maxTime} --retry 5 --retry-delay 3 --retry-connrefused --retry-all-errors "${u}/wait?timeout=${k.wait}" -H "X-Token: ${token}"`;
  const ready = `curl.exe -sS -X POST "${u}/ready" -H "X-Token: ${token}"`;
  const say = `curl.exe -sS "${u}/say?FLAG" -H "X-Token: ${token}" --data-binary "@${file}"`;
  const report = `curl.exe -sS "${u}/implementation/report" -H "X-Token: ${token}" -H "Content-Type: application/json" --data-binary "@.ai-debate/${a.id}-implementation.json"`;
  return (S.language === 'en' ? [
    `You are ${a.name} (${a.id}) in technical debate ${S.id}. Respond in English. Role: ${a.role}`,
    `Peers: ${others || 'none yet'}. Goal: agree on one evidence-based solution.`,
    `Work from the project directory. Use only your own token; do not inspect server files. Use curl.exe in the foreground, one command at a time.`,
    `Read the topic once: curl.exe -sS "${u}/topic" -H "X-Token: ${token}"`,
    `Then send the release command to unlock the chat using your own token: ${ready}. This command is mandatory for every AI: AI messages stay locked until everyone sends it, with at least two participants. Copying the prompt or opening the panel does not unlock the chat. If next says "POST /ready", send the command; follow GET /wait while other releases are missing.`,
    `Wait: ${wait}${a.kind === 'claude' ? ' (Bash timeout: 120000)' : ''}`,
    `Send: ${say}`,
    `Write UTF-8 without BOM to ${file} using your file-writing tool, overwriting each time. Never put message text inline in shell commands or use echo/Set-Content/Out-File.`,
    `Replace FLAG with one option: propose=ID (implementer: ${ids().join(', ')}), agree=N (latest proposal message ID), to=ID (direct question), pass=1, final=1; remove ?FLAG for an ordinary reply.`,
    `Loop by next: call /wait until next:"stop" or next:"implement", including while state:"closed" and implementation is pending. Send only when yourTurn:true. Inspect code and run tests as needed; your turn does not expire. After each POST follow next. If timeout:true or the shell times out, repeat /wait.`,
    `The first message must propose. No agreement in round 1: challenge with evidence first. Every substantive message cites file:line or a test command and result. Proposals state root cause, exact change, and verification.`,
    `Agreement requires ?agree=N, never your own proposal; writing "I agree" alone does not count. In the last round, argue, agree, or pass. After a directed question, reply without ?to.`,
    `Handle error as instructions: not_your_turn -> /wait; bad_agree -> latestProposal; too_early_to_agree or last_round_no_propose -> argue; need_final -> final=1. duplicate:true means the previous message was already accepted.`,
    `In state:"agreed", proposal is the adopted proposal. Only writer sends ?final=1 immediately with the agreed solution and no new changes. Writing the final does not authorize implementation. All agents continue /wait while next says so, even after closed.`,
    `Never edit project code before next:"implement". Only that designated agent implements implementation.text and verifies the result. The AIs nominate this agent in the adopted proposal unless the moderator overrides. With next:"stop", end without further edits.`,
    `If implementation.reviewAfter:true, the implementer MUST return after editing: write a UTF-8 JSON report with {"assignmentId":"<implementation.assignmentId>","summary":"what changed","files":["changed file paths"],"verification":"commands and results","reviewRequest":"ask peers to review"}. All fields are required. Submit: ${report}. Then follow next and keep /wait; do not stop after implementation. With reviewAfter:false, reporting is optional and you may finish.`,
    `Reports start phase:"review" with fresh rounds and votes while preserving history. Inspect the changed files and tests. A proposal marked reviewCompletion:true approves the implementation; agree with it to finish after the final text. To request more changes, send ?propose=ID with the concrete new plan. Only an adopted change plan starts another implementation and report cycle. maxRounds bounds each debate/review phase.`,
    `Respect moderator messages (from:"human") and response language. The moderator may send messages in any phase; they do not change next or authorize skipping gates. Leaving the browser never ends the debate or implementation selection. Do not ask the human to continue while next says /wait. If the very first connection fails, report the unavailable server in one line; otherwise retry /wait.`
  ] : [
    `Você é ${a.name} (${a.id}) no debate técnico ${S.id}. Responda em português. Papel: ${a.role}`,
    `Participantes: ${others || 'nenhum ainda'}. Objetivo: acordar uma solução com evidências.`,
    `Trabalhe na pasta do projeto. Use somente seu token; não procure arquivos do servidor. Use curl.exe em foreground, um comando por vez.`,
    `Leia o assunto uma vez: curl.exe -sS "${u}/topic" -H "X-Token: ${token}"`,
    `Depois envie o comando para liberar o chat com seu próprio token: ${ready}. Esse comando é obrigatório para cada IA: as mensagens das IAs ficam bloqueadas até todas enviarem, com pelo menos dois participantes. Copiar o prompt ou abrir o painel não libera o chat. Se next indicar "POST /ready", envie o comando; siga GET /wait enquanto faltarem liberações.`,
    `Espere: ${wait}${a.kind === 'claude' ? ' (timeout da ferramenta Bash: 120000)' : ''}`,
    `Envie: ${say}`,
    `Escreva UTF-8 sem BOM em ${file} com sua ferramenta de escrita de arquivos, sobrescrevendo a cada mensagem. Nunca use texto inline no shell ou echo/Set-Content/Out-File.`,
    `Troque FLAG por uma opção: propose=ID (implementador: ${ids().join(', ')}), agree=N (ID da proposta mais recente), to=ID (pergunta dirigida), pass=1, final=1; remova ?FLAG para uma resposta comum.`,
    `Siga next: chame /wait até next:"stop" ou next:"implement", inclusive em state:"closed" se a escolha do implementador estiver pendente. Envie somente com yourTurn:true. Leia código e rode testes; a vez não expira. Após cada POST, siga next. Com timeout:true ou comando interrompido por timeout, repita /wait.`,
    `A primeira mensagem deve propor. Na rodada 1, refute com evidências antes de concordar. Toda mensagem relevante cita arquivo:linha ou comando de teste e resultado. Propostas trazem causa raiz, mudança exata e verificação.`,
    `Concordância exige ?agree=N, nunca na sua proposta; escrever "concordo" não basta. Na última rodada, argumente, concorde ou passe. Após pergunta dirigida, responda sem ?to.`,
    `Trate error como instrução: not_your_turn -> /wait; bad_agree -> latestProposal; too_early_to_agree ou last_round_no_propose -> argumente; need_final -> final=1. duplicate:true indica que a mensagem já foi aceita.`,
    `Em state:"agreed", proposal é a proposta adotada. Só o writer envia ?final=1 imediatamente com a solução acordada, sem novidades. Escrever o texto final não autoriza implementar. Todos seguem /wait enquanto next indicar, mesmo após closed.`,
    `Nunca edite o projeto antes de next:"implement". Só o agente designado implementa implementation.text e verifica o resultado. As IAs indicam esse agente na proposta adotada, salvo escolha do moderador. Com next:"stop", encerre sem novas edições.`,
    `Com implementation.reviewAfter:true, o implementador DEVE voltar após editar: escreva um relatório JSON UTF-8 com {"assignmentId":"<implementation.assignmentId>","summary":"o que mudou","files":["caminhos alterados"],"verification":"comandos e resultados","reviewRequest":"peça opiniões aos demais"}. Todos os campos são obrigatórios. Envie: ${report}. Depois siga next e continue /wait; não pare após implementar. Com reviewAfter:false, o relatório é opcional e você pode concluir.`,
    `O relatório inicia phase:"review" com novas rodadas e votos, preservando o histórico. Inspecione os arquivos e testes alterados. Uma proposta reviewCompletion:true aprova a implementação; concorde com ela para encerrar após o texto final. Para pedir ajustes, envie ?propose=ID com um plano concreto. Só um novo plano adotado inicia outro ciclo de implementação e relatório. maxRounds limita cada fase de debate/revisão.`,
    `Considere o moderador (from:"human") e o idioma da resposta. O moderador pode enviar mensagens em qualquer fase; elas não alteram next nem autorizam pular bloqueios. Sair do navegador não encerra o debate nem a escolha do implementador. Não peça ao humano para continuar enquanto next indicar /wait. Se a primeira conexão falhar, avise em uma linha; nas demais falhas repita /wait.`
  ]).join('\n\n');
}

function handleWait(req, res, me, q) {
  if (next(me) !== 'GET /wait') return send(res, 200, view(me));
  const secs = Math.max(1, Math.min(+q.get('timeout') || APP.waitSeconds, APP.waitSeconds));
  const d = S;
  const w = { me, debateId: d.id, res, t: setTimeout(() => withDebate(d, () => { waiters = waiters.filter(x => x !== w); send(res, 200, { ...view(me), timeout: true }); }), secs * 1000) };
  res.on('close', () => { waiters = waiters.filter(x => x !== w); clearTimeout(w.t); });
  waiters.push(w);
}

function handleReady(req, res, me) {
  body(req, b => { try {
    if (!debates.has(S.id)) return send(res, 410, { error: 'debate_deleted', state: 'closed', next: 'stop' });
    const participant = agent(me);
    if (participant?.token !== req.headers['x-token']) return send(res, 401, { error: 'bad_token' });
    if (b.length > LIMIT) return fail(res, 413, me, { error: 'too_large', max: LIMIT });
    if (S.state === 'closed') return fail(res, 410, me, { error: 'closed' });
    if (participant.confirmedAt) return send(res, 200, { ...view(me), confirmedAt: participant.confirmedAt });
    const previousTurn = turn();
    participant.confirmedAt = iso();
    syncTurnStartedAt(previousTurn);
    save(); wake();
    return send(res, 200, { ...view(me), confirmedAt: participant.confirmedAt });
  } catch (e) { send(res, 500, { error: 'server_error', detail: String(e) }); } });
}

function handleImplementationReport(req, res, me) {
  body(req, b => { try {
    if (!debates.has(S.id)) return send(res, 410, { error: 'debate_deleted', state: 'closed', next: 'stop' });
    if (agent(me)?.token !== req.headers['x-token']) return send(res, 401, { error: 'bad_token' });
    if (b.length > LIMIT) return fail(res, 413, me, { error: 'too_large', max: LIMIT });
    if (presence().waiting) return rejectWaiting(res, me);
    let input; try { input = JSON.parse(b.toString('utf8')); } catch { return fail(res, 400, me, { error: 'bad_json' }); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(res, 400, me, { error: 'invalid_implementation_report' });
    const current = S.implementation, responsible = current.report?.agentId || current.agentId;
    if (responsible !== me) return fail(res, 403, me, { error: 'not_implementation_agent' });
    if (typeof input.assignmentId !== 'string' || input.assignmentId !== current.assignmentId) return fail(res, 409, me, { error: 'stale_implementation_assignment' });
    if (['summary', 'verification', 'reviewRequest'].some(field => typeof input[field] !== 'string' || !input[field].trim()) || !Array.isArray(input.files) || !input.files.length || input.files.some(file => typeof file !== 'string' || !file.trim()))
      return fail(res, 400, me, { error: 'invalid_implementation_report', required: ['assignmentId', 'summary', 'files', 'verification', 'reviewRequest'] });
    const details = { assignmentId: input.assignmentId, summary: input.summary.trim(), files: [...new Set(input.files.map(file => file.trim()))], verification: input.verification.trim(), reviewRequest: input.reviewRequest.trim() };
    if (current.report) {
      const identical = ['assignmentId', 'summary', 'verification', 'reviewRequest'].every(field => current.report[field] === details[field]) && JSON.stringify(current.report.files) === JSON.stringify(details.files);
      return identical ? send(res, 200, { ...view(me), report: current.report, duplicate: true }) : fail(res, 409, me, { error: 'implementation_report_already_submitted' });
    }
    if (S.phase !== 'implementation' || S.state !== 'closed' || current.status !== 'ready' || !hasFinalSolution()) return fail(res, 409, me, { error: 'implementation_not_ready' });
    const since = lastOwn(me);
    const report = { ...details, agentId: me, ts: iso(), cycle: S.reviewCycle + (current.reviewAfter ? 1 : 0), planProposalId: S.agreedOn, messageId: null };
    const text = localized(`Implementação concluída.\n\n${report.summary}\n\nArquivos alterados:\n${report.files.map(file => `- ${file}`).join('\n')}\n\nVerificação: ${report.verification}\n\n${report.reviewRequest}`, `Implementation completed.\n\n${report.summary}\n\nChanged files:\n${report.files.map(file => `- ${file}`).join('\n')}\n\nVerification: ${report.verification}\n\n${report.reviewRequest}`);
    if (current.reviewAfter) {
      S.phase = 'review'; S.state = 'open'; S.phaseStartId = (S.messages.at(-1)?.id || 0) + 1; S.reviewCycle++;
      S.turn = nextAfter(me); S.writer = null; S.agreedOn = null; S.forced = false; S.final = null;
      current.status = 'reviewing'; current.completedAt = null;
    } else { S.phase = 'finished'; current.status = 'completed'; current.completedAt = report.ts; }
    current.report = report; current.reason = null;
    const message = push(me, current.reviewAfter ? 'propose' : 'implementation_report', text, { ...(current.reviewAfter ? { writer: me, reviewCompletion: true } : {}), implementationReport: report });
    report.messageId = message.id;
    save(); wake();
    return send(res, 200, { ...view(me), report, id: message.id, messages: S.messages.filter(m => m.id > since && m.id < message.id).map(pub) });
  } catch (e) { send(res, 500, { error: 'server_error', detail: String(e) }); } });
}

function handleSay(req, res, me, q) {
  body(req, b => { try {
    if (!debates.has(S.id)) return send(res, 410, { error: 'debate_deleted', state: 'closed', next: 'stop' });
    if (agent(me)?.token !== req.headers['x-token']) return send(res, 401, { error: 'bad_token' });
    if (b.length > LIMIT) return fail(res, 413, me, { error: 'too_large', max: LIMIT });
    if (presence().waiting) return rejectWaiting(res, me);
    if (b[0] === 0xFF && b[1] === 0xFE) return fail(res, 400, me, { error: 'bad_encoding', hint: 'arquivo em UTF-16: grave em UTF-8 sem BOM com a ferramenta de arquivos do agente, nao com Out-File/Set-Content/echo' });
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) b = b.subarray(3);
    const text = b.toString('utf8').replace(/\r\n?/g, '\n').trim();
    if (/\u0000|\ufffd/.test(text)) return fail(res, 400, me, { error: 'bad_encoding', hint: 'grave o arquivo em UTF-8 sem BOM com a ferramenta de arquivos do agente' });
    const flags = ['propose', 'agree', 'pass', 'final'].filter(f => q.has(f)), flag = flags[0] || 'msg', to = q.get('to');
    if (flags.length > 1) return fail(res, 400, me, { error: 'one_flag_only', flags });
    if (to && flag !== 'msg') return fail(res, 400, me, { error: 'to_only_with_plain_message', hint: '?to= so em mensagem sem outra flag' });
    if (!text && flag !== 'pass') return fail(res, 400, me, { error: 'empty_text', hint: `o corpo e o texto da mensagem: --data-binary "@.ai-debate/${me}.md"` });
    if (N() < 2) return fail(res, 409, me, { error: 'not_ready', hint: 'o moderador ainda nao criou 2 agentes; aguarde com GET /wait' });
    if (S.state === 'closed') return fail(res, 410, me, { error: 'closed', hint: 'debate encerrado; siga next enquanto a implementação é definida' });
    const lastA = phaseAgentMsgs().at(-1);
    if (turn() !== me) return fail(res, 409, me, { error: 'not_your_turn', turnName: nameOf(turn()), lastFrom: lastA ? lastA.from : null, hint: 'aguarde com GET /wait' + (lastA && lastA.from === me ? ' (lastFrom e voce: sua mensagem anterior ja entrou)' : '') });
    const p = proposal(), mine = phaseMessages().findLast(x => x.from === me), since = lastOwn(me);
    if (S.state === 'agreed') {
      if (flag !== 'final') return fail(res, 409, me, { error: 'need_final', hint: 'em agreed a unica chamada aceita e POST /say?final=1 com o texto final da solucao' });
      const m = push(me, 'final', text); close(me, text, m.ts); save(); wake();
      return send(res, 200, { id: m.id, ...view(me), final: `data/debates/${S.id}.md`, messages: S.messages.filter(message => message.id > since && message.id < m.id).map(pub) });
    }
    if (flag === 'final') return fail(res, 400, me, { error: 'not_agreed', hint: 'final so depois do acordo' });
    if (count() === 0 && flag !== 'propose') return fail(res, 400, me, { error: 'first_message_must_propose', hint: '?propose=<id de quem implementa>', agents: ids() });
    if (mine && flag !== 'pass' && mine.kind === flag && mine.text === text && (mine.writer || null) === (q.get('propose') || null))
      return send(res, 200, { id: mine.id, duplicate: true, hint: 'mensagem identica a sua ultima: nao foi gravada de novo; leia "messages" e responda ao que veio depois', ...view(me) });
    if (to && (!agent(to) || to === me)) return fail(res, 400, me, { error: 'bad_to', agents: ids().filter(i => i !== me) });
    if (to && lastA && lastA.to === me) return fail(res, 400, me, { error: 'no_chained_direct', hint: 'voce acabou de receber uma pergunta dirigida: responda sem ?to para a vez voltar ao rodizio' });
    if (to && count() + 1 >= maxMessages()) return fail(res, 400, me, { error: 'no_direct_on_last_message', hint: 'esta e a ultima mensagem do debate: argumente, ?agree=N ou ?pass=1' });
    const extra = {};
    if (flag === 'propose') {
      const w = q.get('propose');
      if (!agent(w)) return fail(res, 400, me, { error: 'bad_propose', hint: '?propose=<id de quem implementa>', agents: ids() });
      if (round() === S.maxRounds) return fail(res, 400, me, { error: 'last_round_no_propose', hint: 'na ultima rodada so cabe ?agree=N, argumentar ou ?pass=1' });
      extra.writer = w;
    }
    if (flag === 'agree') {
      if (round() === 1) return fail(res, 400, me, { error: 'too_early_to_agree', hint: 'rodada 1: tente refutar com evidencia; ?agree so a partir da rodada 2' });
      const n = q.get('agree');
      if (!/^\d+$/.test(n) || +n !== p.id) return fail(res, 400, me, { error: 'bad_agree', latestProposal: p.id, hint: 'so a proposta mais recente e concordavel; para voltar a uma antiga, reproponha' });
      if (p.from === me) return fail(res, 400, me, { error: 'own_proposal', hint: 'nao se concorda com a propria proposta: argumente ou espere os outros' });
      extra.agree = p.id;
    }
    if (flag === 'pass') {
      const tail = phaseAgentMsgs().slice(-(N() - 1));
      if (tail.length === N() - 1 && tail.every(x => x.kind === 'pass')) return fail(res, 400, me, { error: 'all_passed', hint: 'todos os outros passaram: de ?agree na proposta vigente ou reproponha' });
    }
    if (to) extra.to = to;
    const m = push(me, flag, text || localized('(passou a vez)', '(passed the turn)'), extra);
    const pos = positions(), cur = proposal();
    if (S.agents.every(a => pos[a.id] === cur.id)) {
      S.state = 'agreed'; S.writer = cur.writer; S.agreedOn = cur.id; S.forced = false; S.turn = cur.writer;
      push('system', 'system', localized(`Acordo unânime na proposta #${cur.id}. ${nameOf(cur.writer)} escreve a solução final.`, `Unanimous agreement on proposal #${cur.id}. ${nameOf(cur.writer)} writes the final solution.`));
    } else if (count() >= maxMessages()) decide(localized(`limite de ${S.maxRounds} rodadas`, `${S.maxRounds}-round limit`));
    else S.turn = to || (lastA && lastA.to === me ? resumeAfter(lastA.from, me) : nextAfter(me));
    save(); wake();
    send(res, 200, { id: m.id, ...view(me), messages: S.messages.filter(x => x.id > since && x.id < m.id).map(pub) });
  } catch (e) { send(res, 500, { error: 'server_error', detail: String(e) }); } });
}

const slug = s => (s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agente').slice(0, 24);
function admin(req, res, u) {
  if (req.headers['x-admin'] !== APP.admin) return send(res, 401, { error: 'bad_admin', hint: `recarregue o painel em ${URL_} (a chave vai injetada na pagina)` });
  const parts = u.pathname.split('/').filter(Boolean);
  let previousTurn = turn(), previousDebateId = S.id;
  const done = () => { syncTurnStartedAt(previousTurn, previousDebateId); save(); wake(); send(res, 200, publicState()); };
  if (req.method === 'GET' && parts[1] === 'settings') return send(res, 200, { languagePreference: APP.languagePreference, language: APP.language, waitSeconds: APP.waitSeconds, maxRounds: S.maxRounds, debateLanguage: S.language });
  if (req.method === 'GET' && parts[1] === 'implementation') return send(res, 200, { ...S.implementation });
  if (req.method === 'GET' && parts[1] === 'agents') return send(res, 200, S.agents.map(a => ({ ...a, prompt: promptFor(a) })));
  if (req.method === 'GET' && parts[1] === 'debates') {
    if (!parts[2]) return send(res, 200, listDebates());
    const d = getDebate(parts[2]);
    return d ? send(res, 200, publicStateOf(d)) : send(res, 404, { error: 'no_such_debate' });
  }
  body(req, b => { try {
    if (b.length > LIMIT) return send(res, 413, { error: 'too_large', max: LIMIT });
    if (!debates.has(S.id)) return send(res, 410, { error: 'debate_deleted' });
    previousTurn = turn(); previousDebateId = S.id;
    let j = {}; try { j = b.length ? JSON.parse(b.toString('utf8')) : {}; } catch { return send(res, 400, { error: 'bad_json' }); }
    const started = agentMsgs().length > 0;
    if (parts[1] === 'debates') {
      const id = parts[2];
      if (req.method === 'POST' && !id) {
        activate(freshDebate({ title: j.title, topic: j.topic, language: j.language })); return done();
      }
      const d = getDebate(id); if (!d) return send(res, 404, { error: 'no_such_debate' });
      if (req.method === 'POST' && parts[3] === 'open') { if (d !== S || d.id !== APP.activeId) activate(d); return done(); }
      if (req.method === 'PUT') {
        const t = String(j.title || '').trim(); if (!t) return send(res, 400, { error: 'title_required', hint: 'o titulo nao pode ser vazio' });
        d.title = t; return withDebate(d, done);
      }
      if (req.method === 'DELETE') {
        allDebates();
        evict(d.id); debates.delete(d.id); pendingWrites.delete(d.id);
        if (d.id === APP.activeId) {
          const others = [...debates.values()]
            .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(b.id).localeCompare(String(a.id)));
          S = others[0] || freshDebate(); APP.activeId = S.id;
        }
        else if (d === S) S = getDebate(APP.activeId);
        try { fs.unlinkSync(debFile(id)); } catch (e) { if (e.code !== 'ENOENT') return send(res, 500, { error: 'delete_failed' }); }
        try { fs.unlinkSync(path.join(DEBS, `${id}.md`)); } catch {}
        return done();
      }
    }
    if (parts[1] === 'agents') {
      const id = parts[2];
      if (req.method === 'POST' && !id) {
        if (started) return send(res, 409, { error: 'debate_started', hint: 'use Novo debate antes de mexer nos agentes' });
        const name = String(j.name || '').trim(); if (!name) return send(res, 400, { error: 'name_required' });
        const base = slug(name); let sid = base, k = 2; while (agent(sid) || sid === 'human' || sid === 'system') sid = `${base}-${k++}`;
        const kind = Object.hasOwn(KINDS, j.kind) ? j.kind : 'other';
        const roleDefault = !String(j.role || '').trim(), role = String(j.role || '').trim() || defaultRole(N());
        S.agents.push({ id: sid, name, kind, role, roleDefault, color: KINDS[kind].color, token: `${sid}-${rnd(4)}`, confirmedAt: null });
        return done();
      }
      const a = agent(id); if (!a) return send(res, 404, { error: 'no_such_agent' });
      if (req.method === 'DELETE') { if (started) return send(res, 409, { error: 'debate_started' }); S.agents = S.agents.filter(x => x !== a); if (S.turn === a.id) S.turn = null; if (S.implementation.agentId === a.id) { S.implementation.mode = 'choose'; S.implementation.agentId = null; resolveImplementation(); } return done(); }
      if (req.method === 'POST' && parts[3] === 'token') { a.token = `${a.id}-${rnd(4)}`; if (!started) a.confirmedAt = null; return done(); }
      if (req.method === 'PUT') {
        if (typeof j.name === 'string' && j.name.trim()) a.name = j.name.trim();
        if (typeof j.role === 'string' && j.role.trim()) { a.role = j.role.trim(); a.roleDefault = false; }
        if (Object.hasOwn(KINDS, j.kind)) { a.kind = j.kind; a.color = KINDS[j.kind].color; }
        return done();
      }
    }
    if (req.method === 'PUT' && parts[1] === 'topic') { S.topic = String(j.text || ''); return done(); }
    if (req.method === 'PUT' && parts[1] === 'implementation') {
      const current = S.implementation, mode = j.mode === undefined ? current.mode : j.mode;
      if (!implementationModes.includes(mode)) return send(res, 400, { error: 'invalid_implementation_mode' });
      if (j.unanimousOnly !== undefined && typeof j.unanimousOnly !== 'boolean') return send(res, 400, { error: 'invalid_unanimous_only' });
      if (j.reviewAfter !== undefined && typeof j.reviewAfter !== 'boolean') return send(res, 400, { error: 'invalid_review_after' });
      const agentId = mode === 'agent' ? j.agentId === undefined ? current.agentId : j.agentId : null;
      if (mode === 'agent' && !agent(agentId)) return send(res, 400, { error: 'invalid_implementation_agent' });
      const unanimousOnly = j.unanimousOnly === undefined ? current.unanimousOnly : j.unanimousOnly;
      const reviewAfter = j.reviewAfter === undefined ? current.reviewAfter : j.reviewAfter;
      if (current.status === 'ready') return send(res, 409, { error: 'implementation_already_assigned' });
      if (current.status === 'completed') return send(res, 409, { error: 'implementation_completed' });
      S.implementation = { ...current, mode, agentId, unanimousOnly, reviewAfter };
      resolveImplementation();
      return done();
    }
    if (req.method === 'POST' && parts[1] === 'implement') {
      if (presence().waiting) return rejectWaiting(res);
      if (S.implementation.status === 'completed') return send(res, 409, { error: 'implementation_completed' });
      if (!hasFinalSolution()) return send(res, 409, { error: 'no_final_solution' });
      if (!agent(j.agentId)) return send(res, 400, { error: 'invalid_implementation_agent' });
      if (S.implementation.unanimousOnly && S.forced) return send(res, 409, { error: 'implementation_requires_unanimity' });
      if (S.implementation.status === 'ready') return S.implementation.agentId === j.agentId ? done() : send(res, 409, { error: 'implementation_already_assigned' });
      S.phase = 'implementation';
      S.implementation = { ...S.implementation, mode: 'choose', agentId: j.agentId, status: 'ready', reason: null, assignedAt: iso(), assignmentId: rnd(12), report: null, completedAt: null };
      push('system', 'system', localized(`${nameOf(j.agentId)} foi escolhido para implementar a solução final.`, `${nameOf(j.agentId)} was selected to implement the final solution.`));
      return done();
    }
    if (req.method === 'PUT' && parts[1] === 'settings') {
      if (j.languagePreference !== undefined && !['system', 'pt', 'en'].includes(j.languagePreference)) return send(res, 400, { error: 'invalid_language_preference' });
      if (j.language !== undefined && !['pt', 'en'].includes(j.language)) return send(res, 400, { error: 'invalid_language' });
      if (j.waitSeconds !== undefined && (!Number.isInteger(+j.waitSeconds) || +j.waitSeconds < 5 || +j.waitSeconds > 300)) return send(res, 400, { error: 'waitSeconds_5_300' });
      if (j.maxRounds !== undefined) {
        const r = +j.maxRounds; if (!Number.isInteger(r) || !(r >= 2 && r <= 50)) return send(res, 400, { error: 'maxRounds_2_50', hint: 'rodadas: use um valor entre 2 e 50' });
        const cur = N() ? Math.floor(count() / N()) + 1 : 1;
        if (S.state === 'open' && count() > 0 && r < cur) return send(res, 400, { error: 'maxRounds_below_current_round', hint: `ja estamos na rodada ${cur}; para encerrar use Forcar decisao` });
        S.maxRounds = r;
      }
      if (j.waitSeconds !== undefined) APP.waitSeconds = +j.waitSeconds;
      if (j.languagePreference !== undefined) APP.languagePreference = j.languagePreference;
      if (j.language !== undefined || (j.languagePreference !== undefined && j.languagePreference !== 'system')) {
        APP.language = languageOf(j.language || j.languagePreference);
        S.language = APP.language;
        S.agents.forEach((a, index) => { if (a.roleDefault) a.role = defaultRole(index); });
      }
      return done();
    }
    if (req.method === 'POST' && parts[1] === 'hint') {
      const text = String(j.text || '').trim(); if (!text) return send(res, 400, { error: 'empty_text' });
      const resolved = referencesFor(j.references, text); if (resolved.error) return send(res, 400, resolved);
      push('human', 'hint', text, { ...(j.to && agent(j.to) ? { to: j.to } : {}), references: resolved.references }); save(); wake(); return send(res, 200, publicState());
    }
    if (req.method === 'POST' && parts[1] === 'skip') {
      if (presence().waiting) return rejectWaiting(res);
      if (S.state === 'closed' || N() < 2) return send(res, 409, { error: 'not_open' });
      if (S.state === 'agreed') {
        const from = S.writer; S.writer = S.turn = nextAfter(from);
        push('system', 'system', localized(`Moderador passou a escrita do texto final de ${nameOf(from)} para ${nameOf(S.writer)}.`, `Moderator reassigned the final solution from ${nameOf(from)} to ${nameOf(S.writer)}.`)); return done();
      }
      const from = turn(), last = phaseAgentMsgs().at(-1);
      S.turn = last && last.to === from ? resumeAfter(last.from, from) : nextAfter(from);
      push('system', 'system', localized(`Moderador passou a vez de ${nameOf(from)} para ${nameOf(S.turn)}.`, `Moderator passed the turn from ${nameOf(from)} to ${nameOf(S.turn)}.`)); return done();
    }
    if (req.method === 'POST' && parts[1] === 'decide') {
      if (presence().waiting) return rejectWaiting(res);
      if (S.state !== 'open') return send(res, 409, { error: 'not_open' });
      if (!decide(localized('moderador encerrou o debate', 'moderator ended the debate'))) return send(res, 409, { error: 'no_proposal', hint: 'ainda nao ha proposta para adotar' });
      return done();
    }
    if (req.method === 'POST' && parts[1] === 'close') {
      if (S.state === 'closed') {
        if (!['pending', 'ready'].includes(S.implementation.status)) return send(res, 409, { error: 'already_closed' });
        S.phase = 'finished'; S.implementation.status = 'disabled'; S.implementation.reason = 'moderator_stop'; S.implementation.assignmentId = null;
        push('system', 'system', localized('Moderador encerrou a implementação e a revisão.', 'Moderator stopped the implementation and review.'));
        return done();
      }
      close('human', String(j.text || '').trim() || localized('Encerrado pelo moderador sem texto final.', 'Closed by the moderator without a final solution.')); push('system', 'system', localized('Moderador encerrou o debate.', 'Moderator ended the debate.')); return done();
    }
    if (req.method === 'POST' && parts[1] === 'reset') {
      Object.assign(S, fresh()); S.agents.forEach(a => { a.confirmedAt = null; }); if (S.implementation.mode === 'choose') S.implementation.agentId = null; resolveImplementation(); try { fs.unlinkSync(path.join(DEBS, `${S.id}.md`)); } catch {} return done();
    }
    send(res, 404, { error: 'not_found' });
  } catch (e) { send(res, 500, { error: 'server_error', detail: String(e) }); } });
}

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), q = u.searchParams;
  if (req.method === 'GET' && u.pathname === '/') {
    try {
      let html = fs.readFileSync(P('panel.html'), 'utf8');
      const tag = `<script>window.__ADMIN_KEY__=${JSON.stringify(APP.admin)}</script>`;
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + tag) : tag + html;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
    } catch { return send(res, 500, { error: 'panel_missing', hint: 'panel.html precisa estar ao lado do server.js' }); }
  }
  if (req.method === 'GET' && u.pathname === '/events') {
    if (q.get('key') !== APP.admin && req.headers['x-admin'] !== APP.admin) return send(res, 401, { error: 'bad_admin' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: ready\ndata: ${JSON.stringify({ activeId: APP.activeId })}\n\n`);
    subscribers.add(res);
    const timer = setInterval(() => { if (!res.writableEnded) res.write(': heartbeat\n\n'); }, 15000);
    timer.unref();
    res.on('close', () => { clearInterval(timer); subscribers.delete(res); });
    return;
  }
  const staticTypes = { '/app.js': 'text/javascript; charset=utf-8', '/app.css': 'text/css; charset=utf-8', '/ui-visuals.css': 'text/css; charset=utf-8' };
  if (req.method === 'GET' && Object.hasOwn(staticTypes, u.pathname)) {
    try { const f = fs.readFileSync(P(u.pathname.slice(1))); res.writeHead(200, { 'Content-Type': staticTypes[u.pathname], 'Cache-Control': 'no-cache' }); return res.end(f); }
    catch { return send(res, 404, { error: 'asset_missing' }); }
  }
  if (req.method === 'GET' && /^\/logos\/[a-z0-9-]+\.(png|svg)$/.test(u.pathname)) {
    try { const f = fs.readFileSync(P(u.pathname.slice(1))); res.writeHead(200, { 'Content-Type': u.pathname.endsWith('.svg') ? 'image/svg+xml' : 'image/png', 'Cache-Control': 'max-age=60' }); return res.end(f); }
    catch { return send(res, 404, { error: 'no_logo' }); }
  }
  if (u.pathname.startsWith('/admin/') || (req.method === 'GET' && u.pathname === '/state')) {
    const d = getDebate(q.get('debate') || APP.activeId);
    if (!d) return send(res, 404, { error: 'no_such_debate' });
    return withDebate(d, () => u.pathname === '/state' ? send(res, 200, publicState()) : admin(req, res, u));
  }
  if (u.pathname === '/wait' || u.pathname === '/say' || u.pathname === '/topic' || u.pathname === '/ready' || u.pathname === '/implementation/report') {
    const tok = req.headers['x-token'], d = debateForToken(tok);
    if (!d) return send(res, 401, { error: 'bad_token', hint: 'header X-Token: <agent token>' });
    const me = d.agents.find(a => a.token === tok).id;
    return withDebate(d, () => {
      if (req.method === 'GET' && u.pathname === '/topic') return send(res, 200, { debateId: S.id, language: S.language, phase: S.phase, reviewCycle: S.reviewCycle, presence: presence(), waitingFor: waitingFor(), topic: S.topic, you: me, agents: S.agents.map(a => ({ id: a.id, name: a.name, role: a.role, confirmedAt: a.confirmedAt })), implementation: implementationView(me), next: next(me) });
      if (req.method === 'GET' && u.pathname === '/wait') return handleWait(req, res, me, q);
      if (req.method === 'POST' && u.pathname === '/say') return handleSay(req, res, me, q);
      if (req.method === 'POST' && u.pathname === '/ready') return handleReady(req, res, me);
      if (req.method === 'POST' && u.pathname === '/implementation/report') return handleImplementationReport(req, res, me);
      send(res, 405, { error: 'method_not_allowed' });
    });
  }
  send(res, 404, { error: 'not_found', endpoints: ['GET /topic', 'POST /ready', 'GET /wait[?timeout=S]', 'POST /say[?propose=ID|?agree=N|?to=ID|?pass=1|?final=1]', 'POST /implementation/report'] });
});
srv.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `porta ${PORT} ocupada: netstat -ano | findstr :${PORT}` : e); process.exit(1); });
process.on('uncaughtException', e => console.error('erro nao tratado:', e));
save(); if (dirty) { console.error('nao consegui gravar em data/ nesta pasta; verifique permissoes'); process.exit(1); }
srv.listen(PORT, '127.0.0.1', () => console.log(`ai-debate no ar.\n  Abra o painel:  ${URL_}\n  debate=${S.id} "${S.title}" state=${S.state} agentes=${N()} turno=${turn() || '-'}\n  debates salvos=${debateIds().length}`));
