(function () {
  'use strict';

  var app = document.getElementById('app');
  var nv = document.getElementById('nv');
  var sbar = document.getElementById('sheet-bar');
  var filePick = document.getElementById('vtt-file-pick');
  var te = document.getElementById('toast');

  var mode = null; // null | 'table' | 'library'
  var pollTimer = null;
  var lockRefreshUntil = 0;

  var V = {
    isMaster: false,
    me: { id: '', name: '' },
    map: { mapId: '', name: 'Mesa Principal', bg: '', grid: 24, cellMeters: 1.5, fog: { on: false, ops: [] }, tokens: [] },
    roster: [],
    library: { maps: [], npcs: [] },
    tool: 'move', // 'move' | 'ruler' | 'reveal' | 'cover'
    brush: 6,     // 3 (P) | 6 (M) | 12 (G)
    zoom: 1,
    dragging: false,
    editMapId: '',
    editNpcId: '',
    draftMapImg: '',
    draftNpcImg: ''
  };

  function key() {
    return sessionStorage.getItem('fk') || '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function toast(msg) {
    if (!te) return;
    te.textContent = msg;
    te.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { te.classList.remove('on'); }, 3000);
  }

  function api(path, method, body) {
    return fetch('/api/' + path, {
      method: method || 'GET',
      headers: {
        'content-type': 'application/json',
        'x-key': key()
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Erro na requisição');
        return j;
      });
    });
  }

  function ensureNavButtons() {
    if (!nv || nv.hidden || !key()) return;
    var logoutBtn = nv.querySelector('[data-act="nav-logout"]');
    if (!logoutBtn) return;

    var isMaster = !!nv.querySelector('[data-act="nav-admin"]');
    var tableBtn = nv.querySelector('[data-vtt-nav="table"]');
    if (!tableBtn) {
      tableBtn = document.createElement('button');
      tableBtn.className = 'bt';
      tableBtn.dataset.vttNav = 'table';
      tableBtn.innerHTML = '🗺️ Mesa (Mapa)';
      nv.insertBefore(tableBtn, logoutBtn);
    }
    tableBtn.classList.toggle('on', mode === 'table');

    var libBtn = nv.querySelector('[data-vtt-nav="library"]');
    if (isMaster) {
      if (!libBtn) {
        libBtn = document.createElement('button');
        libBtn.className = 'bt';
        libBtn.dataset.vttNav = 'library';
        libBtn.innerHTML = '📚 Mapas &amp; NPCs';
        nv.insertBefore(libBtn, logoutBtn);
      }
      libBtn.classList.toggle('on', mode === 'library');
    } else if (libBtn) {
      libBtn.remove();
    }
  }

  if (nv) {
    var obs = new MutationObserver(function () {
      ensureNavButtons();
    });
    obs.observe(nv, { childList: true, attributes: true, attributeFilter: ['hidden'] });
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (mode === 'table' && !V.dragging && Date.now() > lockRefreshUntil) {
        fetchVttState(true);
      }
    }, 3500);
  }

  function fetchVttState(silent) {
    return api('vtt/state', 'GET').then(function (res) {
      V.isMaster = !!res.isMaster;
      V.me = res.me || V.me;
      V.map = res.map || V.map;
      V.roster = res.roster || [];
      if (res.library) {
        V.library = {
          maps: Array.isArray(res.library.maps) ? res.library.maps : [],
          npcs: Array.isArray(res.library.npcs) ? res.library.npcs : []
        };
      }

      if (mode === 'table') {
        if (silent && document.getElementById('vtt-stage')) {
          updateStageOnly();
        } else {
          renderTable();
        }
      } else if (mode === 'library' && !silent) {
        renderLibrary();
      }
    }).catch(function (err) {
      if (!silent) toast(err.message);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     ABA 1: MESA (MAPA VTT)
     ═══════════════════════════════════════════════════════════════ */
  function renderTable() {
    if (!app) return;
    if (sbar) sbar.hidden = true;
    document.getElementById('bgi').style.backgroundImage = '';
    app.className = 'wrap single vtt-active';
    ensureNavButtons();

    var m = V.map;
    var mapsList = V.library.maps || [];
    var npcsList = V.library.npcs || [];
    var activePlayersCount = (m.tokens || []).filter(function (t) { return t.kind === 'player'; }).length;

    app.innerHTML =
      '<div class="vtt-layout">' +
      '<div class="vtt-main-col">' +
      '<div class="pn vtt-toolbar">' +
      (V.isMaster
        ? '<select id="vtt-scene-select" aria-label="Trocar mapa salvo">' +
          '<option value="">-- Trocar Mapa Salvo --</option>' +
          mapsList.map(function (mp) {
            return '<option value="' + esc(mp.id) + '"' + (mp.id === m.mapId ? ' selected' : '') + '>' + esc(mp.name) + '</option>';
          }).join('') +
          '</select>'
        : '<span class="tag">🗺️ ' + esc(m.name || 'Mesa Ativa') + '</span>') +
      '<div class="vtt-tool-group">' +
      '<button class="bt ' + (V.tool === 'move' ? 'on' : '') + '" data-vtt-tool="move">✋ Mover</button>' +
      '<button class="bt ' + (V.tool === 'ruler' ? 'on' : '') + '" data-vtt-tool="ruler">📏 Régua</button>' +
      (V.isMaster
        ? '<button class="bt ' + (V.tool === 'reveal' ? 'on' : '') + '" data-vtt-tool="reveal">👁️ Revelar</button>' +
          '<button class="bt ' + (V.tool === 'cover' ? 'on' : '') + '" data-vtt-tool="cover">🌑 Cobrir</button>' +
          '<button class="bt" data-vtt-act="cycle-brush">Pincel ' + (V.brush <= 3 ? 'P' : V.brush <= 6 ? 'M' : 'G') + '</button>' +
          '<button class="bt" data-vtt-act="fog-cover-all">Cobrir Tudo</button>' +
          '<button class="bt" data-vtt-act="fog-reveal-all">Revelar Tudo</button>'
        : '') +
      '</div>' +
      '<div class="vtt-tool-group" style="margin-left:auto;">' +
      '<button class="bt x" data-vtt-act="zoom-out">−</button>' +
      '<span class="vtt-zoom-badge" id="vtt-zoom-txt">' + Math.round(V.zoom * 100) + '%</span>' +
      '<button class="bt x" data-vtt-act="zoom-in">+</button>' +
      '</div>' +
      '</div>' +

      '<div class="vtt-viewport" id="vtt-viewport">' +
      (m.bg
        ? '<div class="vtt-stage" id="vtt-stage" style="transform:scale(' + V.zoom + ');">' +
          '<img class="vtt-bg" id="vtt-map-img" src="' + esc(m.bg) + '" alt="' + esc(m.name) + '">' +
          '<div class="vtt-grid" id="vtt-grid"></div>' +
          '<div class="vtt-tokens" id="vtt-tokens"></div>' +
          '<canvas class="vtt-fog' + (V.isMaster && (V.tool === 'reveal' || V.tool === 'cover') ? ' painting' : '') + '" id="vtt-fog"></canvas>' +
          '<div class="vtt-brush" id="vtt-brush"></div>' +
          '<svg class="vtt-ruler" id="vtt-ruler"></svg>' +
          '</div>'
        : '<div class="vtt-empty-stage">' +
          '<h2>Nenhum mapa carregado na mesa</h2>' +
          '<p class="mu">' + (V.isMaster ? 'Vá na aba "📚 Mapas &amp; NPCs" para cadastrar mapas e ativá-los aqui.' : 'Aguarde o Mestre carregar o mapa da cena.') + '</p>' +
          (V.isMaster ? '<button class="bt" data-vtt-nav="library">Abrir Mapas &amp; NPCs</button>' : '') +
          '</div>') +
      '</div>' +
      '</div>' +

      '<aside class="vtt-side">' +
      '<section class="pn">' +
      '<h2>⚔️ Jogadores na Mesa <small>' + activePlayersCount + '/' + V.roster.length + '</small></h2>' +
      (V.roster.length
        ? V.roster.map(function (p) {
            var onTable = (m.tokens || []).some(function (t) { return t.kind === 'player' && t.owner === p.id; });
            return '<div class="vtt-roster-item">' +
              '<div class="vtt-mini-av">' + (p.avatar ? '<img src="' + esc(p.avatar) + '" alt="">' : esc((p.charName || p.playerName || '?').slice(0, 2).toUpperCase())) + '</div>' +
              '<div class="vtt-roster-info"><strong>' + esc(p.charName || p.playerName) + '</strong><small>' + esc(p.playerName) + '</small></div>' +
              (V.isMaster
                ? '<button class="bt' + (onTable ? ' sure' : '') + '" data-vtt-act="toggle-player" data-id="' + esc(p.id) + '" data-on="' + (onTable ? '1' : '0') + '">' + (onTable ? 'Tirar' : 'Colocar') + '</button>'
                : '<span class="pin-tag">' + (onTable ? 'Em cena' : 'Fora') + '</span>') +
              '</div>';
          }).join('')
        : '<p class="mu">Nenhum jogador cadastrado.</p>') +
      '</section>' +

      (V.isMaster
        ? '<section class="pn">' +
          '<h2>👹 Invocar NPC / Inimigo <button class="bt x" style="margin-left:auto;" data-vtt-nav="library">+ Criar</button></h2>' +
          (npcsList.length
            ? npcsList.map(function (npc) {
                return '<div class="vtt-roster-item">' +
                  '<div class="vtt-mini-av" style="border-color:' + esc(npc.color || '#9e1b1b') + ';">' + (npc.avatar ? '<img src="' + esc(npc.avatar) + '" alt="">' : esc((npc.name || 'N').slice(0, 2).toUpperCase())) + '</div>' +
                  '<div class="vtt-roster-info"><strong>' + esc(npc.name) + '</strong><small>HP ' + (npc.hp || 15) + ' · ' + (npc.size || 1) + 'x' + (npc.size || 1) + '</small></div>' +
                  '<button class="bt" data-vtt-act="spawn-npc" data-id="' + esc(npc.id) + '">+ Invocar</button>' +
                  '</div>';
              }).join('')
            : '<p class="mu">Cadastre NPCs na aba Mapas &amp; NPCs para invocá-los aqui.</p>') +
          '</section>'
        : '') +

      '<section class="pn">' +
      '<h2>Tokens Ativos <small>' + (m.tokens || []).length + '</small></h2>' +
      ((m.tokens || []).length
        ? (m.tokens || []).map(function (tok) {
            return '<div class="vtt-roster-item">' +
              '<div class="vtt-mini-av" style="border-color:' + esc(tok.color || '#d8b45a') + ';">' + (tok.avatar ? '<img src="' + esc(tok.avatar) + '" alt="">' : esc((tok.name || '?').slice(0, 2).toUpperCase())) + '</div>' +
              '<div class="vtt-roster-info"><strong>' + esc(tok.name) + '</strong><small>' + (tok.kind === 'player' ? 'Jogador' : 'HP ' + (tok.hp ?? 0) + '/' + (tok.mhp ?? 0)) + '</small></div>' +
              (V.isMaster
                ? '<div style="display:flex; gap:4px;">' +
                  (tok.kind === 'npc'
                    ? '<button class="bt x" data-vtt-act="tok-hp" data-id="' + esc(tok.id) + '" data-d="-1" title="Dano">−</button>' +
                      '<button class="bt x" data-vtt-act="tok-hp" data-id="' + esc(tok.id) + '" data-d="1" title="Curar">+</button>'
                    : '') +
                  '<button class="bt x" data-vtt-act="remove-tok" data-id="' + esc(tok.id) + '" title="Remover da mesa">×</button>' +
                  '</div>'
                : '') +
              '</div>';
          }).join('') +
          (V.isMaster && (m.tokens || []).some(function (t) { return t.kind === 'npc'; })
            ? '<p style="margin:10px 0 0;"><button class="bt" style="width:100%;" data-vtt-act="clear-npcs">Limpar Todos os NPCs</button></p>'
            : '')
        : '<p class="mu">Nenhum token no mapa.</p>') +
      '</section>' +
      '</aside>' +
      '</div>';

    var sel = document.getElementById('vtt-scene-select');
    if (sel) {
      sel.onchange = function () {
        var found = (V.library.maps || []).find(function (x) { return x.id === sel.value; });
        if (!found) return;
        api('vtt/table', 'POST', { op: 'activate_map', map: found, keepTokens: true }).then(function () {
          toast('Mapa "' + found.name + '" ativado!');
          fetchVttState(false);
        }).catch(function (err) { toast(err.message); });
      };
    }

    var imgEl = document.getElementById('vtt-map-img');
    if (imgEl) {
      if (imgEl.complete) updateStageOnly();
      else imgEl.onload = updateStageOnly;
    }

    bindStageInteractions();
  }

  function updateStageOnly() {
    var stage = document.getElementById('vtt-stage');
    var imgEl = document.getElementById('vtt-map-img');
    var gridEl = document.getElementById('vtt-grid');
    var tokensEl = document.getElementById('vtt-tokens');
    var fogEl = document.getElementById('vtt-fog');
    if (!stage || !imgEl || !gridEl || !tokensEl || !fogEl) return;

    var w = imgEl.clientWidth;
    var h = imgEl.clientHeight;
    if (!w || !h) return;

    var cols = Number(V.map.grid) || 0;
    var cellPx = cols > 0 ? w / cols : 0;
    gridEl.style.backgroundImage = cellPx > 0
      ? 'linear-gradient(rgba(255,255,255,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.16) 1px, transparent 1px)'
      : 'none';
    gridEl.style.backgroundSize = cellPx + 'px ' + cellPx + 'px';

    tokensEl.innerHTML = (V.map.tokens || []).map(function (tok) {
      var canMove = V.isMaster || tok.owner === V.me.id;
      var szFactor = Math.max(1, Number(tok.size) || 1);
      var pxSize = cellPx > 0 ? Math.max(28, cellPx * szFactor * 0.88) : Math.max(32, w * 0.042 * szFactor);
      return '<div class="vtt-token' + (canMove ? ' movable' : '') + (window.Play && window.Play.currentTokenId() === tok.id ? ' active-turn' : '') + '" data-tok-id="' + esc(tok.id) + '" style="left:' + tok.x + '%; top:' + tok.y + '%; width:' + pxSize + 'px; height:' + pxSize + 'px; --ring:' + esc(tok.color || '#d8b45a') + ';">' +
        (tok.kind === 'npc' && (V.isMaster || tok.hp !== undefined) ? '<span class="vtt-token-hp">' + (tok.hp ?? 0) + '/' + (tok.mhp ?? 0) + '</span>' : '') +
        (tok.avatar ? '<img src="' + esc(tok.avatar) + '" alt="">' : '<span>' + esc((tok.name || '?').slice(0, 2).toUpperCase()) + '</span>') +
        '<span class="vtt-token-label">' + esc(tok.name) + '</span>' +
        '</div>';
    }).join('');

    var fog = V.map.fog || { on: false, ops: [] };
    fogEl.className = 'vtt-fog' + (V.isMaster && (V.tool === 'reveal' || V.tool === 'cover') ? ' painting' : '');
    if (!fog.on) {
      fogEl.style.display = 'none';
      return;
    }
    fogEl.style.display = 'block';
    fogEl.style.opacity = V.isMaster ? '0.52' : '1';
    fogEl.width = w;
    fogEl.height = h;
    var ctx = fogEl.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#070403';
    ctx.fillRect(0, 0, w, h);

    (fog.ops || []).forEach(function (op) {
      var x = (op[0] / 100) * w;
      var y = (op[1] / 100) * h;
      var r = (op[2] / 100) * w;
      var reveal = op[3] === 1;
      ctx.globalCompositeOperation = reveal ? 'destination-out' : 'source-over';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function bindStageInteractions() {
    var stage = document.getElementById('vtt-stage');
    var tokensEl = document.getElementById('vtt-tokens');
    var fogEl = document.getElementById('vtt-fog');
    var rulerEl = document.getElementById('vtt-ruler');
    var brushEl = document.getElementById('vtt-brush');
    if (!stage || !tokensEl || !fogEl) return;

    var draggingTok = null;
    var originPct = null;
    var rulerStart = null;
    var painting = false;
    var pendingOps = [];

    function toPct(clientX, clientY) {
      var rect = stage.getBoundingClientRect();
      return {
        x: Math.max(1, Math.min(99, ((clientX - rect.left) / rect.width) * 100)),
        y: Math.max(1, Math.min(99, ((clientY - rect.top) / rect.height) * 100))
      };
    }

    function distMeters(p1, p2) {
      var cols = Number(V.map.grid) || 24;
      var metersPerCell = Number(V.map.cellMeters) || 1.5;
      var ratio = stage.clientHeight / Math.max(1, stage.clientWidth);
      var dx = ((p2.x - p1.x) / 100) * cols;
      var dy = ((p2.y - p1.y) / 100) * cols * ratio;
      return Math.hypot(dx, dy) * metersPerCell;
    }

    function drawRuler(p1, p2, limit) {
      if (!rulerEl) return;
      var w = stage.clientWidth;
      var h = stage.clientHeight;
      rulerEl.setAttribute('width', w);
      rulerEl.setAttribute('height', h);
      var x1 = (p1.x / 100) * w;
      var y1 = (p1.y / 100) * h;
      var x2 = (p2.x / 100) * w;
      var y2 = (p2.y / 100) * h;
      var m = distMeters(p1, p2);
      var circle = '';
      if (limit != null && V.map.grid) {
        var rPx = (limit / (Number(V.map.cellMeters) || 1.5)) * (w / Number(V.map.grid));
        circle = '<circle cx="' + x1 + '" cy="' + y1 + '" r="' + rPx + '" fill="rgba(246,226,168,0.08)" stroke="#f6e2a8" stroke-width="2" stroke-dasharray="6 4"/>';
      }
      var lbl = m.toFixed(1).replace('.', ',') + 'm' + (limit != null ? ' / ' + limit.toFixed(1).replace('.', ',') + 'm' : '');
      rulerEl.innerHTML = circle +
        '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#f6e2a8" stroke-width="3"/>' +
        '<text x="' + (x2 + 12) + '" y="' + (y2 - 12) + '" fill="#f6e2a8" font-size="14" font-weight="700" stroke="#000" stroke-width="3" paint-order="stroke">' + lbl + '</text>';
    }

    function clearRuler() {
      if (rulerEl) rulerEl.innerHTML = '';
    }

    stage.onpointerdown = function (e) {
      if (V.tool === 'ruler') {
        rulerStart = toPct(e.clientX, e.clientY);
        stage.setPointerCapture(e.pointerId);
        return;
      }

      if (V.isMaster && (V.tool === 'reveal' || V.tool === 'cover')) {
        painting = true;
        stage.setPointerCapture(e.pointerId);
        paintAt(e);
        return;
      }

      var tokEl = e.target.closest('.vtt-token.movable');
      if (!tokEl) return;
      var tokData = (V.map.tokens || []).find(function (t) { return t.id === tokEl.dataset.tokId; });
      if (!tokData) return;

      var rule = window.Play ? window.Play.moveRule(tokData.id, V.isMaster) : null;
      if (rule && !rule.allowed) {
        toast('Não é o turno deste personagem.');
        return;
      }
      draggingTok = { el: tokEl, data: tokData, limit: rule ? rule.remaining : null };
      V.dragging = true;
      originPct = { x: tokData.x, y: tokData.y };
      stage.setPointerCapture(e.pointerId);
    };

    stage.onpointermove = function (e) {
      if (V.isMaster && (V.tool === 'reveal' || V.tool === 'cover') && brushEl) {
        var rect = stage.getBoundingClientRect();
        var px = (V.brush * 2 * stage.clientWidth) / 100;
        brushEl.style.display = 'block';
        brushEl.style.width = px + 'px';
        brushEl.style.height = px + 'px';
        brushEl.style.left = ((e.clientX - rect.left) / V.zoom) + 'px';
        brushEl.style.top = ((e.clientY - rect.top) / V.zoom) + 'px';
      } else if (brushEl) {
        brushEl.style.display = 'none';
      }

      if (rulerStart) {
        drawRuler(rulerStart, toPct(e.clientX, e.clientY), null);
        return;
      }

      if (painting) {
        paintAt(e);
        return;
      }

      if (!draggingTok) return;
      var target = toPct(e.clientX, e.clientY);
      var limit = draggingTok.limit;
      if (limit !== null) {
        var d = distMeters(originPct, target);
        if (d > limit && d > 0) {
          var f = limit / d;
          target.x = originPct.x + (target.x - originPct.x) * f;
          target.y = originPct.y + (target.y - originPct.y) * f;
        }
      }
      draggingTok.el.style.left = target.x + '%';
      draggingTok.el.style.top = target.y + '%';
      drawRuler(originPct, target, limit);
    };

    stage.onpointerup = function () {
      if (rulerStart) {
        rulerStart = null;
        clearRuler();
        return;
      }

      if (painting) {
        painting = false;
        if (pendingOps.length) {
          var batch = pendingOps.slice();
          pendingOps = [];
          lockRefreshUntil = Date.now() + 2000;
          api('vtt/fog', 'POST', { ops: batch }).catch(function (err) { toast(err.message); });
        }
        return;
      }

      if (!draggingTok) return;
      var nx = parseFloat(draggingTok.el.style.left);
      var ny = parseFloat(draggingTok.el.style.top);
      var moved = distMeters(originPct, { x: nx, y: ny });
      draggingTok.data.x = nx;
      draggingTok.data.y = ny;
      var id = draggingTok.data.id;
      draggingTok = null;
      clearRuler();
      V.dragging = false;
      lockRefreshUntil = Date.now() + 2500;
      api('vtt/move', 'POST', { id: id, x: nx, y: ny, meters: Number(moved.toFixed(2)) }).then(function () {
        if (window.Play) window.Play.refresh();
      }).catch(function (err) {
        toast(err.message);
        lockRefreshUntil = 0;
        fetchVttState(true);
      });
    };

    stage.onpointercancel = function () {
      draggingTok = null;
      rulerStart = null;
      painting = false;
      pendingOps = [];
      V.dragging = false;
      clearRuler();
      updateStageOnly();
    };

    function paintAt(e) {
      var p = toPct(e.clientX, e.clientY);
      var op = [Number(p.x.toFixed(2)), Number(p.y.toFixed(2)), V.brush, V.tool === 'reveal' ? 1 : 0];
      V.map.fog = V.map.fog || { on: true, ops: [] };
      V.map.fog.on = true;
      V.map.fog.ops.push(op);
      pendingOps.push(op);
      updateStageOnly();
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     ABA 2: MAPAS & NPCS (BIBLIOTECA PERSISTENTE DO MESTRE)
     ═══════════════════════════════════════════════════════════════ */
  function renderLibrary() {
    if (!app) return;
    if (sbar) sbar.hidden = true;
    document.getElementById('bgi').style.backgroundImage = '';
    app.className = 'wrap single vtt-active';
    ensureNavButtons();

    var maps = V.library.maps || [];
    var npcs = V.library.npcs || [];
    var editMap = maps.find(function (x) { return x.id === V.editMapId; }) || null;
    var editNpc = npcs.find(function (x) { return x.id === V.editNpcId; }) || null;

    var mapPreview = V.draftMapImg || (editMap && editMap.bg) || '';
    var npcPreview = V.draftNpcImg || (editNpc && editNpc.avatar) || '';

    app.innerHTML =
      '<div class="vtt-lib-grid">' +
      /* COLUNA ESQUERDA: MAPAS */
      '<section class="pn paper-pn">' +
      '<h2>🗺️ Biblioteca de Mapas <small>' + maps.length + '</small></h2>' +
      '<form id="vtt-map-form" class="vtt-form-box">' +
      '<strong>' + (editMap ? '✏️ Editando Mapa' : '+ Cadastrar Novo Mapa') + '</strong>' +
      '<div><label class="lab">Nome do Mapa</label><input id="lib-map-name" value="' + esc(editMap ? editMap.name : '') + '" placeholder="Ex: Taverna Velha / Floresta" required></div>' +
      '<div class="vtt-preview-box" id="lib-map-prev">' + (mapPreview ? '<img src="' + esc(mapPreview) + '" alt="">' : 'Pré-visualização do mapa') + '</div>' +
      '<div class="vtt-form-row">' +
      '<button type="button" class="bt" data-vtt-pick="map">📁 Enviar Imagem</button>' +
      '<input id="lib-map-url" value="' + esc(mapPreview.startsWith('data:') ? '' : mapPreview) + '" placeholder="Ou cole o link (URL) da imagem">' +
      '</div>' +
      '<div class="vtt-form-row">' +
      '<div><label class="lab">Colunas do Grid (0 = sem)</label><input id="lib-map-grid" type="number" min="0" max="80" value="' + (editMap ? editMap.grid : 24) + '"></div>' +
      '<div><label class="lab">Metros por Quadrado</label><input id="lib-map-meters" type="number" step="0.5" min="0.5" value="' + (editMap ? (editMap.cellMeters || 1.5) : 1.5) + '"></div>' +
      '</div>' +
      '<label style="display:flex; align-items:center; gap:8px; cursor:pointer;"><input id="lib-map-fog" type="checkbox" style="width:auto;"' + (editMap && editMap.fogOn ? ' checked' : '') + '> Iniciar com Névoa de Guerra coberta</label>' +
      '<div style="display:flex; gap:8px;">' +
      '<button type="submit" class="bt" style="flex:1;">' + (editMap ? 'Salvar Alterações' : 'Salvar Mapa') + '</button>' +
      (editMap ? '<button type="button" class="bt" data-vtt-act="cancel-edit-map">Cancelar</button>' : '') +
      '</div>' +
      '</form>' +

      '<div class="vtt-saved-list">' +
      (maps.length
        ? maps.map(function (mp) {
            return '<div class="vtt-saved-card">' +
              '<div class="vtt-saved-thumb">' + (mp.bg ? '<img src="' + esc(mp.bg) + '" alt="">' : '🗺️') + '</div>' +
              '<div class="vtt-saved-meta"><strong>' + esc(mp.name) + '</strong><small>Grid: ' + (mp.grid || 0) + ' cols · ' + (mp.cellMeters || 1.5) + 'm</small></div>' +
              '<div class="vtt-card-actions">' +
              '<button class="bt" data-vtt-act="activate-map" data-id="' + esc(mp.id) + '">▶️ Ativar</button>' +
              '<button class="bt x" data-vtt-act="edit-map" data-id="' + esc(mp.id) + '" title="Editar">✏️</button>' +
              '<button class="bt x" data-vtt-act="del-map" data-id="' + esc(mp.id) + '" title="Excluir">×</button>' +
              '</div>' +
              '</div>';
          }).join('')
        : '<p class="mu">Nenhum mapa armazenado ainda.</p>') +
      '</div>' +
      '</section>' +

      /* COLUNA DIREITA: NPCS & INIMIGOS */
      '<section class="pn paper-pn">' +
      '<h2>👹 Bestiário (NPCs &amp; Inimigos) <small>' + npcs.length + '</small></h2>' +
      '<form id="vtt-npc-form" class="vtt-form-box">' +
      '<strong>' + (editNpc ? '✏️ Editando NPC / Inimigo' : '+ Cadastrar NPC / Inimigo') + '</strong>' +
      '<div style="display:flex; gap:12px; align-items:center;">' +
      '<div class="vtt-saved-thumb round" id="lib-npc-prev" style="width:68px; height:68px;">' + (npcPreview ? '<img src="' + esc(npcPreview) + '" alt="">' : '👹') + '</div>' +
      '<div style="flex:1; display:grid; gap:6px;">' +
      '<input id="lib-npc-name" value="' + esc(editNpc ? editNpc.name : '') + '" placeholder="Nome do NPC ou Inimigo" required>' +
      '<div class="vtt-form-row">' +
      '<button type="button" class="bt" data-vtt-pick="npc">📁 Foto</button>' +
      '<input id="lib-npc-url" value="' + esc(npcPreview.startsWith('data:') ? '' : npcPreview) + '" placeholder="Ou link (URL) da foto">' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="vtt-form-row" style="grid-template-columns:1fr 1fr 1fr;">' +
      '<div><label class="lab">HP</label><input id="lib-npc-hp" type="number" min="1" value="' + (editNpc ? editNpc.hp : 20) + '"></div>' +
      '<div><label class="lab">Tamanho</label><select id="lib-npc-size">' +
      [1, 2, 3, 4].map(function (sz) {
        return '<option value="' + sz + '"' + ((editNpc ? editNpc.size : 1) === sz ? ' selected' : '') + '>' + sz + 'x' + sz + '</option>';
      }).join('') +
      '</select></div>' +
      '<div><label class="lab">Cor do Anel</label><input id="lib-npc-color" type="color" value="' + esc(editNpc ? editNpc.color : '#9e1b1b') + '" style="height:34px; padding:2px;"></div>' +
      '</div>' +
      '<div style="display:flex; gap:8px;">' +
      '<button type="submit" class="bt" style="flex:1;">' + (editNpc ? 'Salvar Alterações' : 'Salvar NPC') + '</button>' +
      (editNpc ? '<button type="button" class="bt" data-vtt-act="cancel-edit-npc">Cancelar</button>' : '') +
      '</div>' +
      '</form>' +

      '<div class="vtt-saved-list">' +
      (npcs.length
        ? npcs.map(function (npc) {
            return '<div class="vtt-saved-card">' +
              '<div class="vtt-saved-thumb round" style="border-color:' + esc(npc.color || '#9e1b1b') + ';">' + (npc.avatar ? '<img src="' + esc(npc.avatar) + '" alt="">' : esc((npc.name || 'N').slice(0, 2).toUpperCase())) + '</div>' +
              '<div class="vtt-saved-meta"><strong>' + esc(npc.name) + '</strong><small>HP: ' + (npc.hp || 20) + ' · Tamanho: ' + (npc.size || 1) + 'x' + (npc.size || 1) + '</small></div>' +
              '<div class="vtt-card-actions">' +
              '<button class="bt" data-vtt-act="spawn-npc" data-id="' + esc(npc.id) + '">⚔️ Invocar</button>' +
              '<button class="bt x" data-vtt-act="edit-npc" data-id="' + esc(npc.id) + '" title="Editar">✏️</button>' +
              '<button class="bt x" data-vtt-act="del-npc" data-id="' + esc(npc.id) + '" title="Excluir">×</button>' +
              '</div>' +
              '</div>';
          }).join('')
        : '<p class="mu">Nenhum NPC ou inimigo armazenado ainda.</p>') +
      '</div>' +
      '</section>' +
      '</div>';

    var mapUrlInput = document.getElementById('lib-map-url');
    if (mapUrlInput) {
      mapUrlInput.oninput = function () {
        V.draftMapImg = mapUrlInput.value.trim();
        var prev = document.getElementById('lib-map-prev');
        if (prev) prev.innerHTML = V.draftMapImg ? '<img src="' + esc(V.draftMapImg) + '" alt="">' : 'Pré-visualização do mapa';
      };
    }

    var npcUrlInput = document.getElementById('lib-npc-url');
    if (npcUrlInput) {
      npcUrlInput.oninput = function () {
        V.draftNpcImg = npcUrlInput.value.trim();
        var prev = document.getElementById('lib-npc-prev');
        if (prev) prev.innerHTML = V.draftNpcImg ? '<img src="' + esc(V.draftNpcImg) + '" alt="">' : '👹';
      };
    }

    document.getElementById('vtt-map-form').onsubmit = function (e) {
      e.preventDefault();
      var name = document.getElementById('lib-map-name').value.trim();
      var bg = V.draftMapImg || document.getElementById('lib-map-url').value.trim() || (editMap && editMap.bg) || '';
      var grid = Number(document.getElementById('lib-map-grid').value) || 0;
      var cellMeters = Number(document.getElementById('lib-map-meters').value) || 1.5;
      var fogOn = document.getElementById('lib-map-fog').checked;
      if (!name || !bg) {
        toast('Informe o nome e a imagem do mapa.');
        return;
      }

      var nextMaps = maps.slice();
      if (editMap) {
        nextMaps = nextMaps.map(function (item) {
          return item.id === editMap.id ? { id: item.id, name: name, bg: bg, grid: grid, cellMeters: cellMeters, fogOn: fogOn } : item;
        });
      } else {
        nextMaps.push({ id: 'map_' + Date.now().toString(36), name: name, bg: bg, grid: grid, cellMeters: cellMeters, fogOn: fogOn });
      }

      api('vtt/library', 'POST', { maps: nextMaps }).then(function (res) {
        V.library.maps = res.library.maps;
        V.editMapId = '';
        V.draftMapImg = '';
        toast('Mapa salvo na biblioteca!');
        renderLibrary();
      }).catch(function (err) { toast(err.message); });
    };

    document.getElementById('vtt-npc-form').onsubmit = function (e) {
      e.preventDefault();
      var name = document.getElementById('lib-npc-name').value.trim();
      var avatar = V.draftNpcImg || document.getElementById('lib-npc-url').value.trim() || (editNpc && editNpc.avatar) || '';
      var hp = Number(document.getElementById('lib-npc-hp').value) || 20;
      var size = Number(document.getElementById('lib-npc-size').value) || 1;
      var color = document.getElementById('lib-npc-color').value || '#9e1b1b';
      if (!name) {
        toast('Informe o nome do NPC.');
        return;
      }

      var nextNpcs = npcs.slice();
      if (editNpc) {
        nextNpcs = nextNpcs.map(function (item) {
          return item.id === editNpc.id ? { id: item.id, name: name, avatar: avatar, hp: hp, mhp: hp, size: size, color: color } : item;
        });
      } else {
        nextNpcs.push({ id: 'npc_' + Date.now().toString(36), name: name, avatar: avatar, hp: hp, mhp: hp, size: size, color: color });
      }

      api('vtt/library', 'POST', { npcs: nextNpcs }).then(function (res) {
        V.library.npcs = res.library.npcs;
        V.editNpcId = '';
        V.draftNpcImg = '';
        toast('NPC salvo no bestiário!');
        renderLibrary();
      }).catch(function (err) { toast(err.message); });
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     UPLOAD COMPRIMIDO DE MAPAS E AVATARES DE NPCS
     ═══════════════════════════════════════════════════════════════ */
  var pendingPickType = '';
  if (filePick) {
    filePick.addEventListener('change', function () {
      var f = filePick.files && filePick.files[0];
      filePick.value = '';
      if (!f || !pendingPickType) return;
      var r = new FileReader();
      r.onload = function () {
        var img = new Image();
        img.onload = function () {
          var maxDim = pendingPickType === 'map' ? 1280 : 256;
          var ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * ratio));
          var h = Math.max(1, Math.round(img.height * ratio));
          var cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          var compressed = cv.toDataURL('image/jpeg', 0.8);
          if (pendingPickType === 'map') {
            V.draftMapImg = compressed;
            var prevM = document.getElementById('lib-map-prev');
            if (prevM) prevM.innerHTML = '<img src="' + compressed + '" alt="">';
          } else {
            V.draftNpcImg = compressed;
            var prevN = document.getElementById('lib-npc-prev');
            if (prevN) prevN.innerHTML = '<img src="' + compressed + '" alt="">';
          }
          pendingPickType = '';
        };
        img.src = r.result;
      };
      r.readAsDataURL(f);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     EVENTOS GLOBAIS DE NAVEGAÇÃO E AÇÕES DO VTT
     ═══════════════════════════════════════════════════════════════ */
  document.addEventListener('click', function (e) {
    // Se clicou em abas da ficha/admin/logout, sai do modo VTT
    var sheetNav = e.target.closest('[data-act="nav-sheet"], [data-act="nav-admin"], [data-act="nav-logout"]');
    if (sheetNav) {
      mode = null;
      stopPolling();
      ensureNavButtons();
      return;
    }

    var navBtn = e.target.closest('[data-vtt-nav]');
    if (navBtn) {
      mode = navBtn.dataset.vttNav;
      nv.querySelectorAll('.bt').forEach(function (b) { b.classList.remove('on'); });
      ensureNavButtons();
      if (mode === 'table') {
        renderTable();
        fetchVttState(false);
        startPolling();
      } else {
        stopPolling();
        renderLibrary();
        fetchVttState(false);
      }
      return;
    }

    var pickBtn = e.target.closest('[data-vtt-pick]');
    if (pickBtn && filePick) {
      pendingPickType = pickBtn.dataset.vttPick;
      filePick.click();
      return;
    }

    var toolBtn = e.target.closest('[data-vtt-tool]');
    if (toolBtn) {
      V.tool = toolBtn.dataset.vttTool;
      renderTable();
      return;
    }

    var actBtn = e.target.closest('[data-vtt-act]');
    if (!actBtn) return;
    var act = actBtn.dataset.vttAct;
    var id = actBtn.dataset.id;

    if (act === 'cycle-brush') {
      V.brush = V.brush <= 3 ? 6 : V.brush <= 6 ? 12 : 3;
      renderTable();
    } else if (act === 'zoom-in') {
      V.zoom = Math.min(2, +(V.zoom + 0.15).toFixed(2));
      renderTable();
    } else if (act === 'zoom-out') {
      V.zoom = Math.max(0.5, +(V.zoom - 0.15).toFixed(2));
      renderTable();
    } else if (act === 'fog-cover-all') {
      api('vtt/fog', 'POST', { op: 'cover_all' }).then(function () { fetchVttState(false); });
    } else if (act === 'fog-reveal-all') {
      api('vtt/fog', 'POST', { op: 'reveal_all' }).then(function () { fetchVttState(false); });
    } else if (act === 'toggle-player') {
      var op = actBtn.dataset.on === '1' ? 'remove_player' : 'put_player';
      api('vtt/table', 'POST', { op: op, playerId: id }).then(function () { fetchVttState(false); });
    } else if (act === 'spawn-npc') {
      var npc = (V.library.npcs || []).find(function (x) { return x.id === id; });
      if (!npc) return;
      api('vtt/table', 'POST', { op: 'spawn_npc', npc: npc }).then(function () {
        toast(npc.name + ' invocado na mesa!');
        if (mode === 'table') fetchVttState(false);
      });
    } else if (act === 'tok-hp') {
      var tok = (V.map.tokens || []).find(function (t) { return t.id === id; });
      if (!tok) return;
      var delta = Number(actBtn.dataset.d) || 0;
      var nextHp = Math.max(0, (Number(tok.hp) || 0) + delta);
      api('vtt/table', 'POST', { op: 'update_token', id: id, hp: nextHp }).then(function () { fetchVttState(false); });
    } else if (act === 'remove-tok') {
      api('vtt/table', 'POST', { op: 'remove_token', id: id }).then(function () { fetchVttState(false); });
    } else if (act === 'clear-npcs') {
      api('vtt/table', 'POST', { op: 'clear_npcs' }).then(function () { fetchVttState(false); });
    } else if (act === 'activate-map') {
      var mp = (V.library.maps || []).find(function (x) { return x.id === id; });
      if (!mp) return;
      api('vtt/table', 'POST', { op: 'activate_map', map: mp, keepTokens: true }).then(function () {
        mode = 'table';
        ensureNavButtons();
        renderTable();
        fetchVttState(false);
        startPolling();
        toast('Mapa "' + mp.name + '" ativado na mesa!');
      });
    } else if (act === 'edit-map') {
      V.editMapId = id;
      V.draftMapImg = '';
      renderLibrary();
    } else if (act === 'cancel-edit-map') {
      V.editMapId = '';
      V.draftMapImg = '';
      renderLibrary();
    } else if (act === 'del-map') {
      if (!confirm('Excluir este mapa da biblioteca?')) return;
      var nextM = (V.library.maps || []).filter(function (x) { return x.id !== id; });
      api('vtt/library', 'POST', { maps: nextM }).then(function (res) {
        V.library.maps = res.library.maps;
        renderLibrary();
      });
    } else if (act === 'edit-npc') {
      V.editNpcId = id;
      V.draftNpcImg = '';
      renderLibrary();
    } else if (act === 'cancel-edit-npc') {
      V.editNpcId = '';
      V.draftNpcImg = '';
      renderLibrary();
    } else if (act === 'del-npc') {
      if (!confirm('Excluir este NPC do bestiário?')) return;
      var nextN = (V.library.npcs || []).filter(function (x) { return x.id !== id; });
      api('vtt/library', 'POST', { npcs: nextN }).then(function (res) {
        V.library.npcs = res.library.npcs;
        renderLibrary();
      });
    }
  });
  document.addEventListener('play:update', function () {
    if (mode === 'table' && !V.dragging && document.getElementById('vtt-stage')) updateStageOnly();
  });
})();
