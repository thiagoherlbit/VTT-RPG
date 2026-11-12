(function () {
  let KEY = sessionStorage.getItem('fk') || '';
  let ME = null;
  let DATA = [];
  let selectedPlayerId = '';
  let currentView = 'sheet';
  let saveTimer = null;
  let hasPendingChanges = false;
  let pickMode = 'avatar';

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
      banner: '',
      pageBg: '',
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

  function applyPageBackground(url) {
    const bgi = document.getElementById('bgi');
    if (!bgi) return;
    bgi.style.backgroundImage = url ? `url("${url}")` : '';
  }

  function initAtmosphere() {
    const drips = document.getElementById('drips');
    if (drips && !drips.children.length) {
      for (let i = 0; i < 14; i++) {
        const d = document.createElement('span');
        d.className = 'blood-drip';
        d.style.left = `${(i * 7.3 + 2) % 98}%`;
        d.style.height = `${22 + (i % 5) * 14}px`;
        d.style.animationDelay = `${(i * 0.7) % 5}s`;
        drips.appendChild(d);
      }
    }

    const cv = document.getElementById('cv');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const resize = () => {
      cv.width = window.innerWidth;
      cv.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const sparks = Array.from({ length: 30 }, () => ({
      x: Math.random() * cv.width,
      y: Math.random() * cv.height,
      r: Math.random() * 1.9 + 0.6,
      vy: -(Math.random() * 0.45 + 0.15),
      vx: (Math.random() - 0.5) * 0.35,
      a: Math.random() * 0.65 + 0.2
    }));

    function tick() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      sparks.forEach(s => {
        s.x += s.vx;
        s.y += s.vy;
        if (s.y < -10) {
          s.y = cv.height + 10;
          s.x = Math.random() * cv.width;
        }
        ctx.fillStyle = `rgba(235, 130, 52, ${s.a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      });
      requestAnimationFrame(tick);
    }
    tick();
  }

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
    applyPageBackground('');
    const nv = document.getElementById('nv');
    if (nv) nv.hidden = true;

    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="login-shell">
        <section class="login-card">
          <div class="stamp-seal">SANTO OFÍCIO</div>
          <h1>Acesso à Mesa</h1>
          <p class="login-sub">Apresente seu salvo-conduto de jogador ou a chave do Inquisidor.</p>

          <form id="login-form">
            <div class="login-input-wrap">
              <input id="lk" type="password" autocomplete="current-password" placeholder="Código de acesso" required>
              <button type="button" class="bt" id="toggle-pw" title="Mostrar/Ocultar">👁️</button>
            </div>
            <button type="submit" class="bt primary" style="width:100%; padding:11px;">Entrar no Grimório</button>
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

    form.onsubmit = e => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      KEY = val;
      sessionStorage.setItem('fk', KEY);
      boot();
    };
  }

  function renderNav() {
    const nv = document.getElementById('nv');
    if (!nv) return;
    if (!ME) {
      nv.hidden = true;
      return;
    }

    nv.hidden = false;
    const isMaster = ME.role === 'master';

    nv.innerHTML = `
      <span class="tag-pill">${isMaster ? '👑 Mestre' : `🗡️ ${esc(ME.name)}`}</span>
      <button class="bt ${currentView === 'sheet' ? 'on' : ''}" data-nav="sheet">
        ${isMaster ? '📜 Fichas' : '📜 Minha Ficha'}
      </button>
      ${isMaster ? `
        <button class="bt ${currentView === 'admin' ? 'on' : ''}" data-nav="admin">
          👥 Gerenciar Jogadores
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

  function updateSyncIndicator(pending) {
    hasPendingChanges = pending;
    const dot = document.getElementById('sync-dot');
    const label = document.getElementById('sync-label');
    if (!dot || !label) return;
    dot.classList.toggle('pending', pending);
    label.textContent = pending ? 'Salvando alterações...' : 'Ficha salva';
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
      .catch(err => toast(err.message));
  }

  function renderSheetView() {
    const app = document.getElementById('app');
    const isMaster = ME.role === 'master';

    if (!DATA.length) {
      app.innerHTML = `
        <div class="poster-card" style="text-align:center; padding:40px 20px;">
          <h2 class="wanted-title" style="font-size:1.5rem;">Nenhum Jogador Cadastrado</h2>
          <p style="margin:10px 0 20px;">
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

    applyPageBackground(s.pageBg || '');

    const hpPct = s.mhp > 0 ? Math.max(0, Math.min(100, (s.hp / s.mhp) * 100)) : 0;
    const stPct = s.mst > 0 ? Math.max(0, Math.min(100, (s.st / s.mst) * 100)) : 0;

    app.innerHTML = `
      <div class="sheet-toolbar">
        <div class="player-tabs">
          ${isMaster
            ? DATA.map(p => `
                <button class="bt sm ${p.id === entry.id ? 'on' : ''}" data-select-player="${p.id}">
                  ${esc(p.sheet.name || p.name)}
                </button>
              `).join('')
            : `<span style="font-weight:bold; color:#f2cf88;">Ficha de ${esc(entry.name)}</span>`
          }
          ${s.lock ? `<span class="tag-pill">🔒 Atributos Travados</span>` : ''}
        </div>

        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span class="sync-status">
            <span class="sync-dot ${hasPendingChanges ? 'pending' : ''}" id="sync-dot"></span>
            <span id="sync-label">${hasPendingChanges ? 'Salvando alterações...' : 'Ficha salva'}</span>
          </span>
          ${isMaster ? `
            <button class="bt sm gold" id="btn-toggle-lock">
              ${s.lock ? '🔓 Destravar' : '🔒 Travar'}
            </button>
          ` : ''}
          <button class="bt sm primary" id="btn-save-now">Salvar Agora</button>
        </div>
      </div>

      <!-- MOLDURA DE MADEIRA + CARTAZ PROCURADO -->
      <section class="poster-card">
        <div class="wood-banner-frame">
          ${s.banner ? `<img src="${esc(s.banner)}" alt="Banner">` : ''}
          <div class="wood-banner-actions">
            <button class="bt sm" id="btn-pick-banner" title="Trocar imagem do banner">🖼️ Banner</button>
            <button class="bt sm" id="btn-pick-bg" title="Trocar fundo da página">🌄 Fundo</button>
          </div>
        </div>

        <div class="poster-inner">
          <div class="poster-header">
            <h1 class="wanted-title">PROCURADO</h1>
            <span class="stamp-seal" style="margin:0;">SANTO OFÍCIO</span>
          </div>

          <div class="hero-body">
            <div class="avatar-box" id="avatar-trigger" title="Clique para alterar retrato">
              ${s.avatar
                ? `<img src="${esc(s.avatar)}" alt="Retrato">`
                : `<span class="avatar-placeholder">${esc((s.name || entry.name || '?').slice(0, 2).toUpperCase())}</span>`
              }
              <div class="avatar-overlay">Alterar Retrato</div>
            </div>

            <div class="hero-fields">
              <div class="full">
                <label class="field-label">Nome do Personagem</label>
                <input class="hero-name-input" data-field="name" value="${esc(s.name)}" placeholder="Nome do personagem">
              </div>
              <div>
                <label class="field-label">Arquétipo / Origem</label>
                <input data-field="title" value="${esc(s.title)}" placeholder="Ex: Pistoleiro Ocultista">
              </div>
              <div>
                <label class="field-label">Nível</label>
                <input type="number" min="1" max="20" data-field="level" value="${Number(s.level) || 1}" ${isLockedForPlayer ? 'disabled' : ''}>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- CHAPAS DE FERRO ENFERRUJADO & ECG -->
      <section class="vitals-grid">
        <div class="iron-card">
          <div class="vital-top">
            <label class="field-label" style="margin:0;">Vitalidade (HP)</label>
            <div class="vital-controls">
              <button class="bt icon-only" data-step="hp" data-delta="-1">−</button>
              <input type="number" data-field="hp" value="${Number(s.hp) || 0}">
              <span>/</span>
              <input type="number" data-field="mhp" value="${Number(s.mhp) || 1}">
              <button class="bt icon-only" data-step="hp" data-delta="1">+</button>
            </div>
          </div>
          <div class="ecg-track">
            <div class="ecg-fill hp" id="bar-hp" style="width:${hpPct}%;"></div>
            <svg class="ecg-line" viewBox="0 0 200 20" preserveAspectRatio="none">
              <polyline fill="none" stroke="rgba(255,220,220,0.6)" stroke-width="1.5" points="0,10 60,10 68,3 76,18 84,6 92,10 200,10"/>
            </svg>
          </div>
        </div>

        <div class="iron-card">
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
          <div class="ecg-track">
            <div class="ecg-fill st" id="bar-st" style="width:${stPct}%;"></div>
            <svg class="ecg-line" viewBox="0 0 200 20" preserveAspectRatio="none">
              <polyline fill="none" stroke="rgba(255,240,200,0.55)" stroke-width="1.5" points="0,10 110,10 118,4 126,16 134,8 142,10 200,10"/>
            </svg>
          </div>
        </div>

        <div class="iron-card" style="display:flex; align-items:center;">
          <div class="quick-stats" style="width:100%;">
            <div>
              <label class="field-label">Defesa</label>
              <input type="number" data-field="ac" value="${Number(s.ac) || 10}">
            </div>
            <div>
              <label class="field-label">Vida Extra</label>
              <input type="number" data-field="tempHp" value="${Number(s.tempHp) || 0}">
            </div>
            <div>
              <label class="field-label">Passo</label>
              <input type="text" data-field="speed" value="${esc(s.speed || '9m')}">
            </div>
          </div>
        </div>
      </section>

      <!-- COURO RACHADO COM REBITES (ATRIBUTOS) -->
      <section class="attrs-grid">
        ${ATTRS.map(a => {
          const val = Number(s.attrs[a.key]) || 10;
          return `
            <div class="attr-card">
              <span class="attr-code">${a.key}</span>
              <div class="attr-mod-badge" id="mod-${a.key}">${calcMod(val)}</div>
              <input type="number" class="attr-score-input" min="1" max="30" data-attr="${a.key}" value="${val}" ${isLockedForPlayer ? 'disabled' : ''}>
              <span class="attr-sub">${a.name}</span>
            </div>
          `;
        }).join('')}
      </section>

      <!-- LIVRO-RAZÃO (HABILIDADES) & TÁBUA QUEIMADA (INVENTÁRIO) -->
      <section class="modules-grid">
        <div class="parchment-card">
          <div class="card-header">
            <h2 class="card-title">Habilidades &amp; Rituais</h2>
            <span class="tag-pill">${s.skills.length}</span>
          </div>

          <div class="item-list">
            ${s.skills.length
              ? s.skills.map((sk, idx) => `
                  <div class="list-entry">
                    <div>
                      <div class="list-entry-title">
                        <span>${esc(sk.name)}</span>
                        ${sk.cost ? `<span class="tag-pill">${esc(sk.cost)}</span>` : ''}
                      </div>
                      ${sk.desc ? `<p class="list-entry-desc">${esc(sk.desc)}</p>` : ''}
                    </div>
                    <div style="display:flex; gap:4px;">
                      ${sk.cost ? `<button class="bt sm gold" data-use-skill="${idx}">Usar</button>` : ''}
                      <button class="bt icon-only danger" data-del-skill="${idx}" title="Remover">×</button>
                    </div>
                  </div>
                `).join('')
              : `<p style="font-size:0.88rem; margin:0;">Nenhuma habilidade registrada.</p>`
            }
          </div>

          <form class="inline-add-form" id="form-add-skill">
            <div class="inline-add-row">
              <input id="new-skill-name" placeholder="Nome da habilidade" required>
              <input id="new-skill-cost" placeholder="Custo (ex: 2 ST)">
            </div>
            <input id="new-skill-desc" placeholder="Efeito ou descrição">
            <button type="submit" class="bt sm gold">+ Adicionar Habilidade</button>
          </form>
        </div>

        <div class="wood-card">
          <div class="card-header">
            <h2 class="card-title">Inventário &amp; Arsenal</h2>
            <span class="tag-pill">${s.inventory.length}</span>
          </div>

          <div class="item-list">
            ${s.inventory.length
              ? s.inventory.map((it, idx) => `
                  <div class="list-entry">
                    <div style="cursor:pointer; flex:1;" data-inspect-item="${idx}">
                      <div class="list-entry-title">
                        <span>${esc(it.name)}</span>
                        <span class="tag-pill">x${Number(it.qty) || 1}</span>
                      </div>
                      ${it.desc ? `<p class="list-entry-desc">${esc(it.desc)}</p>` : ''}
                    </div>
                    <button class="bt icon-only danger" data-del-item="${idx}" title="Remover">×</button>
                  </div>
                `).join('')
              : `<p style="font-size:0.88rem; margin:0; opacity:0.8;">Alforje vazio.</p>`
            }
          </div>

          <form class="inline-add-form" id="form-add-item">
            <div class="inline-add-row">
              <input id="new-item-name" placeholder="Nome do item ou arma" required>
              <input id="new-item-qty" type="number" min="1" value="1" placeholder="Qtd">
            </div>
            <input id="new-item-desc" placeholder="Dano, alcance ou notas">
            <button type="submit" class="bt sm gold">+ Adicionar Item</button>
          </form>
        </div>
      </section>

      <section class="parchment-card">
        <div class="card-header">
          <h2 class="card-title">Diário de Campo &amp; Anotações</h2>
        </div>
        <textarea data-field="notes" rows="4" placeholder="Pistas, contatos, pecados e anotações...">${esc(s.notes)}</textarea>
      </section>

      ${isMaster ? `
        <section class="master-secret-card">
          <div class="card-header">
            <h2 class="card-title">👁️ Dossiê Secreto do Mestre (Oculto do Jogador)</h2>
          </div>
          <textarea data-field="mnotes" rows="3" placeholder="Segredos, maldições e ganchos...">${esc(s.mnotes)}</textarea>
        </section>
      ` : ''}
    `;

    bindSheetEvents(entry);
  }

  function bindSheetEvents(entry) {
    const app = document.getElementById('app');
    const s = entry.sheet;

    app.querySelectorAll('[data-select-player]').forEach(btn => {
      btn.onclick = () => {
        selectedPlayerId = btn.dataset.selectPlayer;
        renderSheetView();
      };
    });

    const btnSaveNow = document.getElementById('btn-save-now');
    if (btnSaveNow) btnSaveNow.onclick = () => saveSheetNow(entry, false);

    const btnLock = document.getElementById('btn-toggle-lock');
    if (btnLock) {
      btnLock.onclick = () => {
        s.lock = !s.lock;
        saveSheetNow(entry, true);
        renderSheetView();
        toast(s.lock ? 'Atributos travados.' : 'Atributos destravados.');
      };
    }

    const picker = document.getElementById('pick');
    const triggerImagePick = mode => {
      if (!picker) return;
      pickMode = mode;
      picker.click();
    };

    const avatarTrigger = document.getElementById('avatar-trigger');
    if (avatarTrigger) avatarTrigger.onclick = () => triggerImagePick('avatar');

    const btnBanner = document.getElementById('btn-pick-banner');
    if (btnBanner) btnBanner.onclick = () => triggerImagePick('banner');

    const btnBg = document.getElementById('btn-pick-bg');
    if (btnBg) btnBg.onclick = () => triggerImagePick('pageBg');

    if (picker) {
      picker.onchange = () => {
        const file = picker.files && picker.files[0];
        picker.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (pickMode === 'avatar') {
              const size = 220;
              canvas.width = size;
              canvas.height = size;
              const minSide = Math.min(img.width, img.height);
              const sx = (img.width - minSide) / 2;
              const sy = (img.height - minSide) / 2;
              ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
              s.avatar = canvas.toDataURL('image/jpeg', 0.82);
            } else {
              const maxW = pickMode === 'banner' ? 1000 : 1280;
              const ratio = Math.min(1, maxW / img.width);
              canvas.width = Math.round(img.width * ratio);
              canvas.height = Math.round(img.height * ratio);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              s[pickMode] = canvas.toDataURL('image/jpeg', 0.76);
            }

            saveSheetNow(entry, true);
            renderSheetView();
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      };
    }

    app.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', () => {
        const field = el.dataset.field;
        s[field] = el.type === 'number' ? Number(el.value) || 0 : el.value;

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

    const formSkill = document.getElementById('form-add-skill');
    if (formSkill) {
      formSkill.onsubmit = e => {
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

    app.querySelectorAll('[data-use-skill]').forEach(btn => {
      btn.onclick = () => {
        const sk = s.skills[Number(btn.dataset.useSkill)];
        if (!sk) return;
        const costNum = parseInt(String(sk.cost || '0').replace(/\D+/g, ''), 10) || 0;
        if (costNum > 0 && s.st < costNum) {
          toast('Stamina insuficiente!');
          return;
        }
        if (costNum > 0) s.st = Math.max(0, s.st - costNum);
        saveSheetNow(entry, true);
        renderSheetView();
        toast(`Usou "${sk.name}"${costNum ? ` (−${costNum} ST)` : ''}!`);
      };
    });

    app.querySelectorAll('[data-del-skill]').forEach(btn => {
      btn.onclick = () => {
        s.skills.splice(Number(btn.dataset.delSkill), 1);
        saveSheetNow(entry, true);
        renderSheetView();
      };
    });

    const formItem = document.getElementById('form-add-item');
    if (formItem) {
      formItem.onsubmit = e => {
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

    app.querySelectorAll('[data-inspect-item]').forEach(el => {
      el.onclick = () => {
        const it = s.inventory[Number(el.dataset.inspectItem)];
        const md = document.getElementById('md');
        if (!it || !md) return;
        md.innerHTML = `
          <div class="mdl-box" onclick="event.stopPropagation()">
            <div class="card-header">
              <h2 class="card-title">${esc(it.name)} (x${Number(it.qty) || 1})</h2>
              <button class="bt sm danger" id="close-md">Fechar</button>
            </div>
            <p style="font-family:'Special Elite',monospace; font-size:0.88rem; line-height:1.5;">
              ${esc(it.desc || 'Nenhuma descrição registrada para este item.')}
            </p>
          </div>
        `;
        md.classList.add('on');
        document.getElementById('close-md').onclick = () => md.classList.remove('on');
      };
    });

    app.querySelectorAll('[data-del-item]').forEach(btn => {
      btn.onclick = () => {
        s.inventory.splice(Number(btn.dataset.delItem), 1);
        saveSheetNow(entry, true);
        renderSheetView();
      };
    });
  }

  function renderAdmin() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="admin-layout">
        <section class="parchment-card">
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

        <section class="parchment-card">
          <div class="card-header">
            <h2 class="card-title">Jogadores da Mesa (${DATA.length})</h2>
          </div>

          <div style="display:grid; gap:10px;">
            ${DATA.length
              ? DATA.map(p => `
                  <div class="player-row-card">
                    <div>
                      <strong style="font-size:1.05rem;">${esc(p.name)}</strong>
                      <div style="margin-top:4px; display:flex; align-items:center; gap:8px;">
                        <span style="font-size:0.8rem;">Código:</span>
                        <span class="pin-badge">${esc(p.pin || '—')}</span>
                      </div>
                    </div>
                    <div style="display:flex; gap:6px;">
                      <button class="bt sm gold" data-open-sheet="${p.id}">Abrir Ficha</button>
                      <button class="bt sm danger" data-del-player="${p.id}" data-player-name="${esc(p.name)}">Remover</button>
                    </div>
                  </div>
                `).join('')
              : `<p style="margin:0;">Nenhum jogador cadastrado ainda.</p>`
            }
          </div>
        </section>
      </div>
    `;

    document.getElementById('form-new-player').onsubmit = e => {
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

  const md = document.getElementById('md');
  if (md) {
    md.onclick = () => md.classList.remove('on');
  }

  initAtmosphere();
  boot();
})();
