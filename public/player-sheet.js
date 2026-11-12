(function () {
  'use strict';

  let KEY = sessionStorage.getItem('fk') || '';
  let ME = null;
  let DATA = [];
  let cid = '';
  let view = 'sheet'; // 'sheet' | 'admin'

  const V0 = n => ({ n, c: 0, m: 0 });
  const D = {
    name: '',
    title: '',
    motto: '',
    notes: '',
    mnotes: '',
    lock: false,
    attrs: [['Força', 0], ['Destreza', 0], ['Constituição', 0], ['Inteligência', 0], ['Presença', 0]],
    hp: { n: 'Vida', c: 0, m: 0, x: 0 },
    st: V0('Stamina'),
    avatar: '',
    banner: '',
    bg: '',
    skills: [],
    items: []
  };

  const TY = {
    Arma: '#d1303c',
    'Relíquia': '#d8b45a',
    'Consumível': '#4fa36b',
    'Munição': '#6f8fb8',
    Outro: '#8a7f7c'
  };
  const TN = Object.keys(TY);

  function I(p, c) {
    return '<svg class="ic' + (c ? ' ' + c : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>';
  }

  const P = {
    cross: '<path d="M12 2v20M5 8h14"/>',
    drop: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>',
    dag: '<path d="M12 2l3 11-3 3-3-3z"/><path d="M7 16h10M12 16v6"/>',
    bul: '<path d="M9 21V10c0-4 1.5-6 3-7 1.5 1 3 3 3 7v11zM9 17h6"/>',
    dia: '<path d="M12 3l8 9-8 9-4-4.5L4 12z"/>',
    skull: '<path d="M12 3a8 8 0 0 0-8 8c0 3 1.5 4.5 3 5.5V20h10v-3.5c1.5-1 3-2.5 3-5.5a8 8 0 0 0-8-8z"/><circle cx="9" cy="11" r="1.8"/><circle cx="15" cy="11" r="1.8"/><path d="M12 14v2M10 20v-2M14 20v-2"/>',
    heart: '<path d="M12 21s-8-5.5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 10c0 5.5-8 11-8 11z"/>',
    flame: '<path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z"/>',
    sig: '<circle cx="12" cy="12" r="9.5"/><path d="M12 3l5.3 16.3L3.4 9.2h17.2L6.7 19.3z"/>'
  };

  const TIC = { Arma: 'dag', 'Relíquia': 'cross', 'Consumível': 'drop', 'Munição': 'bul', Outro: 'dia' };
  const VI = {
    hp: [I(P.heart, 'ht'), 'Vida', ['Dano', 'Curar']],
    st: [I(P.flame, 'fm'), 'Stamina', ['Gastar', 'Recuperar']]
  };

  function mod(v) {
    v = +v || 0;
    if (v <= 1) return v - 6;
    if (v === 2) return -4;
    if (v === 3) return -3;
    if (v <= 5) return -2;
    if (v <= 8) return -1;
    if (v <= 12) return 0;
    if (v <= 15) return 1;
    if (v <= 17) return 2;
    return v - 15;
  }

  function sg(n) {
    return (n > 0 ? '+' : '') + n;
  }

  function modH(i, v) {
    const m = mod(v);
    return '<small class="mod ' + (m > 0 ? 'pos' : m < 0 ? 'neg' : '') + '" data-mod="' + i + '" title="Vantagem ou desvantagem do atributo">' + sg(m) + '</small>';
  }

  function cl(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function normalizeSheet(raw, fallbackName) {
    const base = cl(D);
    if (!raw || typeof raw !== 'object') {
      base.name = fallbackName || '';
      return base;
    }
    const merged = Object.assign(base, raw);
    merged.hp = Object.assign(cl(D.hp), raw.hp || {});
    merged.st = Object.assign(V0('Stamina'), raw.st || {});
    merged.attrs = Array.isArray(raw.attrs) ? raw.attrs : cl(D.attrs);
    merged.skills = Array.isArray(raw.skills) ? raw.skills : [];
    merged.items = Array.isArray(raw.items) ? raw.items : [];
    if (!merged.name && fallbackName) merged.name = fallbackName;
    return merged;
  }

  let S = cl(D);
  let oi = -1;
  let fl = 'Tudo';
  let pend = null;
  let sure = 0;
  let tt = 0;
  let st0 = 0;
  let booted = 0;
  let savingState = 'Salvo na nuvem.';

  const nv = document.getElementById('nv');
  const app = document.getElementById('app');
  const md = document.getElementById('md');
  const pick = document.getElementById('pick');
  const te = document.getElementById('toast');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    }[c]));
  }

  function toast(m) {
    te.textContent = m;
    te.classList.add('on');
    clearTimeout(tt);
    tt = setTimeout(() => te.classList.remove('on'), 3000);
  }

  function imgOr(s, ic, a, c) {
    return s ? '<img src="' + s + '" alt="' + esc(a) + '">' : I(P[ic], c);
  }

  // --- API CLOUDFLARE ---
  function api(path, method = 'GET', body) {
    return fetch('/api/' + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-key': KEY },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(async r => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Erro na requisição');
      return j;
    });
  }

  function updateSyncText(txt) {
    savingState = txt;
    const el = document.getElementById('sync-txt');
    if (el) el.textContent = txt;
  }

  function flush() {
    clearTimeout(st0);
    if (!ME || !cid) return;
    updateSyncText('Salvando...');
    api('sheet/' + cid, 'PUT', cl(S))
      .then(() => updateSyncText('Salvo na nuvem.'))
      .catch(err => {
        updateSyncText('Erro ao salvar.');
        toast(err.message);
      });
  }

  function save() {
    clearTimeout(st0);
    updateSyncText('Alterações pendentes...');
    st0 = setTimeout(flush, 650);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && st0) flush();
  });

  // --- COMPRESSÃO DE IMAGEM PARA KV ---
  function compressImage(file, path, cb) {
    const isBg = path === 'bg' || path === 'banner';
    const maxW = isBg ? 960 : 280;
    const maxH = isBg ? 540 : 280;

    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(cv.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => toast('Não foi possível processar essa imagem.');
      img.src = r.result;
    };
    r.onerror = () => toast('Não foi possível ler essa imagem.');
    r.readAsDataURL(file);
  }

  // --- AUTENTICAÇÃO & NAVEGAÇÃO ---
  function boot() {
    if (!KEY) {
      renderLogin();
      return;
    }
    api('me')
      .then(m => {
        ME = m;
        loadAll();
      })
      .catch(() => {
        ME = null;
        KEY = '';
        sessionStorage.removeItem('fk');
        renderLogin('Código inválido ou acesso negado.');
      });
  }

  function renderLogin(errMsg = '') {
    nv.hidden = true;
    app.innerHTML = `
      <div class="login-wrap">
        <section class="pn login-card rise">
          <div style="margin-bottom:6px;">${I(P.skull, 'sw')}</div>
          <h1 class="login-title">Entrar na Mesa</h1>
          <p class="login-sub">Apresente seu código de acesso ou a chave do Santo Ofício.</p>
          <form id="login-form">
            <div class="login-field">
              <input id="lk" type="password" placeholder="Código de acesso" required autocomplete="current-password">
              <button type="button" class="pw-eye" id="btn-eye" title="Mostrar/Ocultar">👁️</button>
            </div>
            <button type="submit" class="bt" style="width:100%;">Abrir Grimório</button>
          </form>
          ${errMsg ? `<p style="color:#8f111c;font:.9rem var(--tp);margin:12px 0 0;">${esc(errMsg)}</p>` : ''}
        </section>
      </div>
    `;

    const inp = document.getElementById('lk');
    inp.focus();

    document.getElementById('btn-eye').onclick = () => {
      inp.type = inp.type === 'password' ? 'text' : 'password';
    };

    document.getElementById('login-form').onsubmit = e => {
      e.preventDefault();
      const val = inp.value.trim();
      if (!val) return;
      KEY = val;
      sessionStorage.setItem('fk', KEY);
      boot();
    };
  }

  function renderNav() {
    if (!ME) {
      nv.hidden = true;
      return;
    }
    nv.hidden = false;
    const isMaster = ME.role === 'master';

    nv.innerHTML = `
      <div class="topbar-group">
        <span class="role-tag">${isMaster ? '👑 MESTRE' : '✝ ' + esc(ME.name || 'JOGADOR')}</span>
        <button class="bt ${view === 'sheet' ? 'on' : ''}" data-act="go-sheet">
          ${isMaster ? 'Fichas da Mesa' : 'Minha Ficha'}
        </button>
        ${isMaster ? `<button class="bt ${view === 'admin' ? 'on' : ''}" data-act="go-admin">Gerenciar Jogadores</button>` : ''}
      </div>
      <div class="topbar-group">
        <button class="bt" data-act="logout">Sair</button>
      </div>
    `;
  }

  function loadAll() {
    api('sheets')
      .then(r => {
        DATA = (r.players || []).map(p => ({
          ...p,
          sheet: normalizeSheet(p.sheet, p.name)
        }));

        if (DATA.length) {
          if (!cid || !DATA.some(p => p.id === cid)) cid = DATA[0].id;
          const active = DATA.find(p => p.id === cid);
          S = active.sheet;
        } else {
          cid = '';
          S = cl(D);
        }

        renderNav();
        if (view === 'admin' && ME.role === 'master') renderAdmin();
        else render();
      })
      .catch(err => toast(err.message));
  }

  // --- RENDERIZAÇÃO DA FICHA (O INQUISIDOR DO DESERTO) ---
  function setPath(p, v) {
    const k = p.split('.');
    let o = S;
    for (let i = 0; i < k.length - 1; i++) o = o[k[i]];
    o[k[k.length - 1]] = v;
  }

  function vital(k, d) {
    const v = S[k];
    const hp = k === 'hp';
    const L = v.n || VI[k][1];
    const b = VI[k][2];
    return (
      '<section class="pn rise" data-v="' + k + '"' + d + '>' +
        '<h2>' + VI[k][0] + '<input class="vn" data-set="' + k + '.n" value="' + esc(L) + '" aria-label="Nome da barra"></h2>' +
        '<div class="nums">' +
          '<input type="number" min="0" data-set="' + k + '.c" value="' + v.c + '" aria-label="' + esc(L) + ' atual">' +
          '<span>/</span>' +
          '<input type="number" min="0" data-set="' + k + '.m" value="' + v.m + '" aria-label="' + esc(L) + ' máxima">' +
        '</div>' +
        (hp ? '<svg class="ecg" viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,12 30,12 36,12 40,3 46,21 51,12 80,12 86,8 90,12 120,12"/></svg>' : '') +
        '<div class="bar b1"><i></i></div>' +
        (hp ? '<div class="xr"><label>Vida extra <input type="number" min="0" data-set="hp.x" value="' + (v.x || 0) + '"></label></div><div class="bar b2"><i></i></div>' : '') +
        '<div class="ctl">' +
          '<input type="number" min="1" value="1" data-amt="' + k + '" aria-label="Valor">' +
          '<button class="bt" data-act="dmg" data-k="' + k + '">' + b[0] + '</button>' +
          '<button class="bt" data-act="heal" data-k="' + k + '">' + b[1] + '</button>' +
          (hp ? '<button class="bt" data-act="xtra">+ Extra</button>' : '') +
        '</div>' +
        (v.m > 0 ? '' : '<p class="hint mu">Defina o máximo primeiro.</p>') +
      '</section>'
    );
  }

  function paint(k) {
    const s = document.querySelector('[data-v="' + k + '"]');
    if (!s) return;
    const v = S[k];
    const m = v.m > 0 ? v.m : 0;
    s.querySelector('.b1 i').style.width = (m ? Math.min(100, (v.c / m) * 100) : 0) + '%';
    const b = s.querySelector('.b2 i');
    if (b) b.style.width = (m ? Math.min(100, ((v.x || 0) / m) * 100) : 0) + '%';
    s.classList.toggle('low', m > 0 && v.c / m <= 0.3);
  }

  function sync(k) {
    const v = S[k];
    ['c', 'm', 'x'].forEach(f => {
      const e = document.querySelector('[data-set="' + k + '.' + f + '"]');
      if (e && v[f] !== undefined && +e.value !== v[f]) e.value = v[f];
    });
    paint(k);
    save();
  }

  function fix(k) {
    const v = S[k];
    v.m = Math.max(0, v.m || 0);
    v.c = Math.max(0, Math.min(v.c || 0, v.m));
    if (k === 'hp') v.x = Math.max(0, v.x || 0);
    sync(k);
  }

  function amt(k) {
    const e = document.querySelector('[data-amt="' + k + '"]');
    return Math.max(1, parseInt(e && e.value) || 1);
  }

  function render() {
    const isMaster = ME && ME.role === 'master';

    if (!DATA.length) {
      app.innerHTML = `
        <section class="pn pn-paper rise" style="grid-column:1/-1;text-align:center;padding:36px 20px;">
          <h2 style="justify-content:center;">Nenhum Jogador Cadastrado</h2>
          <p class="mu">${isMaster ? 'Cadastre os jogadores e seus códigos de acesso para abrir as fichas da mesa.' : 'Aguarde o Mestre cadastrar sua ficha.'}</p>
          ${isMaster ? '<button class="bt" data-act="go-admin">Cadastrar Jogadores</button>' : ''}
        </section>
      `;
      return;
    }

    const isLocked = !isMaster && !!S.lock;
    let n = 0;
    const d = () => ' style="--d:' + (0.05 + n++ * 0.06).toFixed(2) + 's"';

    document.getElementById('bgi').style.backgroundImage = S.bg ? 'url("' + S.bg + '")' : '';

    const masterStrip = isMaster
      ? '<div class="master-strip">' +
          '<div class="player-tabs">' +
            DATA.map(p =>
              '<button class="bt ' + (p.id === cid ? 'on' : '') + '" data-act="sel-player" data-id="' + p.id + '">' +
                esc(p.sheet.name || p.name) +
              '</button>'
            ).join('') +
          '</div>' +
          '<button class="bt ' + (S.lock ? 'sure' : '') + '" data-act="toggle-lock">' +
            (S.lock ? '🔒 Atributos Travados' : '🔓 Travar Atributos') +
          '</button>' +
        '</div>'
      : '';

    const hero =
      '<header class="pn hd rise"' + d() + '>' +
        '<div class="av" data-act="img" data-p="avatar" role="button" tabindex="0" aria-label="Trocar retrato">' +
          imgOr(S.avatar, 'skull', 'Retrato', 'sw') +
          '<span class="ov">Trocar imagem</span>' +
        '</div>' +
        '<div class="hi">' +
          '<input class="nm" data-set="name" value="' + esc(S.name) + '" placeholder="Nome do personagem" aria-label="Nome">' +
          '<div class="sub"><input data-set="title" value="' + esc(S.title) + '" placeholder="Ocupação, classe ou título" aria-label="Título"></div>' +
          '<div class="mt"><span>“</span><input data-set="motto" value="' + esc(S.motto) + '" placeholder="Uma frase que o define" aria-label="Frase"><span>”</span></div>' +
        '</div>' +
      '</header>';

    const ban =
      '<section class="pn bn rise"' + d() + ' data-act="img" data-p="banner" role="button" tabindex="0" aria-label="Trocar banner">' +
        (S.banner ? '<img src="' + S.banner + '" alt="">' : '<div class="ph"><div>Clique para adicionar um banner<br><small>png, jpg ou gif</small></div></div>') +
        '<span class="ov">Trocar banner</span>' +
      '</section>';

    const tabs = ['Tudo'].concat(TN).map(t =>
      '<button class="' + (fl === t ? 'on' : '') + '" data-act="fl" data-t="' + t + '">' + t + '</button>'
    ).join('');

    const tiles = S.items.map((s, i) => {
      if (fl !== 'Tudo' && s.t !== fl) return '';
      return (
        '<button class="tile pop' + (+s.q <= 0 ? ' z' : '') + '" style="--tc:' + (TY[s.t] || TY.Outro) + ';--d:' + (i * 0.04).toFixed(2) + 's" data-act="open" data-i="' + i + '">' +
          '<span class="im">' + imgOr(s.img, TIC[s.t] || 'dia', s.n) + (s.dm ? '<b class="dm">' + esc(s.dm) + '</b>' : '') + '</span>' +
          (+s.q !== 1 ? '<b class="q">×' + (+s.q || 0) + '</b>' : '') +
          '<span class="tn">' + esc(s.n || 'Sem nome') + '</span>' +
        '</button>'
      );
    }).join('');

    const inv =
      '<section class="pn pn-wood rise"' + d() + '>' +
        '<h2>' + I(P.cross, 'gw') + 'Inventário <small>' + S.items.length + '</small></h2>' +
        '<div class="tabs">' + tabs + '</div>' +
        '<div class="ig">' + tiles + '<button class="tile add" data-act="addItem" style="--tc:#7a5a58"><span class="im">+</span><span class="tn">Novo item</span></button></div>' +
      '</section>';

    const K = S.skills.length
      ? S.skills.map((s, i) =>
          '<div class="sk">' +
            '<div class="si" data-act="img" data-p="skills.' + i + '.img" role="button" tabindex="0" aria-label="Trocar ícone">' + imgOr(s.img, 'sig', s.n, 'sg') + '</div>' +
            '<div class="sb">' +
              '<div class="r2">' +
                '<input data-set="skills.' + i + '.n" value="' + esc(s.n) + '" placeholder="Nome da habilidade" aria-label="Nome">' +
                '<input data-set="skills.' + i + '.dm" value="' + esc(s.dm) + '" placeholder="Dano" aria-label="Dano">' +
              '</div>' +
              '<textarea rows="2" data-set="skills.' + i + '.d" placeholder="O que faz e como funciona" aria-label="Descrição">' + esc(s.d) + '</textarea>' +
            '</div>' +
            '<div class="sr">' +
              '<label class="cs">Custo <input type="number" min="0" data-set="skills.' + i + '.c" value="' + (s.c || 0) + '" aria-label="Custo"></label>' +
              '<button class="bt" data-act="use" data-i="' + i + '">Usar</button>' +
              '<button class="bt x" data-act="delSk" data-i="' + i + '" aria-label="Remover habilidade">×</button>' +
            '</div>' +
          '</div>'
        ).join('')
      : '<p class="mu">Nenhuma habilidade ainda.</p>';

    const sk =
      '<section class="pn pn-paper rise"' + d() + '>' +
        '<h2>' + I(P.sig, 'sg') + 'Habilidades</h2>' +
        K +
        '<p><button class="bt" data-act="addSk">Nova habilidade</button></p>' +
      '</section>';

    const side =
      '<aside class="col">' +
        '<section class="pn rise"' + d() + '>' +
          '<h2>' + I(P.skull, 'sw') + 'Atributos' + (S.lock ? ' <small>🔒</small>' : '') + '</h2>' +
          S.attrs.map((a, i) =>
            '<div class="at">' +
              '<input class="an" data-set="attrs.' + i + '.0" value="' + esc(a[0]) + '" aria-label="Nome do atributo"' + (isLocked ? ' disabled' : '') + '>' +
              modH(i, a[1]) +
              '<input class="vl" type="number" data-set="attrs.' + i + '.1" value="' + a[1] + '" aria-label="' + esc(a[0]) + '"' + (isLocked ? ' disabled' : '') + '>' +
              (isLocked ? '' : '<button class="bt x" data-act="delAt" data-i="' + i + '" aria-label="Remover atributo">×</button>') +
            '</div>'
          ).join('') +
          '<p class="hint mu">O número ao lado de cada atributo é a vantagem (+) ou a desvantagem (−) que ele dá.</p>' +
          (isLocked ? '' : '<p><button class="bt" data-act="addAt">Novo atributo</button></p>') +
        '</section>' +
        '<section class="pn pn-paper rise"' + d() + '>' +
          '<h2>' + I(P.drop, 'gw') + 'Anotações</h2>' +
          '<textarea rows="9" data-set="notes" placeholder="Escreva o que quiser aqui." aria-label="Anotações">' + esc(S.notes) + '</textarea>' +
        '</section>' +
        (isMaster
          ? '<section class="pn rise"' + d() + '>' +
              '<h2>' + I(P.cross, 'gw') + 'Notas do Mestre</h2>' +
              '<textarea rows="5" data-set="mnotes" placeholder="Segredos ocultos do jogador..." aria-label="Notas do Mestre">' + esc(S.mnotes) + '</textarea>' +
            '</section>'
          : '') +
      '</aside>';

    const ft =
      '<footer class="ft mu">' +
        '<button class="bt" data-act="img" data-p="bg">Plano de fundo</button>' +
        (S.bg ? '<button class="bt" data-act="rmBg">Remover fundo</button>' : '') +
        '<button class="bt' + (sure ? ' sure' : '') + '" data-act="reset">' + (sure ? 'Confirmar: apagar tudo' : 'Limpar ficha') + '</button>' +
        '<button class="bt" data-act="save-now">Salvar agora</button>' +
        '<span id="sync-txt">' + esc(savingState) + '</span>' +
      '</footer>';

    app.innerHTML = masterStrip + '<div class="col">' + hero + ban + '<div class="vts">' + vital('hp', d()) + vital('st', d()) + '</div>' + inv + sk + '</div>' + side + ft;

    setTimeout(() => {
      paint('hp');
      paint('st');
    }, booted ? 0 : 350);

    if (!booted) {
      booted = 1;
      setTimeout(() => app.classList.add('booted'), 1600);
    }
  }

  // --- PAINEL DO MESTRE (GERENCIAR JOGADORES) ---
  function renderAdmin() {
    app.innerHTML = `
      <div class="adm-wrap">
        <section class="pn pn-paper rise">
          <h2>${I(P.cross, 'gw')}Novo Jogador</h2>
          <form id="adm-form" style="display:grid;gap:12px;">
            <div>
              <label class="mu" style="font-size:.85rem;">Nome do Jogador</label>
              <input id="adm-name" placeholder="Ex: Arthur" required>
            </div>
            <div>
              <label class="mu" style="font-size:.85rem;">Código de Acesso (PIN)</label>
              <input id="adm-pin" placeholder="Ex: arthur123" required>
            </div>
            <button type="submit" class="bt">Cadastrar na Mesa</button>
          </form>
        </section>

        <section class="pn rise">
          <h2>${I(P.skull, 'sw')}Jogadores da Mesa <small>${DATA.length}</small></h2>
          ${DATA.length
            ? DATA.map(p => `
                <div class="adm-row">
                  <div>
                    <strong style="font:400 1.15rem var(--hd);letter-spacing:.05em;color:#f6e2a8;">${esc(p.name)}</strong>
                    <div style="margin-top:4px;display:flex;gap:8px;align-items:center;">
                      <span class="mu" style="font-size:.85rem;">Código:</span>
                      <span class="pin-tag">${esc(p.pin || '—')}</span>
                    </div>
                  </div>
                  <div style="display:flex;gap:6px;">
                    <button class="bt" data-act="open-player-sheet" data-id="${p.id}">Abrir Ficha</button>
                    <button class="bt x" data-act="del-player" data-id="${p.id}" data-name="${esc(p.name)}" title="Remover">×</button>
                  </div>
                </div>
              `).join('')
            : '<p class="mu">Nenhum jogador cadastrado ainda.</p>'
          }
        </section>
      </div>
    `;

    document.getElementById('adm-form').onsubmit = e => {
      e.preventDefault();
      const name = document.getElementById('adm-name').value.trim();
      const pin = document.getElementById('adm-pin').value.trim();
      if (!name || !pin) return;

      api('players', 'POST', { name, pin })
        .then(() => {
          toast('Jogador cadastrado!');
          loadAll();
        })
        .catch(err => toast(err.message));
    };
  }

  // --- MODAL DO ITEM ---
  function openItem(i) {
    oi = i;
    const s = S.items[i];
    const p = 'items.' + i;
    md.innerHTML =
      '<div class="box pn">' +
        '<button class="bt x cl" data-act="close" aria-label="Fechar">×</button>' +
        '<div class="mrow">' +
          '<div class="mimg" data-act="img" data-p="' + p + '.img" role="button" tabindex="0" aria-label="Trocar imagem">' +
            imgOr(s.img, TIC[s.t] || 'dia', s.n) +
            '<span class="ov">Trocar imagem</span>' +
          '</div>' +
          '<div class="mf">' +
            '<input class="mn" data-set="' + p + '.n" value="' + esc(s.n) + '" placeholder="Nome do item" aria-label="Nome do item">' +
            '<select data-set="' + p + '.t" aria-label="Tipo">' +
              TN.map(t => '<option' + (t === s.t ? ' selected' : '') + '>' + t + '</option>').join('') +
            '</select>' +
            '<div class="qty">' +
              '<button class="bt" data-act="q" data-n="-1" aria-label="Menos">−</button>' +
              '<input type="number" min="0" data-set="' + p + '.q" value="' + (+s.q || 0) + '" aria-label="Quantidade">' +
              '<button class="bt" data-act="q" data-n="1" aria-label="Mais">+</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="r2" style="grid-template-columns:1fr 1.6fr">' +
          '<input data-set="' + p + '.dm" value="' + esc(s.dm) + '" placeholder="Dano" aria-label="Dano">' +
          '<input data-set="' + p + '.dt" value="' + esc(s.dt) + '" placeholder="Tipo, alcance ou efeito do dano" aria-label="Tipo de dano">' +
        '</div>' +
        '<textarea rows="4" data-set="' + p + '.d" placeholder="Descrição" aria-label="Descrição">' + esc(s.d) + '</textarea>' +
        '<div class="ctl">' +
          (s.img ? '<button class="bt" data-act="rmImg">Remover imagem</button>' : '') +
          '<button class="bt" data-act="delItem">Excluir item</button>' +
        '</div>' +
      '</div>';

    requestAnimationFrame(() => md.classList.add('on'));
  }

  function closeItem() {
    if (oi < 0) return;
    oi = -1;
    md.classList.remove('on');
    flush();
    render();
  }

  // --- EVENTOS GLOBAIS ---
  pick.addEventListener('change', () => {
    const f = pick.files && pick.files[0];
    const p = pend;
    pick.value = '';
    pend = null;
    if (!f || !p) return;
    if (f.size > 10e6) {
      toast('Imagem muito grande (máximo 10 MB).');
      return;
    }
    compressImage(f, p, dataUrl => {
      setPath(p, dataUrl);
      flush();
      render();
      if (oi >= 0) openItem(oi);
    });
  });

  document.addEventListener('input', e => {
    const t = e.target;
    const p = t.dataset && t.dataset.set;
    if (!p) return;
    let v = t.value;
    if (t.type === 'number') {
      v = parseFloat(v);
      if (isNaN(v) || (v < 0 && !/^attrs/.test(p))) v = 0;
    }
    setPath(p, v);
    save();

    let m = /^(hp|st|sn)\.[cmx]$/.exec(p);
    if (m) fix(m[1]);

    m = /^attrs\.(\d+)\.1$/.exec(p);
    if (m) {
      const el = document.querySelector('[data-mod="' + m[1] + '"]');
      if (el) {
        const q = mod(v);
        el.textContent = sg(q);
        el.className = 'mod ' + (q > 0 ? 'pos' : q < 0 ? 'neg' : '');
      }
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeItem();
    else if (e.key === 'Enter' && e.target.getAttribute && e.target.getAttribute('role') === 'button') {
      e.target.click();
    }
  });

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b === md && e.target !== md) return;

    const a = b.dataset.act;
    const i = +b.dataset.i;
    const k = b.dataset.k;
    let v;
    let n;

    switch (a) {
      case 'go-sheet':
        view = 'sheet';
        renderNav();
        render();
        break;
      case 'go-admin':
        view = 'admin';
        renderNav();
        renderAdmin();
        break;
      case 'logout':
        sessionStorage.removeItem('fk');
        KEY = '';
        ME = null;
        renderLogin();
        break;
      case 'sel-player': {
        if (st0) flush();
        cid = b.dataset.id;
        const found = DATA.find(p => p.id === cid);
        if (found) S = found.sheet;
        render();
        break;
      }
      case 'open-player-sheet': {
        cid = b.dataset.id;
        const found = DATA.find(p => p.id === cid);
        if (found) S = found.sheet;
        view = 'sheet';
        renderNav();
        render();
        break;
      }
      case 'del-player': {
        const pid = b.dataset.id;
        const pname = b.dataset.name;
        if (!confirm('Remover "' + pname + '" e apagar permanentemente a ficha?')) return;
        api('players/' + pid, 'DELETE')
          .then(() => {
            toast('Jogador removido.');
            loadAll();
          })
          .catch(err => toast(err.message));
        break;
      }
      case 'toggle-lock':
        S.lock = !S.lock;
        flush();
        render();
        toast(S.lock ? 'Atributos travados para o jogador.' : 'Atributos destravados.');
        break;
      case 'save-now':
        flush();
        toast('Ficha salva na nuvem.');
        break;
      case 'img':
        pend = b.dataset.p;
        pick.click();
        break;
      case 'dmg':
        v = S[k];
        n = amt(k);
        if (k === 'hp' && v.x > 0) {
          const ab = Math.min(v.x, n);
          v.x -= ab;
          n -= ab;
        }
        v.c = Math.max(0, v.c - n);
        sync(k);
        break;
      case 'heal':
        v = S[k];
        v.c = Math.min(v.m, v.c + amt(k));
        sync(k);
        break;
      case 'xtra':
        S.hp.x = (S.hp.x || 0) + amt('hp');
        sync('hp');
        break;
      case 'fl':
        fl = b.dataset.t;
        render();
        break;
      case 'open':
        openItem(i);
        break;
      case 'addItem':
        S.items.push({ n: '', q: 1, t: 'Outro', d: '', dm: '', dt: '' });
        save();
        render();
        openItem(S.items.length - 1);
        break;
      case 'close':
        closeItem();
        break;
      case 'q':
        v = S.items[oi];
        v.q = Math.max(0, (+v.q || 0) + (+b.dataset.n));
        md.querySelector('[data-set$=".q"]').value = v.q;
        save();
        break;
      case 'rmImg':
        delete S.items[oi].img;
        flush();
        render();
        openItem(oi);
        break;
      case 'delItem':
        S.items.splice(oi, 1);
        oi = -1;
        md.classList.remove('on');
        flush();
        render();
        break;
      case 'addSk':
        S.skills.push({ n: '', c: 0, dm: '', d: '', img: '' });
        save();
        render();
        break;
      case 'delSk':
        S.skills.splice(i, 1);
        save();
        render();
        break;
      case 'addAt':
        S.attrs.push(['', 0]);
        save();
        render();
        break;
      case 'delAt':
        S.attrs.splice(i, 1);
        save();
        render();
        break;
      case 'use':
        v = S.skills[i];
        n = +v.c || 0;
        if (S.st.c < n) {
          toast('Não há ' + (S.st.n || 'Stamina') + ' suficiente para ' + (v.n || 'a habilidade') + '.');
          break;
        }
        S.st.c -= n;
        sync('st');
        toast('Usou ' + (v.n || 'habilidade') + (n ? ' (−' + n + ')' : ''));
        break;
      case 'rmBg':
        S.bg = '';
        flush();
        render();
        break;
      case 'reset':
        if (!sure) {
          sure = 1;
          setTimeout(() => {
            sure = 0;
            render();
          }, 4000);
          render();
        } else {
          sure = 0;
          const keepLock = S.lock;
          const keepMnotes = S.mnotes;
          S = cl(D);
          S.lock = keepLock;
          S.mnotes = keepMnotes;
          const active = DATA.find(p => p.id === cid);
          if (active) active.sheet = S;
          flush();
          render();
          toast('Ficha limpa.');
        }
        break;
    }
  });

  // --- PARTÍCULAS E GOTAS DE SANGUE ---
  const cv = document.getElementById('cv');
  const cx = cv.getContext('2d');
  let W;
  let H;
  let M = [];
  const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mk(i) {
    return {
      x: Math.random() * W,
      y: i ? Math.random() * H : H + 8,
      r: 0.6 + Math.random() * 1.6,
      v: 0.15 + Math.random() * 0.4,
      p: Math.random() * 6.28,
      a: 0.2 + Math.random() * 0.4
    };
  }

  function sz() {
    const r = devicePixelRatio || 1;
    W = innerWidth;
    H = innerHeight;
    cv.width = W * r;
    cv.height = H * r;
    cx.setTransform(r, 0, 0, r, 0, 0);
    M = [];
    for (let i = 0; i < Math.min(45, (W * H) / 26000); i++) M.push(mk(1));
  }

  function fr(t) {
    cx.clearRect(0, 0, W, H);
    M.forEach(m => {
      m.y -= m.v;
      m.x += Math.sin(t / 1700 + m.p) * 0.3;
      if (m.y < -8) Object.assign(m, mk(0));
      cx.fillStyle =
        'rgba(226,58,70,' +
        (m.a * (0.5 + 0.5 * Math.sin(t / 800 + m.p)) * Math.min(1, m.y / H + 0.2)).toFixed(3) +
        ')';
      cx.beginPath();
      cx.arc(m.x, m.y, m.r, 0, 6.283);
      cx.fill();
    });
    if (!rm) requestAnimationFrame(fr);
  }

  sz();
  requestAnimationFrame(fr);
  addEventListener('resize', sz);

  let dh = '';
  for (let j = 0; j < 8; j++) {
    dh +=
      '<i class="dr" style="left:' +
      (5 + Math.random() * 90).toFixed(1) +
      '%;--t:' +
      (6 + Math.random() * 6).toFixed(1) +
      's;--dl:' +
      (Math.random() * 9).toFixed(1) +
      's"></i>';
  }
  document.getElementById('drips').innerHTML = dh;

  boot();
})();
