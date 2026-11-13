(function () {
  'use strict';

  const POLL_INTERVAL_MS = 4000;
  const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100];
  const MAX_VISIBLE_DICE = 8;
  const FLICKER_STEPS = 9;
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const DIE_SHAPES = {
    4: '<polygon points="50,8 94,86 6,86"/>',
    6: '<rect x="14" y="14" width="72" height="72" rx="12"/>',
    8: '<polygon points="50,4 92,50 50,96 8,50"/>',
    10: '<polygon points="50,4 90,38 50,96 10,38"/>',
    12: '<polygon points="50,5 95,38 78,92 22,92 5,38"/>',
    20: '<polygon points="50,4 91,27 91,73 50,96 9,73 9,27"/><polygon class="facet" points="50,22 76,64 24,64"/>',
    100: '<circle cx="50" cy="50" r="44"/><circle class="facet" cx="50" cy="50" r="30"/>'
  };

  const state = {
    key: '',
    me: null,
    dice: [],
    combat: { phase: 'idle', round: 0, turn: 0, order: [], currentTokenId: '' },
    count: 1,
    modifier: 0,
    mode: '',
    panelOpen: false,
    muted: false,
    knownRollIds: null,
    signature: '',
    nextFetchAt: 0,
    announcedTurn: '',
    lastPhase: 'idle'
  };

  let root = null;
  let runCounter = 0;
  let trayBusy = false;
  let cardBusy = false;
  let cardTimer = null;
  let audioContext = null;
  const cardQueue = [];

  try {
    state.muted = localStorage.getItem('play-muted') === '1';
  } catch (error) {
    state.muted = false;
  }

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

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
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

  function getAudioContext() {
    if (state.muted) return null;
    const AudioConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioConstructor) return null;
    if (!audioContext) audioContext = new AudioConstructor();
    if (audioContext.state === 'suspended') audioContext.resume();
    return audioContext;
  }

  function playTone(frequency, endFrequency, duration, type, volume) {
    const context = getAudioContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  const sounds = {
    clack: function () { playTone(randomBetween(320, 580), 90, 0.07, 'square', 0.05); },
    thud: function () { playTone(140, 50, 0.16, 'triangle', 0.14); },
    critical: function () {
      playTone(660, 990, 0.35, 'sine', 0.1);
      setTimeout(function () { playTone(990, 1320, 0.45, 'sine', 0.08); }, 140);
    },
    fumble: function () { playTone(180, 45, 0.6, 'sawtooth', 0.08); }
  };

  function dieMarkup(sides, text) {
    return '<svg class="die-svg" viewBox="0 0 100 100" aria-hidden="true">' + DIE_SHAPES[sides] +
      '<text x="50" y="61" text-anchor="middle">' + text + '</text></svg>';
  }

  function describeRolls(entry) {
    const modifierText = entry.modifier ? ' ' + (entry.modifier > 0 ? '+ ' : '− ') + Math.abs(entry.modifier) : '';
    if (entry.mode) {
      return '[' + entry.rolls.join(', ') + '] vale ' + entry.kept[0] + modifierText;
    }
    return '[' + entry.rolls.join(', ') + ']' + modifierText;
  }

  function isCritical(entry) {
    return entry.sides === 20 && entry.kept.length === 1 && entry.kept[0] === 20;
  }

  function isFumble(entry) {
    return entry.sides === 20 && entry.kept.length === 1 && entry.kept[0] === 1;
  }

  function whoLabel(entry) {
    return (entry.hidden ? '🔒 ' : '') + escapeHtml(entry.who) + (entry.label ? ' · ' + escapeHtml(entry.label) : '');
  }

  function burst(stage, kind) {
    for (let index = 0; index < 18; index++) {
      const spark = document.createElement('i');
      spark.className = 'spark ' + kind;
      spark.style.setProperty('--dx', randomBetween(-170, 170).toFixed(0) + 'px');
      spark.style.setProperty('--dy', randomBetween(-150, 30).toFixed(0) + 'px');
      stage.appendChild(spark);
      setTimeout(function () { spark.remove(); }, 1300);
    }
  }

  function animateRoll(stage, entry, onDone) {
    runCounter += 1;
    const runId = String(runCounter);
    stage.dataset.run = runId;
    stage.classList.remove('crit', 'fumble');

    const visibleRolls = entry.rolls.slice(0, MAX_VISIBLE_DICE);
    const extraCount = entry.rolls.length - visibleRolls.length;
    const droppedIndex = entry.mode ? (entry.rolls.indexOf(entry.kept[0]) === 0 ? 1 : 0) : -1;

    stage.innerHTML =
      '<div class="roll-who">' + whoLabel(entry) + '</div>' +
      '<div class="roll-dice">' +
      visibleRolls.map(function () {
        return '<div class="roll-die">' + dieMarkup(entry.sides, '?') + '</div>';
      }).join('') +
      (extraCount > 0 ? '<span class="roll-more">+' + extraCount + '</span>' : '') +
      '</div>' +
      '<div class="roll-sum"><span class="roll-total"></span></div>' +
      '<div class="roll-flag"></div>' +
      '<small class="roll-detail"></small>';

    const diceElements = Array.from(stage.querySelectorAll('.roll-die'));
    let landedCount = 0;

    function finish() {
      if (stage.dataset.run !== runId) return;
      const critical = isCritical(entry);
      const fumble = isFumble(entry);
      const totalElement = stage.querySelector('.roll-total');
      totalElement.textContent = entry.total;
      totalElement.classList.add('stamp');
      stage.querySelector('.roll-detail').textContent = entry.expr + ' ' + describeRolls(entry);
      if (droppedIndex >= 0 && diceElements[droppedIndex]) diceElements[droppedIndex].classList.add('dropped');
      if (critical || fumble) {
        stage.classList.add(critical ? 'crit' : 'fumble');
        stage.querySelector('.roll-flag').textContent = critical ? 'ACERTO CRÍTICO!' : 'FALHA CRÍTICA!';
        stage.querySelector('.roll-dice').classList.add('shake');
        burst(stage, critical ? 'ember' : 'blood');
        (critical ? sounds.critical : sounds.fumble)();
      }
      if (onDone) onDone();
    }

    function landed() {
      landedCount += 1;
      if (landedCount === diceElements.length) setTimeout(finish, 180);
    }

    diceElements.forEach(function (dieElement, index) {
      const label = dieElement.querySelector('text');
      const finalValue = visibleRolls[index];
      if (REDUCED_MOTION) {
        label.textContent = finalValue;
        landed();
        return;
      }
      const delay = index * 110;
      const spin = (Math.random() < 0.5 ? -1 : 1) * (720 + 360 * Math.floor(Math.random() * 2));
      dieElement.style.setProperty('--fx', randomBetween(-130, 130).toFixed(0) + 'px');
      dieElement.style.setProperty('--spin', spin + 'deg');
      dieElement.style.setProperty('--delay', delay + 'ms');
      dieElement.classList.add('throw');

      let step = 0;
      function flickerStep() {
        if (stage.dataset.run !== runId) return;
        step += 1;
        if (step > FLICKER_STEPS) {
          label.textContent = finalValue;
          dieElement.classList.add('landed');
          sounds.thud();
          landed();
          return;
        }
        label.textContent = 1 + Math.floor(Math.random() * entry.sides);
        if (step % 3 === 0) sounds.clack();
        setTimeout(flickerStep, 50 + step * 14);
      }
      setTimeout(flickerStep, delay + 80);
    });
  }

  function idleTrayMarkup() {
    return '<div class="tray-idle">' + dieMarkup(20, '20') + '<span>Escolha um dado para lançar</span></div>';
  }

  function animateInTray(entry) {
    const tray = document.getElementById('play-tray');
    if (!tray) return;
    trayBusy = true;
    animateRoll(tray, entry, function () { trayBusy = false; });
  }

  function pumpCard() {
    const card = document.getElementById('play-card');
    const entry = cardQueue.shift();
    clearTimeout(cardTimer);
    if (!entry) {
      cardBusy = false;
      card.hidden = true;
      return;
    }
    cardBusy = true;
    card.hidden = false;
    card.classList.remove('leaving');
    animateRoll(card.querySelector('.roll-stage'), entry, function () {
      cardTimer = setTimeout(function () {
        card.classList.add('leaving');
        cardTimer = setTimeout(pumpCard, 400);
      }, 3200);
    });
  }

  function showCard(entry, immediate) {
    if (immediate) cardQueue.length = 0;
    cardQueue.push(entry);
    if (!cardBusy || immediate) pumpCard();
  }

  function dismissCard() {
    const card = document.getElementById('play-card');
    card.querySelector('.roll-stage').dataset.run = '0';
    pumpCard();
  }

  function showOwnRoll(entry) {
    if (state.knownRollIds) state.knownRollIds.add(entry.id);
    if (state.panelOpen) animateInTray(entry);
    else showCard(entry, true);
  }

  function showRemoteRoll(entry) {
    if (entry.kind === 'initiative') {
      showToast(entry.who + ' rolou iniciativa: ' + entry.total);
      return;
    }
    if (state.panelOpen) {
      if (!trayBusy) animateInTray(entry);
    } else {
      showCard(entry, false);
    }
  }

  async function roll(options) {
    if (!sessionKey()) return null;
    getAudioContext();
    try {
      const result = await request('dice/roll', 'POST', {
        expr: options.expr,
        label: options.label || '',
        mode: options.mode || '',
        hidden: Boolean(options.hidden)
      });
      showOwnRoll(result.entry);
      fetchState();
      return result.entry;
    } catch (error) {
      showToast(error.message);
      return null;
    }
  }

  function rollFromPanel(sides) {
    const label = document.getElementById('play-label').value.trim();
    const hiddenBox = document.getElementById('play-hidden');
    return roll({
      expr: state.count + 'd' + sides + (state.modifier ? formatSigned(state.modifier) : ''),
      label: label,
      mode: sides === 20 && state.count === 1 ? state.mode : '',
      hidden: Boolean(hiddenBox && hiddenBox.checked)
    });
  }

  function buildRoot() {
    root = document.createElement('div');
    root.id = 'play-root';
    root.hidden = true;
    root.innerHTML =
      '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
      '<radialGradient id="play-die-gradient" cx="35%" cy="30%" r="80%">' +
      '<stop offset="0" stop-color="#c4202e"/><stop offset="0.55" stop-color="#6e0d16"/><stop offset="1" stop-color="#25030a"/>' +
      '</radialGradient></defs></svg>' +
      '<button class="bt play-fab" data-play="toggle" aria-label="Abrir mesa de dados">' + dieMarkup(20, '20') + '</button>' +
      '<div class="play-turnbar" id="play-turnbar" hidden></div>' +
      '<section class="pn play-card" id="play-card" hidden><div class="roll-stage"></div><small class="mu">Clique para fechar</small></section>' +
      '<div class="play-modal" id="play-modal">' +
      '<section class="pn play-sheet" role="dialog" aria-label="Mesa de dados">' +
      '<div class="play-top"><h2>🎲 Mesa de Dados</h2>' +
      '<button class="bt x" data-play="mute" id="play-mute" aria-label="Ligar ou desligar o som"></button>' +
      '<button class="bt x" data-play="close" aria-label="Fechar">×</button></div>' +
      '<div class="play-grid">' +
      '<div class="play-left">' +
      '<div class="roll-stage dice-tray" id="play-tray">' + idleTrayMarkup() + '</div>' +
      '<div class="dice-picker">' +
      DICE_SIDES.map(function (sides) {
        return '<button class="bt dice-pick" data-play-die="' + sides + '">' + dieMarkup(sides, sides === 100 ? '%' : sides) + '<span>d' + sides + '</span></button>';
      }).join('') +
      '</div>' +
      '<div class="play-steppers">' +
      '<div class="stepper"><button class="bt x" data-play-step="count:-1" aria-label="Menos dados">−</button><div><small>Quantidade</small><output id="play-count"></output></div><button class="bt x" data-play-step="count:1" aria-label="Mais dados">+</button></div>' +
      '<div class="stepper"><button class="bt x" data-play-step="modifier:-1" aria-label="Menos bônus">−</button><div><small>Bônus</small><output id="play-modifier"></output></div><button class="bt x" data-play-step="modifier:1" aria-label="Mais bônus">+</button></div>' +
      '</div>' +
      '<input id="play-label" placeholder="Motivo da rolagem (opcional)" maxlength="60">' +
      '<div class="play-modes">' +
      '<button class="bt" data-play-mode="adv">Vantagem</button>' +
      '<button class="bt" data-play-mode="dis">Desvantagem</button>' +
      '<label class="play-hide" id="play-hide-wrap" hidden><input id="play-hidden" type="checkbox"> Rolar escondido</label>' +
      '</div>' +
      '</div>' +
      '<div class="play-right">' +
      '<div id="play-combat"></div>' +
      '<div><div class="play-head"><h2>Histórico</h2></div><ol class="play-log" id="play-log"></ol></div>' +
      '</div>' +
      '</div>' +
      '</section></div>';
    document.body.appendChild(root);
    root.addEventListener('click', handleClick);
    document.getElementById('play-card').addEventListener('click', dismissCard);
    renderControls();
  }

  function renderControls() {
    document.getElementById('play-count').textContent = state.count;
    document.getElementById('play-modifier').textContent = formatSigned(state.modifier);
    document.getElementById('play-mute').textContent = state.muted ? '🔇' : '🔊';
    root.querySelectorAll('[data-play-mode]').forEach(function (button) {
      button.classList.toggle('on', button.dataset.playMode === state.mode);
    });
  }

  function setPanelOpen(open) {
    state.panelOpen = open;
    document.getElementById('play-modal').classList.toggle('on', open);
    if (open) getAudioContext();
  }

  function handleClick(event) {
    const target = event.target;
    if (target.id === 'play-modal') {
      setPanelOpen(false);
      return;
    }
    const dieButton = target.closest('[data-play-die]');
    if (dieButton) {
      rollFromPanel(Number(dieButton.dataset.playDie));
      return;
    }
    const stepButton = target.closest('[data-play-step]');
    if (stepButton) {
      const parts = stepButton.dataset.playStep.split(':');
      const delta = Number(parts[1]);
      if (parts[0] === 'count') state.count = clamp(state.count + delta, 1, 20);
      else state.modifier = clamp(state.modifier + delta, -20, 20);
      renderControls();
      return;
    }
    const modeButton = target.closest('[data-play-mode]');
    if (modeButton) {
      state.mode = state.mode === modeButton.dataset.playMode ? '' : modeButton.dataset.playMode;
      renderControls();
      return;
    }
    const initiativeButton = target.closest('[data-play-init]');
    if (initiativeButton) {
      combatAction('roll_initiative', { tokenId: initiativeButton.dataset.playInit });
      return;
    }
    const combatButton = target.closest('[data-play-combat]');
    if (combatButton) {
      combatAction(combatButton.dataset.playCombat, {});
      return;
    }
    const control = target.closest('[data-play]');
    if (!control) return;
    if (control.dataset.play === 'toggle') setPanelOpen(!state.panelOpen);
    if (control.dataset.play === 'close') setPanelOpen(false);
    if (control.dataset.play === 'mute') {
      state.muted = !state.muted;
      try {
        localStorage.setItem('play-muted', state.muted ? '1' : '0');
      } catch (error) {
        showToast('Não foi possível lembrar a preferência de som.');
      }
      renderControls();
    }
  }

  function renderLog() {
    const list = document.getElementById('play-log');
    list.innerHTML = state.dice.length
      ? state.dice.slice().reverse().map(function (entry) {
          return '<li class="' + (entry.hidden ? 'secret' : '') + '">' +
            '<span><strong>' + escapeHtml(entry.who) + '</strong> ' + escapeHtml(entry.label || entry.expr) + '</span>' +
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
    const combat = state.combat;
    const master = isMasterUser();
    const rows = '<ol class="play-order">' + combat.order.map(orderRow).join('') + '</ol>';

    if (combat.phase === 'idle') {
      box.innerHTML = '<div class="play-head"><h2>⚔️ Combate</h2></div>' +
        (master
          ? '<button class="bt" style="width:100%" data-play-combat="start">Iniciar combate com os tokens da mesa</button>'
          : '<p class="mu">Nenhum combate em andamento. Os personagens só se movem durante o combate.</p>');
      return;
    }

    if (combat.phase === 'rolling') {
      box.innerHTML = '<div class="play-head"><h2>⚔️ Iniciativa</h2></div>' +
        '<p class="mu">Cada um rola seu d20. Quando todos rolarem, a ordem dos turnos se monta sozinha.</p>' + rows +
        (master
          ? '<div class="play-actions"><button class="bt" data-play-combat="roll_pending">Rolar pendentes</button><button class="bt" data-play-combat="stop">Cancelar</button></div>'
          : '');
      return;
    }

    const current = combat.order[combat.turn];
    const remaining = current ? Math.max(0, current.limit - current.moved) : 0;
    const movement = current && current.limit
      ? '<div class="vtt-move-bar"><i style="width:' + clamp((remaining / current.limit) * 100, 0, 100) + '%"></i></div>' +
        '<p class="mu">Movimento de ' + escapeHtml(current.name) + ': ' + remaining.toFixed(1).replace('.', ',') + 'm / ' + String(current.limit).replace('.', ',') + 'm</p>'
      : '';
    const canEnd = current && (master || current.owner === state.me.id);
    box.innerHTML = '<div class="play-head"><h2>⚔️ Rodada ' + combat.round + '</h2></div>' + rows + movement +
      '<div class="play-actions">' +
      (canEnd ? '<button class="bt" data-play-combat="end_turn">Encerrar turno</button>' : '') +
      (master ? '<button class="bt" data-play-combat="stop">Encerrar combate</button>' : '') +
      '</div>';
  }

  function chipMarkup(entry, index) {
    const combat = state.combat;
    const classes = ['turn-chip', entry.kind === 'npc' ? 'npc' : 'player'];
    if (combat.phase === 'running' && index === combat.turn) classes.push('current');
    if (!entry.present || !entry.alive) classes.push('out');
    return '<li class="' + classes.join(' ') + '" title="' + escapeHtml(entry.name) + '">' +
      '<i>' + escapeHtml(entry.name.slice(0, 2).toUpperCase()) + '</i>' +
      '<span>' + (entry.init === null ? '?' : entry.init) + '</span></li>';
  }

  function renderTurnBar() {
    const bar = document.getElementById('play-turnbar');
    const combat = state.combat;
    const master = isMasterUser();
    if (combat.phase === 'idle' || !state.me) {
      bar.hidden = true;
      return;
    }

    const chips = '<ol class="turn-chips">' + combat.order.map(chipMarkup).join('') + '</ol>';
    bar.hidden = false;
    bar.classList.remove('mine');

    if (combat.phase === 'rolling') {
      const rolled = combat.order.filter(function (entry) { return entry.init !== null; }).length;
      const mineEntry = combat.order.find(function (entry) {
        return entry.owner === state.me.id && entry.init === null;
      });
      let action = '';
      if (mineEntry) {
        action = '<button class="bt gold" data-play-init="' + escapeHtml(mineEntry.tokenId) + '">🎲 Rolar iniciativa (d20' + (mineEntry.mod ? formatSigned(mineEntry.mod) : '') + ')</button>';
        bar.classList.add('mine');
      } else if (master && rolled < combat.order.length) {
        action = '<button class="bt" data-play-combat="roll_pending">Rolar pendentes</button>';
      }
      bar.innerHTML = '<div class="turn-head"><b>⚔️ Iniciativa · ' + rolled + '/' + combat.order.length + '</b>' + action + '</div>' + chips;
      return;
    }

    const current = combat.order[combat.turn];
    const mine = !master && current.owner === state.me.id;
    const remaining = Math.max(0, current.limit - current.moved);
    bar.classList.toggle('mine', mine);
    bar.innerHTML =
      '<div class="turn-head"><b>⚔️ Rodada ' + combat.round + '</b>' +
      '<span class="turn-now">' + (mine ? 'SUA VEZ, ' : 'Turno de ') + escapeHtml(current.name) + '</span>' +
      '<span class="turn-move">👣 ' + remaining.toFixed(1).replace('.', ',') + 'm</span>' +
      (master || mine ? '<button class="bt gold" data-play-combat="end_turn">Passar turno</button>' : '') +
      '</div>' + chips;
  }

  function announceTurn() {
    const combat = state.combat;
    const current = combat.phase === 'running' ? combat.order[combat.turn] : null;
    const signature = current ? combat.round + ':' + combat.turn + ':' + current.tokenId : '';
    if (signature === state.announcedTurn) return;
    state.announcedTurn = signature;
    if (current && !isMasterUser() && current.owner === state.me.id) {
      showToast('É a sua vez, ' + current.name + '!');
      sounds.critical();
    }
  }

  function announcePhase() {
    const phase = state.combat.phase;
    if (phase === state.lastPhase) return;
    const previous = state.lastPhase;
    state.lastPhase = phase;
    if (phase === 'rolling' && previous === 'idle' && !isMasterUser()) {
      showToast('Combate iniciado! Role sua iniciativa.');
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
      if (!firstLoad && entry.whoId !== state.me.id) showRemoteRoll(entry);
    });

    const signature = JSON.stringify([data.dice.map(function (entry) { return entry.id; }), data.combat]);
    if (signature !== state.signature) {
      state.signature = signature;
      root.hidden = false;
      document.getElementById('play-hide-wrap').hidden = !isMasterUser();
      renderLog();
      renderCombat();
      renderTurnBar();
      document.dispatchEvent(new CustomEvent('play:update'));
    }
    announcePhase();
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
    getAudioContext();
    try {
      const result = await request('combat', 'POST', Object.assign({ op: operation }, extra));
      if (result.entry) showOwnRoll(result.entry);
      await fetchState();
    } catch (error) {
      showToast(error.message);
    }
  }

  function moveRule(tokenId, isMaster) {
    if (isMaster) return null;
    const combat = state.combat;
    const current = combat.phase === 'running' ? combat.order[combat.turn] : null;
    if (!current) {
      return { allowed: false, remaining: 0, reason: 'Só é possível se mover durante o combate, no seu turno.' };
    }
    if (current.tokenId !== tokenId) {
      return { allowed: false, remaining: 0, reason: 'Ainda não é o turno deste personagem.' };
    }
    return { allowed: true, remaining: Math.max(0, current.limit - current.moved), reason: '' };
  }

  function tick() {
    const key = sessionKey();
    if (!key) {
      root.hidden = true;
      setPanelOpen(false);
      state.key = '';
      state.me = null;
      state.knownRollIds = null;
      state.signature = '';
      state.announcedTurn = '';
      state.lastPhase = 'idle';
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
  document.getElementById('play-tray').dataset.run = '0';
  setInterval(tick, 1000);
  tick();
})();
