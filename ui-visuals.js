import React from 'react';

  const h = React.createElement;
  const palettes = {
    claude: { color: '#e58d6e', label: 'Claude' },
    codex: { color: '#39c9a3', label: 'Codex' },
    gemini: { color: '#79a7ff', label: 'Gemini' },
    other: { color: '#a4afc2', label: 'AI' }
  };
  const agentColor = agent => (palettes[agent && agent.kind] || {}).color || (agent && /^#[a-f\d]{3,8}$/i.test(agent.color || '') ? agent.color : palettes.other.color);
  const kindFor = agent => Object.prototype.hasOwnProperty.call(palettes, agent && agent.kind) ? agent.kind : 'other';
  const nameFor = agent => String(agent && (agent.name || agent.id) || 'AI');
  const safeSize = size => Math.max(12, Math.min(96, Number(size) || 20));

  function AgentIdentity({ agent, size = 20, showName = true, className = '', label }) {
    const name = label == null ? nameFor(agent) : String(label);
    const kind = kindFor(agent);
    const dimension = safeSize(size);
    return h('span', {
      className: 'agent-identity ' + className,
      style: { '--agent-color': agentColor(agent), '--agent-icon-size': dimension + 'px' },
      title: nameFor(agent),
      'aria-label': showName ? undefined : nameFor(agent)
    }, h('span', { className: 'agent-identity__icon', 'aria-hidden': true },
      h('span', { className: 'agent-identity__fallback', 'data-initial': Array.from(nameFor(agent))[0].toUpperCase() }),
      h('img', {
        key: kind,
        src: '/logos/' + kind + '.png',
        alt: '',
        draggable: false,
        decoding: 'async',
        onError: event => { event.currentTarget.style.display = 'none'; }
      })
    ), showName ? h('span', { className: 'agent-identity__name' }, name) : null);
  }

  const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordCharacter = value => !!value && /[\p{L}\p{N}_-]/u.test(value);
  const protectedText = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|(?:https?:\/\/|www\.)[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:[A-Za-z]:[\\/]|\.?\.?\/)[^\s<>]+)/g;

  const AgentMentions = React.memo(function AgentMentions({ text = '', agents = [], className = '' }) {
    const source = String(text == null ? '' : text);
    const aliases = new Map();
    agents.forEach(agent => {
      const name = String(agent && agent.name || '').trim();
      const id = String(agent && agent.id || '').trim();
      if (name && !aliases.has(name.toLocaleLowerCase())) aliases.set(name.toLocaleLowerCase(), { alias: name, agent });
      if (name && !aliases.has(('@' + name).toLocaleLowerCase())) aliases.set(('@' + name).toLocaleLowerCase(), { alias: '@' + name, agent });
      if (id && !aliases.has(('@' + id).toLocaleLowerCase())) aliases.set(('@' + id).toLocaleLowerCase(), { alias: '@' + id, agent });
    });
    if (!aliases.size) return h('span', { className: 'agent-mentions ' + className }, source);
    const pattern = new RegExp(Array.from(aliases.values()).sort((a, b) => b.alias.length - a.alias.length).map(item => escapePattern(item.alias)).join('|'), 'giu');
    const content = [];
    let key = 0;
    const appendText = value => {
      let cursor = 0;
      pattern.lastIndex = 0;
      for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
        const start = match.index;
        const end = start + match[0].length;
        if (wordCharacter(value[start - 1]) || value[start - 1] === '@' || wordCharacter(value[end])) continue;
        if (start > cursor) content.push(value.slice(cursor, start));
        const item = aliases.get(match[0].toLocaleLowerCase());
        content.push(h(AgentIdentity, { key: 'mention-' + key++, agent: item.agent, size: 15, label: match[0], className: 'agent-identity--mention' }));
        cursor = end;
      }
      if (cursor < value.length) content.push(value.slice(cursor));
    };
    protectedText.lastIndex = 0;
    let cursor = 0;
    for (let match = protectedText.exec(source); match; match = protectedText.exec(source)) {
      if (match.index > cursor) appendText(source.slice(cursor, match.index));
      content.push(match[0]);
      cursor = match.index + match[0].length;
    }
    if (cursor < source.length) appendText(source.slice(cursor));
    return h('span', { className: 'agent-mentions ' + className }, content);
  });

  function ThinkingOrb({ agent, compact = false, label }) {
    return h('span', {
      className: 'thinking-orb' + (compact ? ' thinking-orb--compact' : ''),
      style: { '--agent-color': agentColor(agent) },
      role: label ? 'img' : undefined,
      'aria-label': label || undefined,
      'aria-hidden': label ? undefined : true
    },
    h('span', { className: 'thinking-orb__halo' }),
    h('span', { className: 'thinking-orb__sphere' },
      h('span', { className: 'thinking-orb__grid' }),
      h('span', { className: 'thinking-orb__scan' }),
      h('span', { className: 'thinking-orb__core' })
    ),
    h('span', { className: 'thinking-orb__orbit thinking-orb__orbit--one' }, h('span', { className: 'thinking-orb__satellite' })),
    h('span', { className: 'thinking-orb__orbit thinking-orb__orbit--two' }, h('span', { className: 'thinking-orb__satellite' })),
    h('span', { className: 'thinking-orb__orbit thinking-orb__orbit--three' }),
    h('span', { className: 'thinking-orb__tick thinking-orb__tick--one' }),
    h('span', { className: 'thinking-orb__tick thinking-orb__tick--two' })
    );
  }

  function AppBrand({ name, compact = false, className = '' }) {
    return h('span', { className: 'app-brand' + (compact ? ' app-brand--compact' : '') + ' ' + className, 'aria-label': compact ? name : undefined },
      h('img', { className: 'app-brand__logo', src: '/logos/app.png', alt: '', draggable: false, width: 44, height: 44 }),
      compact ? null : h('span', { className: 'app-brand__name' }, name)
    );
  }

export { AgentIdentity, AgentMentions, ThinkingOrb, AppBrand, agentColor };
