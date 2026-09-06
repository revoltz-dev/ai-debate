const protectedContent = /(`{3,}[\s\S]*?(?:`{3,}|$)|~{3,}[\s\S]*?(?:~{3,}|$)|(`{1,2})[^\n]*?\2|(?:https?:\/\/|www\.)[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g;
const word = value => Boolean(value && /[\p{L}\p{N}_@#-]/u.test(value));
const fold = value => String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function referenceChoices(debate, language, labels) {
  return [
    ...debate.agents.map(agent => ({ type: 'agent', id: agent.id, token: `@${agent.id}`, label: agent.name, text: agent.role, agent })),
    { type: 'topic', token: language === 'pt' ? '@/assunto' : '@/topic', label: labels.topic, text: debate.topic },
    ...debate.messages.filter(message => message.kind !== 'system').toReversed().map(message => ({ type: 'message', id: message.id, token: `@#${message.id}`, label: `#${message.id} · ${debate.agents.find(agent => agent.id === message.from)?.name || labels.moderator}`, text: message.text, agent: debate.agents.find(agent => agent.id === message.from) }))
  ];
}

export function mentionQuery(text, caret) {
  const preceding = text.slice(0, caret);
  const match = preceding.match(/(?:^|[\s([{"'])@([^\s@]*)$/u);
  if (!match) return null;
  const start = caret - match[1].length - 1;
  protectedContent.lastIndex = 0;
  for (const segment of text.matchAll(protectedContent)) if (start >= segment.index && start < segment.index + segment[0].length) return null;
  return { start, end: caret, query: match[1] };
}

export function matchingReferences(choices, query = '') {
  const search = fold(query);
  return choices.filter(choice => [choice.label, choice.token.slice(1), choice.text].some(value => fold(value || '').includes(search))).slice(0, 9);
}

export function referencesInText(text, choices) {
  const plain = text.replace(protectedContent, match => ' '.repeat(match.length));
  const localized = choices.flatMap(choice => choice.type === 'topic' ? [{ ...choice, token: '@/assunto' }, { ...choice, token: '@/topic' }] : [choice]);
  return localized.filter(choice => {
    for (let start = plain.indexOf(choice.token); start !== -1; start = plain.indexOf(choice.token, start + 1)) {
      if (!word(plain[start - 1]) && !word(plain[start + choice.token.length])) return true;
    }
    return false;
  }).map(({ type, id, token }) => ({ type, ...(id === undefined ? {} : { id }), token }));
}
