// Sistema de Login e Ficha de Personagem (public/player-sheet.js)
(function () {
  let KEY = sessionStorage.getItem('fk') || '';
  let ME = null;
  let DATA = [];
  let selectedPlayerId = '';
  let currentView = 'sheet'; // 'sheet' | 'admin'
  let saveTimer = null;
  let hasPendingChanges = false;

  const ATTRS = [
    { key: 'FOR', name: 'Força' },
    { key: 'DES', name: 'Destreza' },
    { key: 'CON', name: 'Constituição' },
    { key: 'INT', name: 'Inteligência' },
    { key: 'SAB', name: 'Sabedoria' },
    { key: 'CAR', name: 'Carisma' }
  ];

  function api(path, method = 'GET', body) {
    return fetch('/api/' + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-key': KEY
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(async r => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Erro na comunicação com o servidor');
      return j;
    });
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('on'), 3000);
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

  function calcMod(score) {
    const val = Number(score) || 10;
    const mod = Math.floor((val - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
  }

  function createDefaultSheet(playerName = '') {
    return {
      name: playerName,
      title: '',
      level: 1,
      avatar: '',
      hp: 20,
      mhp: 20,
      tempHp: 0,
      st: 10,
      mst: 10,
      ac: 10,
      speed: '9m',
      attrs: { FOR: 10, DES: 10, CON: 10, INT: 10, SAB: 10, CAR: 10 },
      skills: [],
      inventory: [],
      notes: '',
      mnotes: '',
      lock: false
    };
  }

  function normalizeSheet(raw, fallbackName) {
    const base = createDefaultSheet(fallbackName);
    if (!raw || typeof raw !== 'object') return base;
    return {
      ...base,
      ...raw,
      attrs: { ...base.attrs, ...(raw.attrs || {}) },
      skills: Array.isArray(raw.skills) ? raw.skills : [],
      inventory: Array.isArray(raw.inventory) ? raw.inventory : []
    };
  }

  // --- INICIALIZAÇÃO & LOGIN ---
  function boot() {
    if (!KEY) {
      renderLogin();
      return;
    }

    api('me')
      .then(user => {
        ME = user;
        loadAllSheets();
      })
      .catch(() => {
        ME = null;
        sessionStorage.removeItem('fk');
        KEY = '';
        renderLogin('Código inválido ou sessão expirada.');
      });
  }

  function renderLogin(errorMsg = '') {
    const topbar = document.getElementById('topbar');
    if (topbar) topbar.hidden = true;

    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="login-shell">
        <section class="login-card">
          <div class="login-crest">⚔️</div>
          <h1>Entrar na Mesa</h1>
          <p class="login-sub">Insira seu código de jogador ou a chave do mestre.</p>

          <form id="login-form">
            <div class="login-input-wrap">
              <input id="lk" type="password" autocomplete="current-password" placeholder="Código de acesso" required>
              <button type="button" class="login-eye" id="toggle-pw" title="Mostrar/Ocultar">👁️</button>
            </div>
            <button type="submit" class="bt primary" style="width:100%; padding:11px;">Acessar Grimório</button>
          </form>

          ${errorMsg ? `<p class="login-error">${esc(errorMsg)}</p>` : ''}
        </section>
      </div>
    `;

    const input = document.getElementById('lk');
    const toggleBtn = document.getElementById('toggle-pw');
    const form = document.getElementById('login-form');

    input.focus();

    toggleBtn.onclick = () => {
      input.type = input.type === 'password' ? 'text' : 'password';
    };

    form.onsubmit = (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      KEY = val;
      sessionStorage.setItem('fk', KEY);
      boot();
    };
  }

  // --- NAVEGAÇÃO SUPERIOR ---
  function renderNav() {
    const topbar = document.getElementById('topbar');
    const nv = document.getElementById('nv');
    if (!ME) {
      topbar.hidden = true;
      return;
    }

    topbar.hidden = false;
    const isMaster = ME.role === 'master';

    nv.innerHTML = `
      <span class="tag-pill">${isMaster ? '👑 Mestre' : `🗡️ ${esc(ME.name)}`}</span>
      <button class="bt ${currentView === 'sheet' ? 'on' : ''}" data-nav="sheet">
        ${isMaster ? 'Fichas dos Jogadores' : 'Minha Ficha'}
      </button>
      ${isMaster ? `
        <button class="bt ${currentView === 'admin' ? 'on' : ''}" data-nav="admin">
          Gerenciar Jogadores
        </button>
      ` : ''}
      <button class="bt danger" data-nav="logout">Sair</button>
    `;

    nv.querySelectorAll('[data-nav]').forEach(btn => {
      btn.onclick = () => {
        const target = btn.dataset.nav;
        if (target === 'logout') {
          sessionStorage.removeItem('fk');
          KEY = '';
          ME = null;
          renderLogin();
          return;
        }
        currentView = target;
        renderNav();
        if (currentView === 'admin') renderAdmin();
        else renderSheetView();
      };
    });
  }

  function loadAllSheets() {
    api('sheets')
      .then(res => {
        DATA = (res.players || []).map(p => ({
          ...p,
          sheet: normalizeSheet(p.sheet, p.name)
        }));

        if (DATA.length && !DATA.some(p => p.id === selectedPlayerId)) {
          selectedPlayerId = DATA[0].id;
        }

        renderNav();
        if (currentView === 'admin' && ME.role === 'master') renderAdmin();
        else renderSheetView();
      })
      .catch(err => toast(err.message));
  }

  // --- SALVAMENTO COM DEBOUNCE (EVITA ERRO 429 NO CLOUDFLARE KV) ---
  function updateSyncIndicator(pending) {
    hasPendingChanges = pending;
    const dot = document.getElementById('sync-dot');
    const label = document.getElementById('sync-label');
    if (!dot || !label) return;

    if (pending) {
      dot.classList.add('pending');
      label.textContent = 'Salvando alterações...';
    } else {
      dot.classList.remove('pending');
      label.textContent = 'Ficha salva';
    }
  }

  function scheduleSave(playerEntry) {
    updateSyncIndicator(true);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveSheetNow(playerEntry, true), 900);
  }

  function saveSheetNow(playerEntry, silent = false) {
    clearTimeout(saveTimer);
    if (!playerEntry) return;
    updateSyncIndicator(true);

    api(`sheet/${playerEntry.id}`, 'PUT', playerEntry.sheet)
      .then(() => {
        updateSyncIndicator(false);
        if (!silent) toast('Ficha salva com sucesso!');
      })
      .catch(err => {
        toast(err.message);
      });
  }

  // --- RENDERIZAÇÃO DA FICHA ---
  function renderSheetView() {
    const app = document.getElementById('app');
    const isMaster = ME.role === 'master';

    if (!DATA.length) {
      app.innerHTML = `
        <div class="card" style="text-align:center; padding:40px 20px;">
          <h2 class="card-title">Nenhum jogador cadastrado</h2>
          <p style="color:var(--text-muted); margin:10px 0 20px;">
            ${isMaster
              ? 'Cadastre os jogadores e seus códigos de acesso para liberar as fichas.'
              : 'Aguarde o Mestre configurar sua ficha.'}
          </p>
          ${isMaster ? `<button class="bt primary" id="go-admin-empty">Cadastrar Jogadores</button>` : ''}
        </div>
      `;
      const goBtn = document.getElementById('go-admin-empty');
      if (goBtn) {
        goBtn.onclick = () => {
          currentView = 'admin';
          renderNav();
          renderAdmin();
        };
      }
      return;
    }

    const entry = DATA.find(p => p.id === selectedPlayerId) || DATA[0];
    selectedPlayerId = entry.id;
    const s = entry.sheet;
    const isLockedForPlayer = !isMaster && !!s.lock;

    const hpPct = s.mhp > 0 ? Math.max(0, Math.min(100, (s.hp / s.mhp) * 100)) : 0;
    const stPct = s.mst > 0 ? Math.max(0, Math.min(100, (s.st / s.mst) * 100)) : 0;

    app.innerHTML = `
      <!-- Barra Superior de Controle -->
      <div class="sheet-toolbar">
        <div class="player-tabs">
          ${isMaster
            ? DATA.map(p => `
                <button class="bt sm ${p.id === entry.id ? 'on' : ''}" data-select-player="${p.id}">
                  ${esc(p.sheet.name || p.name)}
                </button>
              `).join('')
            : `<span style="font-weight:600; color:var(--gold-light);">Ficha de ${esc(entry.name)}</span>`
          }
          ${s.lock ? `<span class="tag-pill">🔒 Atributos Travados</span>` : ''}
        </div>

        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span class="sync-status">
            <span class="sync-dot ${hasPendingChanges ? 'pending' : ''}" id="sync-dot"></span>
            <span id="sync-label">${hasPendingChanges ? 'Salvando alterações...' : 'Ficha salva'}</span>
          </span>
          ${isMaster ? `
            <button class="bt sm gold" id="btn-toggle-lock">
              ${s.lock ? '🔓 Destravar Atributos' : '🔒 Travar Atributos'}
            </button>
          ` : ''}
          <button class="bt sm primary" id="btn-save-now">Salvar Agora</button>
        </div>
      </div>

      <!-- Card de Identidade -->
      <section class="card hero-card">
        <div class="avatar-box" id="avatar-trigger" title="Clique para alterar retrato">
          ${s.avatar
            ? `<img src="${esc(s.avatar)}" alt="Retrato">`
            : `<span class="avatar-placeholder">${esc((s.name || entry.name || '?').slice(0, 2).toUpperCase())}</span>`
          }
          <div class="avatar-overlay">Alterar Foto</div>
        </div>

        <div class="hero-fields">
          <div>
            <label class="field-label">Nome do Personagem</label>
            <input class="hero-name-input" data-field="name" value="${esc(s.name)}" placeholder="Nome do personagem">
          </div>
          <div>
            <label class="field-label">Arquétipo / Classe / Origem</label>
            <input data-field="title" value="${esc(s.title)}" placeholder="Ex: Pistoleiro Ocultista">
          </div>
          <div>
            <label class="field-label">Nível</label>
            <input type="number" min="1" max="20" data-field="level" value="${Number(s.level) || 1}" ${isLockedForPlayer ? 'disabled' : ''}>
          </div>
        </div>
      </section>

      <!-- Barras Vitais & Status -->
      <section class="vitals-grid">
        <!-- Vida -->
        <div class="card">
          <div class="vital-top">
            <label class="field-label" style="margin:0;">Pontos de Vida (HP)</label>
            <div class="vital-controls">
              <button class="bt icon-only" data-step="hp" data-delta="-1">−</button>
              <input type="number" data-field="hp" value="${Number(s.hp) || 0}">
              <span>/</span>
              <input type="number" data-field="mhp" value="${Number(s.mhp) || 1}">
              <button class="bt icon-only" data-step="hp" data-delta="1">+</button>
            </div>
          </div>
          <div class="bar-track">
            <div class="bar-fill hp" id="bar-hp" style="width:${hpPct}%;"></div>
          </div>
        </div>

        <!-- Stamina -->
        <div class="card">
          <div class="vital-top">
            <label class="field-label" style="margin:0;">Stamina / Fôlego</label>
            <div class="vital-controls">
              <button class="bt icon-only" data-step="st" data-delta="-1">−</button>
              <input type="number" data-field="st" value="${Number(s.st) || 0}">
              <span>/</span>
              <input type="number" data-field="mst" value="${Number(s.mst) || 1}">
              <button class="bt icon-only" data-step="st" data-delta="1">+</button>
            </div>
          </div>
          <div class="bar-track">
            <div class="bar-fill st" id="bar-st" style="width:${stPct}%;"></div>
          </div>
        </div>

        <!-- Defesa / Vida Extra / Deslocamento -->
        <div class="card" style="display:flex; align-items:center;">
          <div class="quick-stats" style="width:100%;">
            <div class="quick-stat-item">
              <label class="field-label">Defesa</label>
              <input type="number" data-field="ac" value="${Number(s.ac) || 10}">
            </div>
            <div class="quick-stat-item">
              <label class="field-label">HP Extra</label>
              <input type="number" data-field="tempHp" value="${Number(s.tempHp) || 0}">
            </div>
            <div class="quick-stat-item">
              <label class="field-label">Movimento</label>
              <input type="text" data-field="speed" value="${esc(s.speed || '9m')}">
            </div>
          </div>
        </div>
      </section>

      <!-- Grade dos 6 Atributos -->
      <section class="attrs-grid">
        ${ATTRS.map(a => {
          const val = Number(s.attrs[a.key]) || 10;
          return `
            <div class="attr-card">
              <span class="attr-code">${a.key}</span>
              <div class="attr-mod-badge" id="mod-${a.key}">${calcMod(val)}</div>
              <input
                type="number"
                class="attr-score-input"
                min="1"
                max="30"
                data-attr="${a.key}"
                value="${val}"
                ${isLockedForPlayer ? 'disabled' : ''}
              >
              <span class="attr-sub">${a.name}</span>
            </div>
          `;
        }).join('')}
      </section>

      <!-- Blocos Modulares: Habilidades e Inventário -->
      <section class="modules-grid">
        <!-- Habilidades & Poderes -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Habilidades & Poderes</h2>
            <span class="tag-pill">${s.skills.length}</span>
          </div>

          <div class="item-list" id="skills-list">
            ${s.skills.length
              ? s.skills.map((sk, idx) => `
                  <div class="list-entry">
                    <div class="list-entry-main">
                      <div class="list-entry-title">
                        <span>${esc(sk.name)}</span>
                        ${sk.cost ? `<span class="tag-pill">${esc(sk.cost)}</span>` : ''}
                      </div>
                      ${sk.desc ? `<p class="list-entry-desc">${esc(sk.desc)}</p>` : ''}
                    </div>
                    <button class="bt icon-only danger" data-del-skill="${idx}" title="Remover">×</button>
                  </div>
                `).join('')
              : `<p style="color:var(--text-muted); font-size:0.88rem; margin:0;">Nenhuma habilidade adicionada.</p>`
            }
          </div>

          <form class="inline-add-form" id="form-add-skill">
            <div class="inline-add-row">
              <input id="new-skill-name" placeholder="Nome da habilidade" required>
              <input id="new-skill-cost" placeholder="Custo (ex: 2 ST)">
            </div>
            <input id="new-skill-desc" placeholder="Descrição breve ou efeito">
            <button type="submit" class="bt sm gold">+ Adicionar Habilidade</button>
          </form>
        </div>

        <!-- Inventário & Equipamentos -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Inventário & Equipamentos</h2>
            <span class="tag-pill">${s.inventory.length}</span>
          </div>

          <div class="item-list" id="inv-list">
            ${s.inventory.length
              ? s.inventory.map((it, idx) => `
                  <div class="list-entry">
                    <div class="list-entry-main">
                      <div class="list-entry-title">
                        <span>${esc(it.name)}</span>
                        <span class="tag-pill">x${Number(it.qty) || 1}</span>
                      </div>
                      ${it.desc ? `<p class="list-entry-desc">${esc(it.desc)}</p>` : ''}
                    </div>
                    <button class="bt icon-only danger" data-del-item="${idx}" title="Remover">×</button>
                  </div>
                `).join('')
              : `<p style="color:var(--text-muted); font-size:0.88rem; margin:0;">Inventário vazio.</p>`
            }
          </div>

          <form class="inline-add-form" id="form-add-item">
            <div class="inline-add-row">
              <input id="new-item-name" placeholder="Nome do item ou arma" required>
              <input id="new-item-qty" type="number" min="1" value="1" placeholder="Qtd">
            </div>
            <input id="new-item-desc" placeholder="Dano, propriedades ou observações">
            <button type="submit" class="bt sm gold">+ Adicionar Item</button>
          </form>
        </div>
      </section>

      <!-- Anotações do Personagem -->
      <section class="card" style="margin-top:20px;">
        <div class="card-header">
          <h2 class="card-title">Diário & Anotações do Personagem</h2>
        </div>
        <textarea data-field="notes" rows="4" placeholder="História, contatos, pistas e anotações pessoais...">${esc(s.notes)}</textarea>
      </section>

      <!-- Bloco Secreto do Mestre -->
      ${isMaster ? `
        <section class="card master-secret-card">
          <div class="card-header">
            <h2 class="card-title">👁️ Anotações Secretas do Mestre (Invisível ao Jogador)</h2>
          </div>
          <textarea data-field="mnotes" rows="3" placeholder="Segredos, maldições, ganchos de trama deste personagem...">${esc(s.mnotes)}</textarea>
        </section>
      ` : ''}
    `;

    bindSheetEvents(entry);
  }

  function bindSheetEvents(entry) {
    const app = document.getElementById('app');
    const s = entry.sheet;

    // Alternar ficha (Mestre)
    app.querySelectorAll('[data-select-player]').forEach(btn => {
      btn.onclick = () => {
        selectedPlayerId = btn.dataset.selectPlayer;
        renderSheetView();
      };
    });

    // Salvar manual
    const btnSaveNow = document.getElementById('btn-save-now');
    if (btnSaveNow) btnSaveNow.onclick = () => saveSheetNow(entry, false);

    // Travar/Destravar atributos (Mestre)
    const btnLock = document.getElementById('btn-toggle-lock');
    if (btnLock) {
      btnLock.onclick = () => {
        s.lock = !s.lock;
        saveSheetNow(entry, true);
        renderSheetView();
        toast(s.lock ? 'Atributos travados.' : 'Atributos destravados.');
      };
    }

    // Upload de Avatar (redimensionado para caber leve no KV)
    const avatarTrigger = document.getElementById('avatar-trigger');
    const picker = document.getElementById('avatar-picker');
    if (avatarTrigger && picker) {
      avatarTrigger.onclick = () => picker.click();
      picker.onchange = () => {
        const file = picker.files && picker.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const size = 220;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const minSide = Math.min(img.width, img.height);
            const sx = (img.width - minSide) / 2;
            const sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
            s.avatar = canvas.toDataURL('image/jpeg', 0.82);
            saveSheetNow(entry, true);
            renderSheetView();
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
        picker.value = '';
      };
    }

    // Campos simples (inputs e textareas)
    app.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', () => {
        const field = el.dataset.field;
        const isNumeric = el.type === 'number';
        s[field] = isNumeric ? Number(el.value) || 0 : el.value;

        if (field === 'hp' || field === 'mhp') {
          const pct = s.mhp > 0 ? Math.max(0, Math.min(100, (s.hp / s.mhp) * 100)) : 0;
          const bar = document.getElementById('bar-hp');
          if (bar) bar.style.width = `${pct}%`;
        }
        if (field === 'st' || field === 'mst') {
          const pct = s.mst > 0 ? Math.max(0, Math.min(100, (s.st / s.mst) * 100)) : 0;
          const bar = document.getElementById('bar-st');
          if (bar) bar.style.width = `${pct}%`;
        }

        scheduleSave(entry);
      });
    });

    // Botões rápidos +1 / -1 para HP e Stamina
    app.querySelectorAll('[data-step]').forEach(btn => {
      btn.onclick = () => {
        const field = btn.dataset.step;
        const delta = Number(btn.dataset.delta) || 0;
        const maxField = field === 'hp' ? 'mhp' : 'mst';
        s[field] = Math.max(0, Math.min(Number(s[maxField]) || 999, (Number(s[field]) || 0) + delta));
        scheduleSave(entry);
        renderSheetView();
      };
    });

    // Atributos
    app.querySelectorAll('[data-attr]').forEach(el => {
      el.addEventListener('input', () => {
        const key = el.dataset.attr;
        const val = Math.max(1, Math.min(30, Number(el.value) || 10));
        s.attrs[key] = val;
        const badge = document.getElementById('mod-' + key);
        if (badge) badge.textContent = calcMod(val);
        scheduleSave(entry);
      });
    });

    // Adicionar Habilidade
    const formSkill = document.getElementById('form-add-skill');
    if (formSkill) {
      formSkill.onsubmit = (e) => {
        e.preventDefault();
        const name = document.getElementById('new-skill-name').value.trim();
        const cost = document.getElementById('new-skill-cost').value.trim();
        const desc = document.getElementById('new-skill-desc').value.trim();
        if (!name) return;
        s.skills.push({ name, cost, desc });
        saveSheetNow(entry, true);
        renderSheetView();
      };
    }

    // Remover Habilidade
    app.querySelectorAll('[data-del-skill]').forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.delSkill);
        s.skills.splice(idx, 1);
        saveSheetNow(entry, true);
        renderSheetView();
      };
    });

    // Adicionar Item
    const formItem = document.getElementById('form-add-item');
    if (formItem) {
      formItem.onsubmit = (e) => {
        e.preventDefault();
        const name = document.getElementById('new-item-name').value.trim();
        const qty = Math.max(1, Number(document.getElementById('new-item-qty').value) || 1);
        const desc = document.getElementById('new-item-desc').value.trim();
        if (!name) return;
        s.inventory.push({ name, qty, desc });
        saveSheetNow(entry, true);
        renderSheetView();
      };
    }

    // Remover Item
    app.querySelectorAll('[data-del-item]').forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.delItem);
        s.inventory.splice(idx, 1);
        saveSheetNow(entry, true);
        renderSheetView();
      };
    });
  }

  // --- PAINEL DO MESTRE: GERENCIAR JOGADORES ---
  function renderAdmin() {
    const app = document.getElementById('app');

    app.innerHTML = `
      <div class="admin-layout">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">Novo Jogador</h2>
          </div>
          <form id="form-new-player" style="display:grid; gap:12px;">
            <div>
              <label class="field-label">Nome do Jogador</label>
              <input id="adm-new-name" placeholder="Ex: Lucas" required>
            </div>
            <div>
              <label class="field-label">Código de Acesso (PIN)</label>
              <input id="adm-new-pin" placeholder="Ex: lucas123" required>
            </div>
            <button type="submit" class="bt primary">Cadastrar Jogador</button>
          </form>
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">Jogadores da Mesa (${DATA.length})</h2>
          </div>

          <div style="display:grid; gap:10px;">
            ${DATA.length
              ? DATA.map(p => `
                  <div class="player-row-card">
                    <div>
                      <strong style="color:var(--gold-light); font-size:1rem;">${esc(p.name)}</strong>
                      <div style="margin-top:4px; display:flex; align-items:center; gap:8px;">
                        <span style="font-size:0.8rem; color:var(--text-muted);">Código:</span>
                        <span class="pin-badge">${esc(p.pin || '—')}</span>
                      </div>
                    </div>
                    <div style="display:flex; gap:6px;">
                      <button class="bt sm" data-open-sheet="${p.id}">Abrir Ficha</button>
                      <button class="bt sm danger" data-del-player="${p.id}" data-player-name="${esc(p.name)}">Remover</button>
                    </div>
                  </div>
                `).join('')
              : `<p style="color:var(--text-muted); margin:0;">Nenhum jogador cadastrado ainda.</p>`
            }
          </div>
        </section>
      </div>
    `;

    document.getElementById('form-new-player').onsubmit = (e) => {
      e.preventDefault();
      const name = document.getElementById('adm-new-name').value.trim();
      const pin = document.getElementById('adm-new-pin').value.trim();
      if (!name || !pin) return;

      api('players', 'POST', { name, pin })
        .then(() => {
          toast('Jogador cadastrado!');
          loadAllSheets();
        })
        .catch(err => toast(err.message));
    };

    app.querySelectorAll('[data-open-sheet]').forEach(btn => {
      btn.onclick = () => {
        selectedPlayerId = btn.dataset.openSheet;
        currentView = 'sheet';
        renderNav();
        renderSheetView();
      };
    });

    app.querySelectorAll('[data-del-player]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.delPlayer;
        const name = btn.dataset.playerName;
        if (!confirm(`Remover "${name}" e apagar permanentemente sua ficha?`)) return;

        api(`players/${id}`, 'DELETE')
          .then(() => {
            toast('Jogador removido.');
            loadAllSheets();
          })
          .catch(err => toast(err.message));
      };
    });
  }

  boot();
})();
