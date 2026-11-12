(function () {
  let activeTab = 'sheet'; // 'sheet' | 'admin' | 'table' | 'library'
  let vttData = null;
  let pollTimer = null;
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let isPanning = false;
  let panStart = { x: 0, y: 0 };

  let tool = 'move'; // 'move' | 'reveal' | 'cover' | 'ruler'
  let brushSize = 6;
  let isPainting = false;
  let pendingFogOps = [];

  let draggingToken = null;
  let dragOrigin = null;
  let dragLimitMeters = null;
  let movedThisTurn = 0;

  let rulerOrigin = null;
  let editingMapId = null;
  let editingNpcId = null;

  const getKey = () => sessionStorage.getItem('fk') || '';

  function vttApi(path, method = 'GET', body) {
    return fetch('/api/vtt/' + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-key': getKey()
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(async r => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Erro na mesa virtual');
      return j;
    });
  }

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('on'), 2800);
  }

  function parseSpeedMeters(speedStr) {
    const num = parseFloat(String(speedStr || '9').replace(',', '.'));
    return Number.isFinite(num) && num > 0 ? num : 9;
  }

  // Compressão automática de imagens (Mapas e Tokens) para salvar leve no Cloudflare KV
  function pickAndCompressImage(options = {}) {
    const { square = false, maxSize = 1400, quality = 0.78 } = options;
    return new Promise(resolve => {
      const input = document.getElementById('vtt-file-pick');
      if (!input) return resolve('');
      input.onchange = () => {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return resolve('');
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (square) {
              canvas.width = maxSize;
              canvas.height = maxSize;
              const side = Math.min(img.width, img.height);
              const sx = (img.width - side) / 2;
              const sy = (img.height - side) / 2;
              ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
            } else {
              const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
              canvas.width = Math.round(img.width * ratio);
              canvas.height = Math.round(img.height * ratio);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            }
            resolve(canvas.toDataURL('image/jpeg', quality));
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  // --- INTEGRAÇÃO AUTOMÁTICA COM A BARRA DE NAVEGAÇÃO (#nv) ---
  function injectVttNavButtons() {
    const nv = document.getElementById('nv');
    if (!nv || nv.hidden || !nv.children.length) return;
    if (nv.querySelector('[data-vtt-tab="table"]')) {
      syncNavHighlight();
      return;
    }

    const isMaster = !!nv.querySelector('[data-nav="admin"]');
    const logoutBtn = nv.querySelector('[data-nav="logout"]');

    const btnTable = document.createElement('button');
    btnTable.className = 'bt';
    btnTable.dataset.vttTab = 'table';
    btnTable.textContent = '🗺️ Mesa (Mapa)';
    btnTable.onclick = () => openVttTab('table');

    nv.insertBefore(btnTable, logoutBtn || null);

    if (isMaster) {
      const btnLib = document.createElement('button');
      btnLib.className = 'bt';
      btnLib.dataset.vttTab = 'library';
      btnLib.textContent = '📚 Mapas & NPCs';
      btnLib.onclick = () => openVttTab('library');
      nv.insertBefore(btnLib, logoutBtn || null);
    }

    // Quando clicar nas abas nativas (Fichas / Gerenciar Jogadores), sai do modo VTT
    nv.querySelectorAll('[data-nav]').forEach(btn => {
      if (btn.dataset.vttHooked) return;
      btn.dataset.vttHooked = '1';
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.nav;
        stopPolling();
        const wrap = document.getElementById('app');
        if (wrap) wrap.classList.remove('vtt-wide');
        syncNavHighlight();
      });
    });

    syncNavHighlight();
  }

  function syncNavHighlight() {
    const nv = document.getElementById('nv');
    if (!nv) return;
    const isVtt = activeTab === 'table' || activeTab === 'library';
    if (isVtt) {
      nv.querySelectorAll('[data-nav]').forEach(b => b.classList.remove('on'));
    }
    nv.querySelectorAll('[data-vtt-tab]').forEach(b => {
      b.classList.toggle('on', b.dataset.vttTab === activeTab);
    });
  }

  function openVttTab(tab) {
    activeTab = tab;
    syncNavHighlight();
    const wrap = document.getElementById('app');
    if (wrap) wrap.classList.add('vtt-wide');
    refreshVttState(true);
    startPolling();
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (activeTab !== 'table') return;
      if (draggingToken || isPainting || isPanning) return;
      const focused = document.activeElement;
      if (focused && ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName)) return;
      refreshVttState(false);
    }, 3500);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function refreshVttState(forceRender = false) {
    vttApi('state')
      .then(data => {
        vttData = data;
        if (activeTab === 'table') {
          if (forceRender || !document.getElementById('vtt-stage')) {
            renderTableView();
          } else {
            updateLiveBoard();
          }
        } else if (activeTab === 'library') {
          renderLibraryView();
        }
      })
      .catch(err => showToast(err.message));
  }

  // =========================================================================
  // ABA 1: MESA VIRTUAL (TABLETOP)
  // =========================================================================
  function renderTableView() {
    const app = document.getElementById('app');
    if (!app || !vttData) return;

    const { isMaster, map, roster, library } = vttData;
    const savedMaps = (library && library.maps) || [];
    const savedNpcs = (library && library.npcs) || [];

    const myRoster = roster.find(r => r.id === vttData.me.id);
    const maxMove = myRoster ? parseSpeedMeters(myRoster.speed) : 9;
    const remMove = Math.max(0, maxMove - movedThisTurn);

    app.innerHTML = `
      <div class="vtt-workbench">
        <!-- COLUNA PRINCIPAL: MAPA -->
        <section class="vtt-board-card">
          <div class="vtt-toolbar">
            <div class="vtt-tool-group">
              <span class="vtt-scene-title">🗺️ ${esc(map.name || 'Mesa')}</span>
              ${isMaster ? `
                <select class="vtt-select" id="vtt-quick-map" title="Trocar Cena Rápida">
                  <option value="">-- Trocar Mapa Salvo --</option>
                  ${savedMaps.map(m => `<option value="${esc(m.id)}" ${m.id === map.mapId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
                </select>
              ` : ''}
            </div>

            <div class="vtt-tool-group">
              <button class="vtt-btn ${tool === 'move' ? 'active' : ''}" data-tool="move">✋ Mover</button>
              <button class="vtt-btn ${tool === 'ruler' ? 'active' : ''}" data-tool="ruler">📏 Régua</button>
              ${isMaster ? `
                <button class="vtt-btn ${tool === 'reveal' ? 'active' : ''}" data-tool="reveal">👁️ Revelar</button>
                <button class="vtt-btn ${tool === 'cover' ? 'active' : ''}" data-tool="cover">🌑 Cobrir</button>
                <select class="vtt-select" id="vtt-brush-size" title="Tamanho do Pincel">
                  <option value="3" ${brushSize === 3 ? 'selected' : ''}>Pincel P</option>
                  <option value="6" ${brushSize === 6 ? 'selected' : ''}>Pincel M</option>
                  <option value="12" ${brushSize === 12 ? 'selected' : ''}>Pincel G</option>
                </select>
                <button class="vtt-btn" id="vtt-fog-cover-all" title="Cobrir todo o mapa com névoa">Cobrir Tudo</button>
                <button class="vtt-btn" id="vtt-fog-reveal-all" title="Remover névoa">Revelar Tudo</button>
              ` : `
                <span class="vtt-btn" style="cursor:default;">Passo: <strong>${remMove.toFixed(1)}m</strong> / ${maxMove.toFixed(1)}m</span>
                <button class="vtt-btn gold" id="vtt-reset-turn">↻ Novo Turno</button>
              `}
              <button class="vtt-btn" id="vtt-zoom-out" title="Diminuir Zoom">−</button>
              <button class="vtt-btn" id="vtt-zoom-reset" title="Resetar Câmera">100%</button>
              <button class="vtt-btn" id="vtt-zoom-in" title="Aumentar Zoom">+</button>
            </div>
          </div>

          <div class="vtt-viewport" id="vtt-viewport">
            <div class="vtt-pan-layer" id="vtt-pan-layer" style="transform: translate(${pan.x}px, ${pan.y}px) scale(${zoom});">
              <div class="vtt-stage" id="vtt-stage">
                ${map.bg
                  ? `<img id="vtt-bg-img" src="${esc(map.bg)}" alt="Mapa">`
                  : `<div class="vtt-empty-map">
                      <strong>Nenhum mapa carregado na mesa</strong>
                      <span>${isMaster ? 'Vá na aba "📚 Mapas & NPCs" para cadastrar mapas ou cole uma imagem abaixo.' : 'Aguarde o Mestre ativar o mapa da cena.'}</span>
                    </div>`
                }
                <div class="vtt-grid-layer" id="vtt-grid"></div>
                <div class="vtt-tokens-layer" id="vtt-tokens"></div>
                <canvas id="vtt-fog-canvas" class="${isMaster && (tool === 'reveal' || tool === 'cover') ? 'painting' : ''}"></canvas>
                <svg class="vtt-ruler-layer" id="vtt-ruler"></svg>
                <div class="vtt-brush-cursor" id="vtt-brush"></div>
              </div>
            </div>
          </div>
        </section>

        <!-- BARRA LATERAL: ELENCO NA MESA (PÔR / TIRAR PLAYERS E NPCS) -->
        <aside class="vtt-sidebar">
          <!-- JOGADORES -->
          <div class="vtt-side-box">
            <h3 class="vtt-side-title">
              <span>🗡️ Jogadores na Mesa</span>
              <span>${roster.filter(r => map.tokens.some(t => t.kind === 'player' && t.owner === r.id)).length}/${roster.length}</span>
            </h3>

            <div class="vtt-roster-list">
              ${roster.length ? roster.map(p => {
                const onBoard = map.tokens.some(t => t.kind === 'player' && t.owner === p.id);
                return `
                  <div class="vtt-roster-item">
                    <div class="vtt-roster-info">
                      <div class="vtt-mini-avatar">
                        ${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : esc((p.charName || '?').slice(0, 2).toUpperCase())}
                      </div>
                      <div class="vtt-roster-meta">
                        <span class="vtt-roster-name">${esc(p.charName)}</span>
                        <span class="vtt-roster-sub">HP ${p.hp}/${p.mhp} · ${esc(p.speed)}</span>
                      </div>
                    </div>

                    ${isMaster ? `
                      <button class="vtt-toggle-seat ${onBoard ? 'in' : 'out'}" data-seat-player="${esc(p.id)}" data-on-board="${onBoard ? '1' : '0'}">
                        ${onBoard ? '− Tirar' : '+ Pôr'}
                      </button>
                    ` : `
                      <span class="vtt-roster-sub">${onBoard ? '🟢 Na Mesa' : '⚪ Fora'}</span>
                    `}
                  </div>
                `;
              }).join('') : `<p style="font-size:0.82rem; margin:0;">Nenhum jogador cadastrado.</p>`}
            </div>
          </div>

          <!-- INVOCAR NPCS & TOKENS ATIVOS (MESTRE) -->
          ${isMaster ? `
            <div class="vtt-side-box">
              <h3 class="vtt-side-title">
                <span>👹 Invocar NPC / Inimigo</span>
                <button class="vtt-btn" id="vtt-goto-lib" style="padding:2px 7px; font-size:0.7rem;">+ Criar</button>
              </h3>

              ${savedNpcs.length ? `
                <div style="display:flex; gap:6px; margin-bottom:10px;">
                  <select class="vtt-field" id="vtt-npc-select">
                    ${savedNpcs.map(n => `<option value="${esc(n.id)}">${esc(n.name)} (HP ${n.hp} · CA ${n.ac})</option>`).join('')}
                  </select>
                  <button class="vtt-btn gold" id="vtt-spawn-npc-btn">Invocar</button>
                </div>
              ` : `<p style="font-size:0.8rem; margin:0 0 8px 0;">Cadastre NPCs na aba <strong>Mapas &amp; NPCs</strong> para invocá-los aqui.</p>`}

              <div class="vtt-side-title" style="margin-top:8px;">
                <span>Tokens Ativos (${map.tokens.length})</span>
                ${map.tokens.some(t => t.kind === 'npc') ? `<button class="vtt-btn danger" id="vtt-clear-npcs" style="padding:2px 6px; font-size:0.68rem;">Limpar NPCs</button>` : ''}
              </div>

              <div class="vtt-roster-list" style="max-height:260px; overflow-y:auto;">
                ${map.tokens.length ? map.tokens.map(tok => `
                  <div class="vtt-roster-item">
                    <div class="vtt-roster-info">
                      <div class="vtt-mini-avatar" style="border-color:${esc(tok.color || '#c89d54')};">
                        ${tok.avatar ? `<img src="${esc(tok.avatar)}" alt="">` : esc((tok.name || '?').slice(0, 2).toUpperCase())}
                      </div>
                      <div class="vtt-roster-meta">
                        <span class="vtt-roster-name">${esc(tok.name)}</span>
                        <span class="vtt-roster-sub">${tok.kind === 'player' ? 'Jogador' : `HP ${tok.hp}/${tok.mhp}`}</span>
                      </div>
                    </div>
                    <div style="display:flex; gap:4px;">
                      <button class="vtt-btn" data-edit-tok-img="${esc(tok.id)}" title="Trocar imagem do token" style="padding:4px 6px;">🖼️</button>
                      <button class="vtt-btn danger" data-remove-tok="${esc(tok.id)}" title="Tirar da mesa" style="padding:4px 7px;">×</button>
                    </div>
                  </div>
                `).join('') : `<p style="font-size:0.8rem; margin:0;">Nenhum token no mapa.</p>`}
              </div>
            </div>
          ` : ''}
        </aside>
      </div>
    `;

    const bgImg = document.getElementById('vtt-bg-img');
    if (bgImg) {
      bgImg.onload = () => updateLiveBoard();
    }
    updateLiveBoard();
    bindTableEvents();
  }

  function updateLiveBoard() {
    if (!vttData) return;
    const stage = document.getElementById('vtt-stage');
    const gridEl = document.getElementById('vtt-grid');
    const tokensEl = document.getElementById('vtt-tokens');
    const fogCanvas = document.getElementById('vtt-fog-canvas');
    if (!stage || !gridEl || !tokensEl || !fogCanvas) return;

    const { isMaster, map, me } = vttData;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;

    // 1. Grid
    if (map.grid > 0) {
      const cellPx = w / map.grid;
      gridEl.style.backgroundImage = `
        linear-gradient(rgba(255, 240, 210, 0.16) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 240, 210, 0.16) 1px, transparent 1px)
      `;
      gridEl.style.backgroundSize = `${cellPx}px ${cellPx}px`;
    } else {
      gridEl.style.backgroundImage = 'none';
    }

    // 2. Tokens
    const baseCellPx = map.grid > 0 ? w / map.grid : Math.max(36, w / 22);
    tokensEl.innerHTML = (map.tokens || []).map(tok => {
      const canMove = isMaster || tok.owner === me.id;
      const isMine = tok.owner === me.id;
      const sizePx = Math.max(30, baseCellPx * (tok.size || 1) * 0.88);
      const hpPct = tok.mhp > 0 ? Math.max(0, Math.min(100, (tok.hp / tok.mhp) * 100)) : 100;

      return `
        <div class="vtt-token ${canMove ? 'movable' : ''} ${isMine ? 'mine' : ''}"
             data-token-id="${esc(tok.id)}"
             style="left:${tok.x}%; top:${tok.y}%; width:${sizePx}px; height:${sizePx}px; border-color:${esc(tok.color || '#c89d54')};">
          ${tok.avatar
            ? `<img src="${esc(tok.avatar)}" alt="${esc(tok.name)}">`
            : `<span class="vtt-token-initials">${esc((tok.name || '?').slice(0, 2).toUpperCase())}</span>`
          }
          ${tok.mhp > 0 ? `<span class="vtt-token-hp"><i style="width:${hpPct}%;"></i></span>` : ''}
          <span class="vtt-token-tag">${esc(tok.name)}</span>
        </div>
      `;
    }).join('');

    // 3. Névoa de Guerra
    fogCanvas.width = w;
    fogCanvas.height = h;
    fogCanvas.classList.toggle('painting', isMaster && (tool === 'reveal' || tool === 'cover'));
    const fogOn = Boolean(map.fog && map.fog.on);
    fogCanvas.style.display = fogOn ? 'block' : 'none';
    fogCanvas.style.opacity = isMaster ? '0.52' : '1';

    if (fogOn) {
      const ctx = fogCanvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#070505';
      ctx.fillRect(0, 0, w, h);

      (map.fog.ops || []).forEach(([xPct, yPct, rPct, rev]) => {
        ctx.globalCompositeOperation = rev ? 'destination-out' : 'source-over';
        ctx.beginPath();
        ctx.arc((xPct / 100) * w, (yPct / 100) * h, (rPct / 100) * w, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  function clientToStagePercent(clientX, clientY) {
    const stage = document.getElementById('vtt-stage');
    const rect = stage.getBoundingClientRect();
    return {
      x: Math.max(1, Math.min(99, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(1, Math.min(99, ((clientY - rect.top) / rect.height) * 100))
    };
  }

  function calcMeters(p1, p2) {
    const stage = document.getElementById('vtt-stage');
    const map = vttData.map;
    if (!stage || !map.grid) return 0;
    const ratio = stage.clientHeight / stage.clientWidth;
    const dx = ((p2.x - p1.x) / 100) * map.grid;
    const dy = ((p2.y - p1.y) / 100) * map.grid * ratio;
    return Math.hypot(dx, dy) * (map.cellMeters || 1.5);
  }

  function drawRuler(origin, target, limitMeters) {
    const stage = document.getElementById('vtt-stage');
    const ruler = document.getElementById('vtt-ruler');
    if (!stage || !ruler) return;

    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const x1 = (origin.x / 100) * w;
    const y1 = (origin.y / 100) * h;
    const x2 = (target.x / 100) * w;
    const y2 = (target.y / 100) * h;
    const dist = calcMeters(origin, target);

    let circle = '';
    if (limitMeters !== null && vttData.map.grid > 0) {
      const rPx = (limitMeters / (vttData.map.cellMeters || 1.5)) * (w / vttData.map.grid);
      circle = `<circle cx="${x1}" cy="${y1}" r="${rPx}" fill="rgba(232,194,118,0.1)" stroke="#e8c276" stroke-width="2" stroke-dasharray="6 4"/>`;
    }

    const label = limitMeters !== null ? `${dist.toFixed(1)}m / ${limitMeters.toFixed(1)}m` : `${dist.toFixed(1)}m`;
    ruler.setAttribute('width', w);
    ruler.setAttribute('height', h);
    ruler.innerHTML = `
      ${circle}
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#f2cf7e" stroke-width="3"/>
      <text x="${x2 + 12}" y="${y2 - 12}" fill="#fff3d6" font-size="13" font-weight="bold" stroke="#000" stroke-width="3" paint-order="stroke">${label}</text>
    `;
  }

  function clearRuler() {
    const ruler = document.getElementById('vtt-ruler');
    if (ruler) ruler.innerHTML = '';
  }

  function bindTableEvents() {
    const app = document.getElementById('app');
    const viewport = document.getElementById('vtt-viewport');
    const panLayer = document.getElementById('vtt-pan-layer');
    const tokensLayer = document.getElementById('vtt-tokens');
    const fogCanvas = document.getElementById('vtt-fog-canvas');
    const brushEl = document.getElementById('vtt-brush');

    // Ferramentas
    app.querySelectorAll('[data-tool]').forEach(btn => {
      btn.onclick = () => {
        tool = btn.dataset.tool;
        renderTableView();
      };
    });

    const brushSel = document.getElementById('vtt-brush-size');
    if (brushSel) {
      brushSel.onchange = () => { brushSize = Number(brushSel.value) || 6; };
    }

    // Troca rápida de mapa
    const quickMap = document.getElementById('vtt-quick-map');
    if (quickMap) {
      quickMap.onchange = () => {
        const chosen = (vttData.library?.maps || []).find(m => m.id === quickMap.value);
        if (!chosen) return;
        vttApi('table', 'POST', { op: 'activate_map', map: chosen, keepTokens: true })
          .then(() => {
            showToast(`Mapa "${chosen.name}" ativado!`);
            refreshVttState(true);
          })
          .catch(err => showToast(err.message));
      };
    }

    // Controles de Névoa
    const btnCoverAll = document.getElementById('vtt-fog-cover-all');
    if (btnCoverAll) {
      btnCoverAll.onclick = () => {
        vttApi('fog', 'POST', { op: 'cover_all' }).then(() => refreshVttState(true));
      };
    }

    const btnRevealAll = document.getElementById('vtt-fog-reveal-all');
    if (btnRevealAll) {
      btnRevealAll.onclick = () => {
        vttApi('fog', 'POST', { op: 'reveal_all' }).then(() => refreshVttState(true));
      };
    }

    // Resetar turno (Jogador)
    const btnResetTurn = document.getElementById('vtt-reset-turn');
    if (btnResetTurn) {
      btnResetTurn.onclick = () => {
        movedThisTurn = 0;
        renderTableView();
        showToast('Deslocamento restaurado para o novo turno!');
      };
    }

    // Zoom & Câmera
    const applyCamera = () => {
      if (panLayer) panLayer.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    };
    const zIn = document.getElementById('vtt-zoom-in');
    const zOut = document.getElementById('vtt-zoom-out');
    const zReset = document.getElementById('vtt-zoom-reset');
    if (zIn) zIn.onclick = () => { zoom = Math.min(2.6, zoom + 0.2); applyCamera(); };
    if (zOut) zOut.onclick = () => { zoom = Math.max(0.5, zoom - 0.2); applyCamera(); };
    if (zReset) zReset.onclick = () => { zoom = 1; pan = { x: 0, y: 0 }; applyCamera(); };

    // Pôr / Tirar Jogador da Mesa (1 clique)
    app.querySelectorAll('[data-seat-player]').forEach(btn => {
      btn.onclick = () => {
        const playerId = btn.dataset.seatPlayer;
        const isOn = btn.dataset.onBoard === '1';
        vttApi('table', 'POST', { op: isOn ? 'remove_player' : 'put_player', playerId })
          .then(() => {
            showToast(isOn ? 'Jogador retirado da mesa.' : 'Jogador colocado na mesa!');
            refreshVttState(true);
          })
          .catch(err => showToast(err.message));
      };
    });

    // Invocar NPC na Mesa
    const btnSpawnNpc = document.getElementById('vtt-spawn-npc-btn');
    if (btnSpawnNpc) {
      btnSpawnNpc.onclick = () => {
        const sel = document.getElementById('vtt-npc-select');
        const npc = (vttData.library?.npcs || []).find(n => n.id === sel.value);
        if (!npc) return;
        vttApi('table', 'POST', { op: 'spawn_npc', npc })
          .then(() => {
            showToast(`${npc.name} invocado na mesa!`);
            refreshVttState(true);
          })
          .catch(err => showToast(err.message));
      };
    }

    // Ir para aba Mapas & NPCs
    const btnGotoLib = document.getElementById('vtt-goto-lib');
    if (btnGotoLib) btnGotoLib.onclick = () => openVttTab('library');

    // Remover Token individual
    app.querySelectorAll('[data-remove-tok]').forEach(btn => {
      btn.onclick = () => {
        vttApi('table', 'POST', { op: 'remove_token', id: btn.dataset.removeTok })
          .then(() => refreshVttState(true))
          .catch(err => showToast(err.message));
      };
    });

    // Personalizar foto de um Token ativo na mesa
    app.querySelectorAll('[data-edit-tok-img]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.editTokImg;
        const dataUrl = await pickAndCompressImage({ square: true, maxSize: 200, quality: 0.82 });
        if (!dataUrl) return;
        vttApi('table', 'POST', { op: 'update_token', id, avatar: dataUrl })
          .then(() => {
            showToast('Imagem do token atualizada!');
            refreshVttState(true);
          })
          .catch(err => showToast(err.message));
      };
    });

    // Limpar NPCs
    const btnClearNpcs = document.getElementById('vtt-clear-npcs');
    if (btnClearNpcs) {
      btnClearNpcs.onclick = () => {
        vttApi('table', 'POST', { op: 'clear_npcs' })
          .then(() => {
            showToast('NPCs removidos da mesa.');
            refreshVttState(true);
          });
      };
    }

    // Arrastar Tokens
    if (tokensLayer) {
      tokensLayer.onpointerdown = e => {
        if (tool !== 'move') return;
        const tokEl = e.target.closest('.vtt-token.movable');
        if (!tokEl) return;
        e.stopPropagation();

        const tokId = tokEl.dataset.tokenId;
        const tokData = vttData.map.tokens.find(t => t.id === tokId);
        if (!tokData) return;

        draggingToken = tokEl;
        dragOrigin = { x: tokData.x, y: tokData.y };

        if (!vttData.isMaster) {
          const myR = vttData.roster.find(r => r.id === vttData.me.id);
          const maxM = myR ? parseSpeedMeters(myR.speed) : 9;
          dragLimitMeters = Math.max(0, maxM - movedThisTurn);
        } else {
          dragLimitMeters = null;
        }
        tokEl.setPointerCapture(e.pointerId);
      };
    }

    // Pintar Névoa
    if (fogCanvas) {
      fogCanvas.onpointerdown = e => {
        if (!vttData.isMaster || (tool !== 'reveal' && tool !== 'cover')) return;
        e.stopPropagation();
        isPainting = true;
        pendingFogOps = [];
        paintFogStep(e);
      };

      fogCanvas.onpointermove = e => {
        if (vttData.isMaster && (tool === 'reveal' || tool === 'cover') && brushEl) {
          const stage = document.getElementById('vtt-stage');
          const rect = stage.getBoundingClientRect();
          const pxSize = ((brushSize * 2) / 100) * stage.clientWidth;
          brushEl.style.display = 'block';
          brushEl.style.width = `${pxSize}px`;
          brushEl.style.height = `${pxSize}px`;
          brushEl.style.left = `${(e.clientX - rect.left) / zoom}px`;
          brushEl.style.top = `${(e.clientY - rect.top) / zoom}px`;
        }
        if (isPainting) paintFogStep(e);
      };

      fogCanvas.onpointerleave = () => {
        if (brushEl) brushEl.style.display = 'none';
      };
    }

    // Pan & Régua Livre no Viewport
    if (viewport) {
      viewport.onpointerdown = e => {
        if (draggingToken || isPainting) return;
        if (tool === 'ruler') {
          rulerOrigin = clientToStagePercent(e.clientX, e.clientY);
          return;
        }
        isPanning = true;
        panStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      };
    }

    window.onpointermove = e => {
      if (draggingToken) {
        const pos = clientToStagePercent(e.clientX, e.clientY);
        const target = { ...pos };
        if (dragLimitMeters !== null) {
          const d = calcMeters(dragOrigin, target);
          if (d > dragLimitMeters && d > 0) {
            const ratio = dragLimitMeters / d;
            target.x = dragOrigin.x + (target.x - dragOrigin.x) * ratio;
            target.y = dragOrigin.y + (target.y - dragOrigin.y) * ratio;
          }
        }
        draggingToken.style.left = `${target.x}%`;
        draggingToken.style.top = `${target.y}%`;
        drawRuler(dragOrigin, target, dragLimitMeters);
        return;
      }

      if (rulerOrigin) {
        const pos = clientToStagePercent(e.clientX, e.clientY);
        drawRuler(rulerOrigin, pos, null);
        return;
      }

      if (isPanning) {
        pan.x = e.clientX - panStart.x;
        pan.y = e.clientY - panStart.y;
        applyCamera();
      }
    };

    window.onpointerup = () => {
      if (draggingToken) {
        const id = draggingToken.dataset.tokenId;
        const x = parseFloat(draggingToken.style.left);
        const y = parseFloat(draggingToken.style.top);
        const dist = calcMeters(dragOrigin, { x, y });

        if (!vttData.isMaster) {
          movedThisTurn += dist;
        }

        const tokObj = vttData.map.tokens.find(t => t.id === id);
        if (tokObj) {
          tokObj.x = x;
          tokObj.y = y;
        }

        draggingToken = null;
        clearRuler();

        vttApi('move', 'POST', { id, x, y })
          .then(() => { if (!vttData.isMaster) renderTableView(); })
          .catch(err => showToast(err.message));
      }

      if (isPainting) {
        isPainting = false;
        if (pendingFogOps.length) {
          const batch = pendingFogOps.slice();
          pendingFogOps = [];
          vttApi('fog', 'POST', { ops: batch }).catch(() => {});
        }
      }

      if (rulerOrigin) {
        rulerOrigin = null;
        clearRuler();
      }

      isPanning = false;
    };
  }

  function paintFogStep(e) {
    const pos = clientToStagePercent(e.clientX, e.clientY);
    const rev = tool === 'reveal' ? 1 : 0;
    const op = [Number(pos.x.toFixed(2)), Number(pos.y.toFixed(2)), brushSize, rev];
    vttData.map.fog = vttData.map.fog || { on: true, ops: [] };
    vttData.map.fog.on = true;
    vttData.map.fog.ops.push(op);
    pendingFogOps.push(op);
    updateLiveBoard();
  }

  // =========================================================================
  // ABA 2: BIBLIOTECA DE MAPAS & NPCS (ARMAZENAMENTO COM IMAGENS PERSONALIZÁVEIS)
  // =========================================================================
  function renderLibraryView() {
    const app = document.getElementById('app');
    if (!app || !vttData || !vttData.isMaster) return;

    const maps = vttData.library?.maps || [];
    const npcs = vttData.library?.npcs || [];
    const editM = maps.find(m => m.id === editingMapId) || { name: '', bg: '', grid: 24, cellMeters: 1.5, fogOn: false };
    const editN = npcs.find(n => n.id === editingNpcId) || { name: '', avatar: '', color: '#9e1b1b', size: 1, hp: 20, ac: 12 };

    app.innerHTML = `
      <div class="vtt-lib-grid">
        <!-- COLUNA 1: BIBLIOTECA DE MAPAS -->
        <section class="vtt-lib-panel">
          <h2>🗺️ Biblioteca de Mapas (${maps.length})</h2>

          <form class="vtt-form-box" id="vtt-form-map">
            <div>
              <label class="vtt-form-label">Nome do Mapa / Cena</label>
              <input class="vtt-field" id="lib-map-name" value="${esc(editM.name)}" placeholder="Ex: Saloon Abandonado" required>
            </div>

            <div>
              <label class="vtt-form-label">Imagem do Mapa (Upload ou Link URL)</label>
              <div class="vtt-img-picker-row">
                <input class="vtt-field" id="lib-map-bg" value="${esc(editM.bg)}" placeholder="Cole URL ou clique em Enviar Imagem">
                <button type="button" class="vtt-btn gold" id="lib-map-upload" style="white-space:nowrap;">📁 Enviar</button>
              </div>
            </div>

            <div class="vtt-form-row">
              <div>
                <label class="vtt-form-label">Colunas da Grade (0 = sem)</label>
                <input class="vtt-field" type="number" min="0" max="80" id="lib-map-grid" value="${Number(editM.grid ?? 24)}">
              </div>
              <div>
                <label class="vtt-form-label">Metros por Quadrado</label>
                <input class="vtt-field" type="number" step="0.5" min="0.5" id="lib-map-scale" value="${Number(editM.cellMeters || 1.5)}">
              </div>
            </div>

            <label style="display:flex; align-items:center; gap:8px; font-family:'Special Elite',monospace; font-size:0.8rem;">
              <input type="checkbox" id="lib-map-fog" ${editM.fogOn ? 'checked' : ''}> Iniciar com Névoa de Guerra ativada
            </label>

            <div style="display:flex; gap:8px;">
              <button type="submit" class="vtt-btn gold" style="flex:1;">${editingMapId ? '💾 Atualizar Mapa' : '+ Salvar Mapa'}</button>
              ${editingMapId ? `<button type="button" class="vtt-btn" id="lib-map-cancel">Cancelar</button>` : ''}
            </div>
          </form>

          <div class="vtt-cards-list">
            ${maps.length ? maps.map(m => `
              <div class="vtt-saved-card">
                <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                  ${m.bg
                    ? `<img class="vtt-map-thumb" src="${esc(m.bg)}" alt="">`
                    : `<div class="vtt-map-thumb" style="display:flex;align-items:center;justify-content:center;color:#d6be96;font-size:0.75rem;">Sem img</div>`
                  }
                  <div style="min-width:0;">
                    <strong style="display:block; font-family:'IM Fell DW Pica',serif; font-size:1.05rem;">${esc(m.name)}</strong>
                    <span style="font-family:'Special Elite',monospace; font-size:0.74rem; color:#5a422b;">
                      Grade: ${m.grid || 'Off'} · ${m.cellMeters || 1.5}m ${m.fogOn ? '· 🌑 Névoa' : ''}
                    </span>
                  </div>
                </div>

                <div style="display:flex; gap:5px; flex-wrap:wrap; justify-content:flex-end;">
                  <button class="vtt-btn gold" data-activate-map="${esc(m.id)}">▶ Usar na Mesa</button>
                  <button class="vtt-btn" data-edit-map="${esc(m.id)}">✏️</button>
                  <button class="vtt-btn danger" data-del-map="${esc(m.id)}">🗑️</button>
                </div>
              </div>
            `).join('') : `<p style="font-size:0.86rem; margin:0;">Nenhum mapa salvo ainda.</p>`}
          </div>
        </section>

        <!-- COLUNA 2: BIBLIOTECA DE NPCS & INIMIGOS -->
        <section class="vtt-lib-panel">
          <h2>👹 Biblioteca de NPCs &amp; Inimigos (${npcs.length})</h2>

          <form class="vtt-form-box" id="vtt-form-npc">
            <div class="vtt-form-row">
              <div>
                <label class="vtt-form-label">Nome do NPC / Criatura</label>
                <input class="vtt-field" id="lib-npc-name" value="${esc(editN.name)}" placeholder="Ex: Pistoleiro Renegado" required>
              </div>
              <div>
                <label class="vtt-form-label">Tamanho &amp; Cor do Anel</label>
                <div style="display:flex; gap:6px;">
                  <select class="vtt-field" id="lib-npc-size">
                    <option value="1" ${Number(editN.size) === 1 ? 'selected' : ''}>1x1 (Médio)</option>
                    <option value="2" ${Number(editN.size) === 2 ? 'selected' : ''}>2x2 (Grande)</option>
                    <option value="3" ${Number(editN.size) === 3 ? 'selected' : ''}>3x3 (Enorme)</option>
                  </select>
                  <input type="color" id="lib-npc-color" value="${esc(editN.color || '#9e1b1b')}" style="width:42px; height:34px; border:1px solid #6b5033; background:none; cursor:pointer;">
                </div>
              </div>
            </div>

            <div>
              <label class="vtt-form-label">Foto / Token do NPC (Upload ou Link URL)</label>
              <div class="vtt-img-picker-row">
                <input class="vtt-field" id="lib-npc-avatar" value="${esc(editN.avatar)}" placeholder="Cole URL ou clique em Enviar Foto">
                <button type="button" class="vtt-btn gold" id="lib-npc-upload" style="white-space:nowrap;">📁 Enviar</button>
              </div>
            </div>

            <div class="vtt-form-row">
              <div>
                <label class="vtt-form-label">Pontos de Vida (HP)</label>
                <input class="vtt-field" type="number" min="1" id="lib-npc-hp" value="${Number(editN.hp || 20)}">
              </div>
              <div>
                <label class="vtt-form-label">Defesa (CA)</label>
                <input class="vtt-field" type="number" min="1" id="lib-npc-ac" value="${Number(editN.ac || 12)}">
              </div>
            </div>

            <div style="display:flex; gap:8px;">
              <button type="submit" class="vtt-btn gold" style="flex:1;">${editingNpcId ? '💾 Atualizar NPC' : '+ Salvar NPC'}</button>
              ${editingNpcId ? `<button type="button" class="vtt-btn" id="lib-npc-cancel">Cancelar</button>` : ''}
            </div>
          </form>

          <div class="vtt-cards-list">
            ${npcs.length ? npcs.map(n => `
              <div class="vtt-saved-card">
                <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                  ${n.avatar
                    ? `<img class="vtt-npc-thumb" src="${esc(n.avatar)}" style="border-color:${esc(n.color || '#9e1b1b')};" alt="">`
                    : `<div class="vtt-npc-thumb" style="border-color:${esc(n.color || '#9e1b1b')}; display:flex; align-items:center; justify-content:center; color:#f4e4c8; font-family:'IM Fell English SC',serif;">${esc((n.name || '?').slice(0, 2).toUpperCase())}</div>`
                  }
                  <div style="min-width:0;">
                    <strong style="display:block; font-family:'IM Fell DW Pica',serif; font-size:1.05rem;">${esc(n.name)}</strong>
                    <span style="font-family:'Special Elite',monospace; font-size:0.74rem; color:#5a422b;">
                      HP: ${n.hp} · CA: ${n.ac} · ${n.size || 1}x${n.size || 1}
                    </span>
                  </div>
                </div>

                <div style="display:flex; gap:5px; flex-wrap:wrap; justify-content:flex-end;">
                  <button class="vtt-btn gold" data-spawn-lib-npc="${esc(n.id)}">+ Mesa</button>
                  <button class="vtt-btn" data-edit-npc="${esc(n.id)}">✏️</button>
                  <button class="vtt-btn danger" data-del-npc="${esc(n.id)}">🗑️</button>
                </div>
              </div>
            `).join('') : `<p style="font-size:0.86rem; margin:0;">Nenhum NPC salvo ainda.</p>`}
          </div>
        </section>
      </div>
    `;

    bindLibraryEvents();
  }

  function bindLibraryEvents() {
    const app = document.getElementById('app');

    // Upload de imagem do Mapa
    document.getElementById('lib-map-upload').onclick = async () => {
      const dataUrl = await pickAndCompressImage({ square: false, maxSize: 1400, quality: 0.78 });
      if (dataUrl) {
        document.getElementById('lib-map-bg').value = dataUrl;
        showToast('Imagem do mapa carregada!');
      }
    };

    // Upload de imagem do NPC
    document.getElementById('lib-npc-upload').onclick = async () => {
      const dataUrl = await pickAndCompressImage({ square: true, maxSize: 200, quality: 0.82 });
      if (dataUrl) {
        document.getElementById('lib-npc-avatar').value = dataUrl;
        showToast('Foto do NPC carregada!');
      }
    };

    const cancelMap = document.getElementById('lib-map-cancel');
    if (cancelMap) cancelMap.onclick = () => { editingMapId = null; renderLibraryView(); };

    const cancelNpc = document.getElementById('lib-npc-cancel');
    if (cancelNpc) cancelNpc.onclick = () => { editingNpcId = null; renderLibraryView(); };

    // Salvar Mapa
    document.getElementById('vtt-form-map').onsubmit = e => {
      e.preventDefault();
      const maps = (vttData.library?.maps || []).slice();
      const entry = {
        id: editingMapId || ('map_' + Date.now().toString(36)),
        name: document.getElementById('lib-map-name').value.trim(),
        bg: document.getElementById('lib-map-bg').value.trim(),
        grid: Math.max(0, Math.min(80, Number(document.getElementById('lib-map-grid').value) || 0)),
        cellMeters: Math.max(0.5, Number(document.getElementById('lib-map-scale').value) || 1.5),
        fogOn: document.getElementById('lib-map-fog').checked
      };
      const idx = maps.findIndex(m => m.id === entry.id);
      if (idx >= 0) maps[idx] = entry;
      else maps.push(entry);

      vttApi('library', 'POST', { maps })
        .then(res => {
          vttData.library = res.library;
          editingMapId = null;
          showToast('Mapa salvo na biblioteca!');
          renderLibraryView();
        })
        .catch(err => showToast(err.message));
    };

    // Salvar NPC
    document.getElementById('vtt-form-npc').onsubmit = e => {
      e.preventDefault();
      const npcs = (vttData.library?.npcs || []).slice();
      const hp = Math.max(1, Number(document.getElementById('lib-npc-hp').value) || 20);
      const entry = {
        id: editingNpcId || ('npc_' + Date.now().toString(36)),
        name: document.getElementById('lib-npc-name').value.trim(),
        avatar: document.getElementById('lib-npc-avatar').value.trim(),
        color: document.getElementById('lib-npc-color').value,
        size: Number(document.getElementById('lib-npc-size').value) || 1,
        hp,
        mhp: hp,
        ac: Math.max(1, Number(document.getElementById('lib-npc-ac').value) || 12)
      };
      const idx = npcs.findIndex(n => n.id === entry.id);
      if (idx >= 0) npcs[idx] = entry;
      else npcs.push(entry);

      vttApi('library', 'POST', { npcs })
        .then(res => {
          vttData.library = res.library;
          editingNpcId = null;
          showToast('NPC salvo na biblioteca!');
          renderLibraryView();
        })
        .catch(err => showToast(err.message));
    };

    // Ações nos cards de Mapas
    app.querySelectorAll('[data-activate-map]').forEach(btn => {
      btn.onclick = () => {
        const m = (vttData.library?.maps || []).find(x => x.id === btn.dataset.activateMap);
        if (!m) return;
        vttApi('table', 'POST', { op: 'activate_map', map: m, keepTokens: true })
          .then(() => {
            showToast(`Mapa "${m.name}" carregado na mesa!`);
            openVttTab('table');
          })
          .catch(err => showToast(err.message));
      };
    });

    app.querySelectorAll('[data-edit-map]').forEach(btn => {
      btn.onclick = () => {
        editingMapId = btn.dataset.editMap;
        renderLibraryView();
      };
    });

    app.querySelectorAll('[data-del-map]').forEach(btn => {
      btn.onclick = () => {
        if (!confirm('Apagar este mapa da biblioteca?')) return;
        const maps = (vttData.library?.maps || []).filter(m => m.id !== btn.dataset.delMap);
        vttApi('library', 'POST', { maps }).then(res => {
          vttData.library = res.library;
          renderLibraryView();
        });
      };
    });

    // Ações nos cards de NPCs
    app.querySelectorAll('[data-spawn-lib-npc]').forEach(btn => {
      btn.onclick = () => {
        const npc = (vttData.library?.npcs || []).find(x => x.id === btn.dataset.spawnLibNpc);
        if (!npc) return;
        vttApi('table', 'POST', { op: 'spawn_npc', npc })
          .then(() => showToast(`${npc.name} colocado na mesa!`))
          .catch(err => showToast(err.message));
      };
    });

    app.querySelectorAll('[data-edit-npc]').forEach(btn => {
      btn.onclick = () => {
        editingNpcId = btn.dataset.editNpc;
        renderLibraryView();
      };
    });

    app.querySelectorAll('[data-del-npc]').forEach(btn => {
      btn.onclick = () => {
        if (!confirm('Apagar este NPC da biblioteca?')) return;
        const npcs = (vttData.library?.npcs || []).filter(n => n.id !== btn.dataset.delNpc);
        vttApi('library', 'POST', { npcs }).then(res => {
          vttData.library = res.library;
          renderLibraryView();
        });
      };
    });
  }

  // Observa o menu superior para manter as abas de Mesa e Mapas & NPCs sempre presentes
  const navEl = document.getElementById('nv');
  if (navEl) {
    const obs = new MutationObserver(() => injectVttNavButtons());
    obs.observe(navEl, { childList: true, attributes: true, attributeFilter: ['hidden'] });
    injectVttNavButtons();
  }
})();
