(function () {
  'use strict';

  const POLL_INTERVAL_MS = 4000;
  const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100];
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    key: '',
    me: null,
    dice: [],
    combat: { phase: 'idle', round: 0, turn: 0, order: [], currentTokenId: '' },
    mode: '',
    panelOpen: false,
    knownRollIds: null,
    signature: '',
    nextFetchAt: 0,
    announcedTurn: ''
  };

  let root = null;
  let rollTimer = null;

  function sessionKey() {
    return sessionStorage.getItem('fk') || '';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char];
    });
  }

  function formatSigned(number) {
    return number > 0 ? '+' + number : String(number);
  }

  function clamp(number, min, max) {
    return Math.max(min, Math.min(max, number));
  }

  function fieldValue(id) {
    const element = document.getElementById(id);
    return element ? element.value : '';
  }

  function isMasterUser() {
    return Boolean(state.me && state.me.role === 'master');
  }

  function showToast(message) {
    const toastElement = document.getElementById('toast');
    if (!toastElement) return;
    toastElement.textContent = message;
    toastElement.classList.add('on');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () {
      toastElement.classList.remove('on');
    }, 3200);
  }

  async function request(path, method, body) {
    const response = await fetch('/api/' + path, {
      method: method || 'GET',
      headers: { 'content-type': 'application/json', 'x-key': sessionKey() },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.error || 'Erro na requisição');
    return payload;
  }

  function describeRolls(entry) {
    const modifierText = entry.modifier ? ' ' + (entry.modifier > 0 ? '+ ' : '− ') + Math.abs(entry.modifier) : '';
    if (entry.mode) {
      return '[' + entry.rolls.join(', ') + '] vale ' + entry.kept[0] + modifierText;
    }
    return '[' + entry.rolls.join(', ') + ']' + modifierText;
  }

  function buildRoot() {
    root = document.createElement('div');
    root.id = 'play-root';
    root.hidden = true;
    root.innerHTML =
      '<button class="bt play-toggle" id="play-toggle" data-play="toggle" aria-label="Dados e iniciativa">🎲</button>' +
      '<section class="pn play-panel" id="play-panel" hidden>' +
      '<div class="play-head"><h2>🎲 Dados</h2><button class="bt x" data-play="close" aria-label="Fechar">×</button></div>' +
      '<div class="play-dice">' +
      DICE_SIDES.map(function (sides) {
        return '<button class="bt" data-play-die="' + sides + '">d' + sides + '</button>';
      }).join('') +
      '</div>' +
      '<div class="play-fields">' +
      '<label>Quantidade<input id="play-count" type="number" min="1" max="20" value="1"></label>' +
      '<label>Modificador<input id="play-mod" type="number" value="0"></label>' +
      '</div>' +
      '<input id="play-label" placeholder="Motivo da rolagem (opcional)" maxlength="60">' +
      '<div class="play-modes">' +
      '<button class="bt" data-play-mode="adv">Vantagem</button>' +
      '<button class="bt" data-play-mode="dis">Desvantagem</button>' +
      '<label class="play-hide" id="play-hide-wrap" hidden><input id="play-hidden" type="checkbox"> Escondido</label>' +
      '</div>' +
      '<div class="play-result" id="play-result"><span class="mu">Escolha um dado para rolar.</span></div>' +
      '<div id="play-combat"></div>' +
      '<div class="play-head"><h2>Histórico</h2></div>' +
      '<ol class="play-log" id="play-log"></ol>' +
      '</section>' +
      '<div class="play-banner" id="play-banner" hidden></div>';
    document.body.appendChild(root);
    root.addEventListener('click', handleClick);
  }

  function setPanelOpen(open) {
    state.panelOpen = open;
    const panel = document.getElementById('play-panel');
    const toggle = document.getElementById('play-toggle');
    if (panel) panel.hidden = !open;
    if (toggle) {
      toggle.classList.toggle('on', open);
      toggle.classList.remove('pulse');
    }
  }

  function toggleMode(mode) {
    state.mode = state.mode === mode ? '' : mode;
    root.querySelectorAll('[data-play-mode]').forEach(function (button) {
      button.classList.toggle('on', button.dataset.playMode === state.mode);
    });
  }

  function handleClick(event) {
    const dieButton = event.target.closest('[data-play-die]');
    if (dieButton) {
      rollFromPanel(Number(dieButton.dataset.playDie));
      return;
    }
    const modeButton = event.target.closest('[data-play-mode]');
    if (modeButton) {
      toggleMode(modeButton.dataset.playMode);
      return;
    }
    const initiativeButton = event.target.closest('[data-play-init]');
    if (initiativeButton) {
      combatAction('roll_initiative', { tokenId: initiativeButton.dataset.playInit });
      return;
    }
    const combatButton = event.target.closest('[data-play-combat]');
    if (combatButton) {
      combatAction(combatButton.dataset.playCombat, {});
      return;
    }
    const control = event.target.closest('[data-play]');
    if (!control) return;
    if (control.dataset.play === 'toggle') setPanelOpen(!state.panelOpen);
    if (control.dataset.play === 'close') setPanelOpen(false);
  }

  function rollFromPanel(sides) {
    const count = clamp(parseInt(fieldValue('play-count'), 10) || 1, 1, 20);
    const modifier = clamp(parseInt(fieldValue('play-mod'), 10) || 0, -99, 99);
    const hiddenBox = document.getElementById('play-hidden');
    return roll({
      expr: count + 'd' + sides + (modifier ? formatSigned(modifier) : ''),
      label: fieldValue('play-label').trim(),
      mode: sides === 20 && count === 1 ? state.mode : '',
      hidden: Boolean(hiddenBox && hiddenBox.checked)
    });
  }

  function rememberRoll(entry) {
    if (state.knownRollIds) state.knownRollIds.add(entry.id);
  }

  async function roll(options) {
    if (!sessionKey()) return null;
    try {
      const result = await request('dice/roll', 'POST', {
        expr: options.expr,
        label: options.label || '',
        mode: options.mode || '',
        hidden: Boolean(options.hidden)
      });
      rememberRoll(result.entry);
      setPanelOpen(true);
      animateResult(result.entry);
      fetchState();
      return result.entry;
    } catch (error) {
      showToast(error.message);
      return null;
    }
  }

  function animateResult(entry) {
    const box = document.getElementById('play-result');
    if (!box) return;
    clearInterval(rollTimer);
    if (REDUCED_MOTION) {
      renderResult(entry);
      return;
    }
    let ticks = 0;
    box.className = 'play-result rolling';
    rollTimer = setInterval(function () {
      ticks += 1;
      box.innerHTML = '<b>' + (1 + Math.floor(Math.random() * entry.sides)) + '</b>';
      if (ticks >= 9) {
        clearInterval(rollTimer);
        renderResult(entry);
      }
    }, 70);
  }

  function renderResult(entry) {
    const box = document.getElementById('play-result');
    const isSingleD20 = entry.sides === 20 && entry.kept.length === 1;
    const critical = isSingleD20 && entry.kept[0] === 20;
    const fumble = isSingleD20 && entry.kept[0] === 1;
    box.className = 'play-result' + (critical ? ' crit' : fumble ? ' fumble' : '');
    box.innerHTML =
      '<b>' + entry.total + '</b>' +
      '<small>' + escapeHtml(entry.expr) + (entry.label ? ' · ' + escapeHtml(entry.label) : '') + '</small>' +
      '<small>' + escapeHtml(describeRolls(entry)) + '</small>' +
      (critical ? '<em>Acerto crítico!</em>' : '') +
      (fumble ? '<em>Falha crítica!</em>' : '');
  }

  function renderLog() {
    const list = document.getElementById('play-log');
    if (!list) return;
    list.innerHTML = state.dice.length
      ? state.dice.slice().reverse().map(function (entry) {
          return '<li class="' + (entry.hidden ? 'secret' : '') + '">' +
            '<strong>' + escapeHtml(entry.who) + '</strong> ' +
            '<span>' + escapeHtml(entry.label || entry.expr) + '</span>' +
            '<b>' + entry.total + '</b>' +
            '<small>' + escapeHtml(entry.expr + ' ' + describeRolls(entry)) + (entry.hidden ? ' · escondido' : '') + '</small>' +
            '</li>';
        }).join('')
      : '<li class="mu">Nenhuma rolagem ainda.</li>';
  }

  function orderRow(entry, index) {
    const combat = state.combat;
    const classes = ['play-row'];
    if (combat.phase === 'running' && index === combat.turn) classes.push('current');
    if (!entry.present || !entry.alive) classes.push('out');
    const canRoll = combat.phase === 'rolling' && entry.init === null && (isMasterUser() || entry.owner === state.me.id);
    return '<li class="' + classes.join(' ') + '">' +
      '<span>' + (entry.kind === 'npc' ? '👹' : '🗡️') + '</span>' +
      '<span class="play-name">' + escapeHtml(entry.name) + '</span>' +
      '<span class="play-init">' + (entry.init === null ? '—' : entry.init) + '</span>' +
      (canRoll ? '<button class="bt" data-play-init="' + escapeHtml(entry.tokenId) + '">d20' + (entry.mod ? formatSigned(entry.mod) : '') + '</button>' : '') +
      '</li>';
  }

  function renderCombat() {
    const box = document.getElementById('play-combat');
    if (!box) return;
    const combat = state.combat;
    const master = isMasterUser();
    const rows = '<ol class="play-order">' + combat.order.map(orderRow).join('') + '</ol>';

    if (combat.phase === 'idle') {
      box.innerHTML = '<div class="play-head"><h2>⚔️ Combate</h2></div>' +
        (master
          ? '<button class="bt" style="width:100%" data-play-combat="start">Iniciar combate com os tokens da mesa</button>'
          : '<p class="mu">Nenhum combate em andamento.</p>');
      return;
    }

    if (combat.phase === 'rolling') {
      box.innerHTML = '<div class="play-head"><h2>⚔️ Iniciativa</h2></div>' +
        '<p class="mu">Cada um rola seu d20. Quando todos rolarem, a ordem dos turnos é montada sozinha.</p>' + rows +
        (master
          ? '<div class="play-actions"><button class="bt" data-play-combat="roll_pending">Rolar pendentes</button><button class="bt" data-play-combat="stop">Cancelar</button></div>'
          : '');
      return;
    }

    const current = combat.order[combat.turn];
    const movement = current && current.limit
      ? '<div class="vtt-move-bar"><i style="width:' + clamp(((current.limit - current.moved) / current.limit) * 100, 0, 100) + '%"></i></div>' +
        '<p class="mu">Movimento de ' + escapeHtml(current.name) + ': ' + Math.max(0, current.limit - current.moved).toFixed(1).replace('.', ',') + 'm / ' + String(current.limit).replace('.', ',') + 'm</p>'
      : '';
    const canEnd = current && (master || current.owner === state.me.id);
    box.innerHTML = '<div class="play-head"><h2>⚔️ Rodada ' + combat.round + '</h2></div>' + rows + movement +
      '<div class="play-actions">' +
      (canEnd ? '<button class="bt" data-play-combat="end_turn">Encerrar turno</button>' : '') +
      (master ? '<button class="bt" data-play-combat="stop">Encerrar combate</button>' : '') +
      '</div>';
  }

  function renderBanner() {
    const banner = document.getElementById('play-banner');
    const combat = state.combat;
    const current = combat.phase === 'running' ? combat.order[combat.turn] : null;
    if (!banner || !current) {
      if (banner) banner.hidden = true;
      return;
    }
    const mine = !isMasterUser() && current.owner === state.me.id;
    const canEnd = isMasterUser() || mine;
    banner.hidden = false;
    banner.classList.toggle('mine', mine);
    banner.innerHTML = '<span>⚔️ Rodada ' + combat.round + ' · ' + (mine ? 'Sua vez, ' : 'Turno de ') + escapeHtml(current.name) + '</span>' +
      (canEnd ? '<button class="bt" data-play-combat="end_turn">Passar turno</button>' : '');
  }

  function announceRoll(entry) {
    showToast(entry.who + ' rolou ' + (entry.label || entry.expr) + ': ' + entry.total);
    const toggle = document.getElementById('play-toggle');
    if (toggle && !state.panelOpen) toggle.classList.add('pulse');
  }

  function announceTurn() {
    const combat = state.combat;
    const current = combat.phase === 'running' ? combat.order[combat.turn] : null;
    const signature = current ? combat.round + ':' + combat.turn + ':' + current.tokenId : '';
    if (signature === state.announcedTurn) return;
    state.announcedTurn = signature;
    if (current && !isMasterUser() && current.owner === state.me.id) {
      showToast('É a sua vez, ' + current.name + '!');
    }
  }

  function applyState(data) {
    state.me = data.me;
    state.dice = data.dice;
    state.combat = data.combat;

    const firstLoad = state.knownRollIds === null;
    if (firstLoad) state.knownRollIds = new Set();
    data.dice.forEach(function (entry) {
      if (state.knownRollIds.has(entry.id)) return;
      state.knownRollIds.add(entry.id);
      if (!firstLoad && entry.whoId !== state.me.id) announceRoll(entry);
    });

    const signature = JSON.stringify([data.dice.map(function (entry) { return entry.id; }), data.combat]);
    if (signature !== state.signature) {
      state.signature = signature;
      root.hidden = false;
      document.getElementById('play-hide-wrap').hidden = !isMasterUser();
      renderLog();
      renderCombat();
      renderBanner();
      document.dispatchEvent(new CustomEvent('play:update'));
    }
    announceTurn();
  }

  async function fetchState() {
    if (!sessionKey()) return;
    try {
      applyState(await request('play/state'));
    } catch (error) {
      return;
    }
  }

  async function combatAction(operation, extra) {
    if (operation === 'stop' && !confirm('Encerrar o combate?')) return;
    try {
      const result = await request('combat', 'POST', Object.assign({ op: operation }, extra));
      if (result.entry) {
        rememberRoll(result.entry);
        setPanelOpen(true);
        animateResult(result.entry);
      }
      await fetchState();
    } catch (error) {
      showToast(error.message);
    }
  }

  function moveRule(tokenId, isMaster) {
    const combat = state.combat;
    if (isMaster || combat.phase !== 'running') return null;
    const entry = combat.order.find(function (item) { return item.tokenId === tokenId; });
    if (!entry) return null;
    const current = combat.order[combat.turn];
    return {
      allowed: Boolean(current && current.tokenId === tokenId),
      remaining: Math.max(0, entry.limit - entry.moved)
    };
  }

  function tick() {
    const key = sessionKey();
    if (!key) {
      root.hidden = true;
      setPanelOpen(false);
      state.key = '';
      state.knownRollIds = null;
      state.signature = '';
      state.announcedTurn = '';
      return;
    }
    if (key !== state.key) {
      state.key = key;
      state.knownRollIds = null;
      state.signature = '';
      state.nextFetchAt = 0;
    }
    if (document.hidden || Date.now() < state.nextFetchAt) return;
    state.nextFetchAt = Date.now() + POLL_INTERVAL_MS;
    fetchState();
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state.panelOpen) setPanelOpen(false);
  });

  window.Play = {
    roll: roll,
    refresh: fetchState,
    moveRule: moveRule,
    currentTokenId: function () { return state.combat.currentTokenId || ''; }
  };

  buildRoot();
  setInterval(tick, 1000);
  tick();
})();
