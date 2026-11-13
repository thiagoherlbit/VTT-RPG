(function () {
  'use strict';

  var V0 = function (n) { return { n: n, c: 0, m: 0 }; };
  var D = {
    name: '',
    title: '',
    motto: '',
    notes: '',
    mnotes: '',
    lock: false,
    speed: 9,
    attrs: [
      ['Força', 0],
      ['Destreza', 0],
      ['Constituição', 0],
      ['Inteligência', 0],
      ['Presença', 0]
    ],
    hp: { n: 'Vida', c: 0, m: 0, x: 0 },
    st: V0('Stamina'),
    avatar: '',
    banner: '',
    bg: '',
    skills: [],
    items: []
  };

  var TY = {
    'Arma': '#d1303c',
    'Relíquia': '#d8b45a',
    'Consumível': '#4fa36b',
    'Munição': '#6f8fb8',
    'Outro': '#8a7f7c'
  };
  var TN = Object.keys(TY);

  function I(p, c) {
    return '<svg class="ic' + (c ? ' ' + c : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>';
  }

  var P = {
    cross: '<path d="M12 2v20M5 8h14"/>',
    drop: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>',
    dag: '<path d="M12 2l3 11-3 3-3-3z"/><path d="M7 16h10M12 16v6"/>',
    bul: '<path d="M9 21V10c0-4 1.5-6 3-7 1.5 1 3 3 3 7v11zM9 17h6"/>',
    dia: '<path d="M12 3l8 9-8 9-4-4.5L4 12z"/>',
    skull: '<path d="M12 3a8 8 0 0 0-8 8c0 3 1.5 4.5 3 5.5V20h10v-3.5c1.5-1 3-2.5 3-5.5a8 8 0 0 0-8-8z"/><circle cx="9" cy="11" r="1.8"/><circle cx="15" cy="11" r="1.8"/><path d="M12 14v2M10 20v-2M14 20v-2"/>',
    heart: '<path d="M12 21s-8-5.5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 10c0 5.5-8 11-8 11z"/>',
    flame: '<path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle class="pu" cx="12" cy="12" r="2.8"/>',
    sig: '<circle cx="12" cy="12" r="9.5"/><path d="M12 3l5.3 16.3L3.4 9.2h17.2L6.7 19.3z"/>'
  };

  var TIC = {
    'Arma': 'dag',
    'Relíquia': 'cross',
    'Consumível': 'drop',
    'Munição': 'bul',
    'Outro': 'dia'
  };

  var VI = {
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

  function sg(n) { return (n > 0 ? '+' : '') + n; }

  function modH(i, v) {
    var m = mod(v);
    return '<small class="mod ' + (m > 0 ? 'pos' : m < 0 ? 'neg' : '') + '" data-mod="' + i + '" data-act="roll-attr" data-i="' + i + '" title="Clique para rolar 1d20 com este bônus">' + sg(m) + '</small>';
  }

  function cl(o) { return JSON.parse(JSON.stringify(o)); }

  var KEY = sessionStorage.getItem('fk') || '';
  var ME = null;
  var DATA = [];
  var cid = '';
  var adm = 0; // 0 = ficha, 1 = gerenciar jogadores
  var S = cl(D);
  var oi = -1;
  var fl = 'Tudo';
  var pend = null;
  var tt = 0;
  var st0 = 0;
  var booted = 0;

  var app = document.getElementById('app');
  var md = document.getElementById('md');
  var pick = document.getElementById('pick');
  var te = document.getElementById('toast');
  var nv = document.getElementById('nv');
  var sbar = document.getElementById('sheet-bar');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function toast(m) {
    if (!te) return;
    te.textContent = m;
    te.classList.add('on');
    clearTimeout(tt);
    tt = setTimeout(function () { te.classList.remove('on'); }, 3000);
  }

  function imgOr(s, ic, a, c) {
    return s ? '<img src="' + esc(s) + '" alt="' + esc(a) + '">' : I(P[ic], c);
  }

  function api(path, method, body) {
    return fetch('/api/' + path, {
      method: method || 'GET',
      headers: {
        'content-type': 'application/json',
        'x-key': KEY
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Erro na requisição');
        return j;
      });
    });
  }

  function normalizeSheet(raw, fallbackName) {
    var base = cl(D);
    base.name = fallbackName || '';
    if (!raw || typeof raw !== 'object') return base;

    var out = Object.assign({}, base, raw);
    if (!out.name && fallbackName) out.name = fallbackName;

    if (typeof raw.hp === 'number') {
      out.hp = { n: 'Vida', c: raw.hp, m: Number(raw.mhp) || raw.hp || 20, x: Number(raw.tempHp) || 0 };
    } else {
      out.hp = Object.assign(cl(D.hp), raw.hp || {});
    }

    if (typeof raw.st === 'number') {
      out.st = { n: 'Stamina', c: raw.st, m: Number(raw.mst) || raw.st || 10 };
    } else {
      out.st = Object.assign(V0('Stamina'), raw.st || {});
    }

    if (raw.attrs && !Array.isArray(raw.attrs) && typeof raw.attrs === 'object') {
      out.attrs = Object.keys(raw.attrs).map(function (k) { return [k, Number(raw.attrs[k]) || 0]; });
    } else if (Array.isArray(raw.attrs)) {
      out.attrs = raw.attrs;
    }

    if (!Array.isArray(out.items) && Array.isArray(raw.inventory)) {
      out.items = raw.inventory.map(function (it) {
        return {
          n: it.name || it.n || '',
          q: Number(it.qty || it.q) || 1,
          t: it.t || 'Outro',
          d: it.desc || it.d || '',
          dm: it.dm || '',
          dt: it.dt || '',
          img: it.img || ''
        };
      });
    } else if (!Array.isArray(out.items)) {
      out.items = [];
    }

    if (Array.isArray(raw.skills)) {
      out.skills = raw.skills.map(function (sk) {
        if (sk.n !== undefined) return sk;
        return {
          n: sk.name || '',
          c: parseInt(String(sk.cost || '0').replace(/\D+/g, ''), 10) || 0,
          dm: sk.dm || '',
          d: sk.desc || '',
          img: sk.img || ''
        };
      });
    } else {
      out.skills = [];
    }

    if (!out.bg && raw.pageBg) out.bg = raw.pageBg;
    return out;
  }

  function setSyncState(pending) {
    var dot = document.getElementById('sync-dot');
    var txt = document.getElementById('sync-txt');
    if (dot) dot.classList.toggle('pending', !!pending);
    if (txt) txt.textContent = pending ? 'Salvando no grimório...' : 'Salvo no servidor';
  }

  function flush(showToast) {
    clearTimeout(st0);
    if (!cid || !ME) return;
    setSyncState(true);
    var entry = DATA.find(function (p) { return p.id === cid; });
    if (entry) entry.sheet = cl(S);

    api('sheet/' + cid, 'PUT', S).then(function () {
      setSyncState(false);
      if (showToast) toast('Ficha salva no grimório!');
    }).catch(function (e) {
      toast(e.message);
    });
  }

  function save() {
    clearTimeout(st0);
    setSyncState(true);
    st0 = setTimeout(function () { flush(false); }, 650);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) flush(false);
  });

  function setPath(p, v) {
    var k = p.split('.'), o = S, i;
    for (i = 0; i < k.length - 1; i++) o = o[k[i]];
    o[k[k.length - 1]] = v;
  }

  function vital(k, d) {
    var v = S[k], hp = k === 'hp', L = v.n || VI[k][1], b = VI[k][2];
    return '<section class="pn rise" data-v="' + k + '"' + d + '>' +
      '<h2>' + VI[k][0] + '<input class="vn" data-set="' + k + '.n" value="' + esc(L) + '" aria-label="Nome da barra"></h2>' +
      '<div class="nums"><input type="number" min="0" data-set="' + k + '.c" value="' + v.c + '" aria-label="' + esc(L) + ' atual"><span>/</span><input type="number" min="0" data-set="' + k + '.m" value="' + v.m + '" aria-label="' + esc(L) + ' máxima"></div>' +
      (hp ? '<svg class="ecg" viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,12 30,12 36,12 40,3 46,21 51,12 80,12 86,8 90,12 120,12"/></svg>' : '') +
      '<div class="bar b1"><i></i></div>' +
      (hp ? '<div class="xr"><label>Vida extra <input type="number" min="0" data-set="hp.x" value="' + (v.x || 0) + '"></label></div><div class="bar b2"><i></i></div>' : '') +
      '<div class="ctl"><input type="number" min="1" value="1" data-amt="' + k + '" aria-label="Valor"><button class="bt" data-act="dmg" data-k="' + k + '">' + b[0] + '</button><button class="bt" data-act="heal" data-k="' + k + '">' + b[1] + '</button>' + (hp ? '<button class="bt" data-act="xtra">+ Extra</button>' : '') + '</div>' +
      (v.m > 0 ? '' : '<p class="hint mu">Defina o máximo primeiro.</p>') +
      '</section>';
  }

  function paint(k) {
    var s = document.querySelector('[data-v="' + k + '"]');
    if (!s) return;
    var v = S[k], m = v.m > 0 ? v.m : 0;
    s.querySelector('.b1 i').style.width = (m ? Math.min(100, v.c / m * 100) : 0) + '%';
    var b = s.querySelector('.b2 i');
    if (b) b.style.width = (m ? Math.min(100, (v.x || 0) / m * 100) : 0) + '%';
    s.classList.toggle('low', m > 0 && v.c / m <= 0.3);
  }

  function sync(k) {
    var v = S[k];
    ['c', 'm', 'x'].forEach(function (f) {
      var e = document.querySelector('[data-set="' + k + '.' + f + '"]');
      if (e && v[f] !== undefined && +e.value !== v[f]) e.value = v[f];
    });
    paint(k);
    save();
  }

  function fix(k) {
    var v = S[k];
    v.m = Math.max(0, v.m || 0);
    v.c = Math.max(0, Math.min(v.c || 0, v.m));
    if (k === 'hp') v.x = Math.max(0, v.x || 0);
    sync(k);
  }

  function amt(k) {
    var e = document.querySelector('[data-amt="' + k + '"]');
    return Math.max(1, parseInt(e && e.value, 10) || 1);
  }

  function renderNav() {
    if (!nv) return;
    if (!ME) {
      nv.hidden = true;
      return;
    }
    nv.hidden = false;
    var isMaster = ME.role === 'master';
    nv.innerHTML =
      '<span class="tag">' + (isMaster ? '👑 Mestre' : '🗡️ ' + esc(ME.name)) + '</span>' +
      '<button class="bt ' + (adm === 0 ? 'on' : '') + '" data-act="nav-sheet">' + (isMaster ? '📜 Fichas' : '📜 Minha Ficha') + '</button>' +
      (isMaster ? '<button class="bt ' + (adm === 1 ? 'on' : '') + '" data-act="nav-admin">👥 Gerenciar Jogadores</button>' : '') +
      '<button class="bt" data-vtt-nav="table">🗺️ Mesa (Mapa)</button>' +
      (isMaster ? '<button class="bt" data-vtt-nav="library">📚 Mapas &amp; NPCs</button>' : '') +
      '<button class="bt" data-act="nav-logout">Sair</button>';
  }

  function renderSheetBar() {
    if (!sbar) return;
    if (!ME || adm !== 0 || !DATA.length) {
      sbar.hidden = true;
      return;
    }
    sbar.hidden = false;
    var isMaster = ME.role === 'master';
    sbar.innerHTML =
      '<div class="tabs-row">' +
      (isMaster
        ? DATA.map(function (p) {
            return '<button class="bt ' + (p.id === cid ? 'on' : '') + '" data-act="sel-player" data-id="' + p.id + '">' + esc((p.sheet && p.sheet.name) || p.name) + '</button>';
          }).join('')
        : '<span class="tag">Registro de ' + esc(ME.name) + '</span>') +
      (S.lock ? '<span class="tag">🔒 Atributos Travados</span>' : '') +
      '</div>' +
      '<div class="tabs-row">' +
      '<span class="sync-pill"><span class="sync-dot" id="sync-dot"></span><span id="sync-txt">Salvo no servidor</span></span>' +
      (isMaster ? '<button class="bt" data-act="toggle-lock">' + (S.lock ? '🔓 Destravar' : '🔒 Travar') + '</button>' : '') +
      '<button class="bt" data-act="save-now">Salvar Agora</button>' +
      '</div>';
  }

  function renderLogin(errMsg) {
    if (nv) nv.hidden = true;
    if (sbar) sbar.hidden = true;
    document.getElementById('bgi').style.backgroundImage = '';
    app.className = 'wrap single';
    app.innerHTML =
      '<section class="pn paper-pn stamp rise" style="max-width:420px; margin:12vh auto 0; padding:28px 24px;">' +
      '<h2>' + I(P.cross, 'gw') + 'Acesso ao Grimório</h2>' +
      '<p class="mu" style="margin:0 0 14px;">Informe seu código de acesso de jogador ou a chave do Mestre.</p>' +
      '<form id="login-form" style="display:grid; gap:12px;">' +
      '<div style="display:flex; gap:6px;">' +
      '<input id="lk" type="password" autocomplete="current-password" placeholder="Código de acesso" required>' +
      '<button type="button" class="bt x" id="pw-eye" title="Mostrar ou ocultar">👁️</button>' +
      '</div>' +
      '<button type="submit" class="bt">Entrar na Mesa</button>' +
      '</form>' +
      (errMsg ? '<p style="color:#8f111c; font-family:var(--tp); font-size:.86rem; margin:12px 0 0;">' + esc(errMsg) + '</p>' : '') +
      '</section>';

    var lk = document.getElementById('lk');
    var eye = document.getElementById('pw-eye');
    var form = document.getElementById('login-form');
    lk.focus();
    eye.onclick = function () { lk.type = lk.type === 'password' ? 'text' : 'password'; };
    form.onsubmit = function (e) {
      e.preventDefault();
      var v = lk.value.trim();
      if (!v) return;
      KEY = v;
      sessionStorage.setItem('fk', KEY);
      boot();
    };
  }

  function renderAdmin() {
    renderSheetBar();
    document.getElementById('bgi').style.backgroundImage = '';
    app.className = 'wrap single';
    app.innerHTML =
      '<div class="adm-grid">' +
      '<section class="pn paper-pn rise">' +
      '<h2>' + I(P.cross, 'gw') + 'Novo Jogador</h2>' +
      '<form id="adm-add-form" style="display:grid; gap:12px;">' +
      '<div><label class="lab">Nome do Jogador</label><input id="adm-name" placeholder="Ex: Lucas" required></div>' +
      '<div><label class="lab">Código de Acesso (PIN)</label><input id="adm-pin" placeholder="Ex: lucas123" required></div>' +
      '<button type="submit" class="bt">Cadastrar Jogador</button>' +
      '</form>' +
      '</section>' +
      '<section class="pn rise">' +
      '<h2>' + I(P.skull, 'sw') + 'Jogadores da Mesa <small>' + DATA.length + '</small></h2>' +
      (DATA.length
        ? DATA.map(function (p) {
            return '<div class="adm-row">' +
              '<div><strong>' + esc(p.name) + '</strong> <span class="pin-tag">' + esc(p.pin || '—') + '</span></div>' +
              '<div style="display:flex; gap:6px;">' +
              '<button class="bt" data-act="open-player-sheet" data-id="' + p.id + '">Abrir Ficha</button>' +
              '<button class="bt x" data-act="del-player" data-id="' + p.id + '" data-name="' + esc(p.name) + '" title="Remover">×</button>' +
              '</div>' +
              '</div>';
          }).join('')
        : '<p class="mu">Nenhum jogador cadastrado ainda.</p>') +
      '</section>' +
      '</div>';

    document.getElementById('adm-add-form').onsubmit = function (e) {
      e.preventDefault();
      var name = document.getElementById('adm-name').value.trim();
      var pin = document.getElementById('adm-pin').value.trim();
      if (!name || !pin) return;
      api('players', 'POST', { name: name, pin: pin }).then(function () {
        toast('Jogador cadastrado!');
        loadState();
      }).catch(function (err) { toast(err.message); });
    };
  }

  function render() {
    if (!ME) return;
    if (adm === 1 && ME.role === 'master') {
      renderAdmin();
      return;
    }

    var isMaster = ME.role === 'master';
    if (!DATA.length) {
      renderSheetBar();
      app.className = 'wrap single';
      app.innerHTML =
        '<section class="pn paper-pn stamp rise" style="max-width:480px; margin:8vh auto 0; text-align:center; padding:30px;">' +
        '<h2>Nenhum Registro Encontrado</h2>' +
        '<p class="mu">' + (isMaster ? 'Cadastre os jogadores para liberar as fichas da mesa.' : 'Aguarde o Mestre liberar sua ficha.') + '</p>' +
        (isMaster ? '<p><button class="bt" data-act="nav-admin">Cadastrar Jogadores</button></p>' : '') +
        '</section>';
      return;
    }

    var entry = DATA.find(function (p) { return p.id === cid; }) || DATA[0];
    cid = entry.id;
    S = normalizeSheet(entry.sheet, entry.name);
    var lockedForPlayer = !isMaster && !!S.lock;

    renderSheetBar();
    app.className = 'wrap';

    var n = 0;
    var d = function () { return ' style="--d:' + (0.05 + n++ * 0.06).toFixed(2) + 's"'; };
    document.getElementById('bgi').style.backgroundImage = S.bg ? 'url("' + String(S.bg).replace(/"/g, '%22') + '")' : '';

    var hero =
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

    var ban =
      '<section class="pn bn rise"' + d() + ' data-act="img" data-p="banner" role="button" tabindex="0" aria-label="Trocar banner">' +
      (S.banner ? '<img src="' + esc(S.banner) + '" alt="">' : '<div class="ph"><div>Clique para adicionar um banner<br><small>png, jpg ou gif</small></div></div>') +
      '<span class="ov">Trocar banner</span>' +
      '</section>';

    var tabs = ['Tudo'].concat(TN).map(function (t) {
      return '<button class="' + (fl === t ? 'on' : '') + '" data-act="fl" data-t="' + t + '">' + t + '</button>';
    }).join('');

    var tiles = S.items.map(function (s, i) {
      if (fl !== 'Tudo' && s.t !== fl) return '';
      return '<button class="tile pop' + (+s.q <= 0 ? ' z' : '') + '" style="--tc:' + (TY[s.t] || TY.Outro) + ';--d:' + (i * 0.04).toFixed(2) + 's" data-act="open" data-i="' + i + '">' +
        '<span class="im">' + imgOr(s.img, TIC[s.t] || 'dia', s.n) + (s.dm ? '<b class="dm">' + esc(s.dm) + '</b>' : '') + '</span>' +
        (+s.q !== 1 ? '<b class="q">×' + (+s.q || 0) + '</b>' : '') +
        '<span class="tn">' + esc(s.n || 'Sem nome') + '</span>' +
        '</button>';
    }).join('');

    var inv =
      '<section class="pn rise"' + d() + '>' +
      '<h2>' + I(P.cross, 'gw') + 'Inventário <small>' + S.items.length + '</small></h2>' +
      '<div class="tabs">' + tabs + '</div>' +
      '<div class="ig">' + tiles + '<button class="tile add" data-act="addItem" style="--tc:#7a5a58"><span class="im">+</span><span class="tn">Novo item</span></button></div>' +
      '</section>';

    var K = S.skills.length
      ? S.skills.map(function (s, i) {
          return '<div class="sk">' +
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
            '<button class="bt x" data-act="roll-dm" data-i="' + i + '" title="Rolar dano">🎲</button>' +
            '<button class="bt" data-act="use" data-i="' + i + '">Usar</button>' +
            '<button class="bt x" data-act="delSk" data-i="' + i + '" aria-label="Remover habilidade">×</button>' +
            '</div>' +
            '</div>';
        }).join('')
      : '<p class="mu">Nenhuma habilidade ainda.</p>';

    var sk =
      '<section class="pn rise"' + d() + '>' +
      '<h2>' + I(P.sig, 'sg') + 'Habilidades</h2>' +
      K +
      '<p><button class="bt" data-act="addSk">Nova habilidade</button></p>' +
      '</section>';

    var side =
      '<aside class="col">' +
      '<section class="pn rise"' + d() + '>' +
      '<h2>' + I(P.skull, 'sw') + 'Atributos</h2>' +
      S.attrs.map(function (a, i) {
        return '<div class="at">' +
          '<input class="an" data-set="attrs.' + i + '.0" value="' + esc(a[0]) + '" aria-label="Nome do atributo" ' + (lockedForPlayer ? 'disabled' : '') + '>' +
          modH(i, a[1]) +
          '<input class="vl" type="number" data-set="attrs.' + i + '.1" value="' + a[1] + '" aria-label="' + esc(a[0]) + '" ' + (lockedForPlayer ? 'disabled' : '') + '>' +
          (lockedForPlayer ? '' : '<button class="bt x" data-act="delAt" data-i="' + i + '" aria-label="Remover atributo">×</button>') +
          '</div>';
      }).join('') +
      '<div class="at"><input class="an" value="Movimento (m)" disabled aria-label="Movimento por turno em metros"><span></span><input class="vl" type="number" min="0" step="0.5" data-set="speed" value="' + (S.speed == null ? 9 : S.speed) + '" aria-label="Movimento em metros"></div>' +
      '<p class="hint mu">O número ao lado de cada atributo é a vantagem (+) ou a desvantagem (−) que ele dá.</p>' +
      (lockedForPlayer ? '' : '<p><button class="bt" data-act="addAt">Novo atributo</button></p>') +
      '</section>' +
      '<section class="pn rise"' + d() + '>' +
      '<h2>' + I(P.drop, 'gw') + 'Anotações</h2>' +
      '<textarea rows="9" data-set="notes" placeholder="Escreva o que quiser aqui." aria-label="Anotações">' + esc(S.notes) + '</textarea>' +
      '</section>' +
      (isMaster
        ? '<section class="pn rise"' + d() + '>' +
          '<h2>' + I(P.eye, 'ey') + 'Segredos do Mestre</h2>' +
          '<textarea rows="5" data-set="mnotes" placeholder="Anotações ocultas do jogador..." aria-label="Segredos do Mestre">' + esc(S.mnotes) + '</textarea>' +
          '</section>'
        : '') +
      '</aside>';

    var ft =
      '<footer class="ft mu">' +
      '<button class="bt" data-act="img" data-p="bg">Plano de fundo</button>' +
      (S.bg ? '<button class="bt" data-act="rmBg">Remover fundo</button>' : '') +
      '<button class="bt" data-act="save-now">Salvar agora</button>' +
      '<span>Sincronizado automaticamente com o servidor.</span>' +
      '</footer>';

    app.innerHTML = '<div class="col">' + hero + ban + '<div class="vts">' + vital('hp', d()) + vital('st', d()) + '</div>' + inv + sk + '</div>' + side + ft;

    setTimeout(function () {
      paint('hp');
      paint('st');
    }, booted ? 0 : 350);

    if (!booted) {
      booted = 1;
      setTimeout(function () { app.classList.add('booted'); }, 1600);
    }
  }

  function openItem(i) {
    oi = i;
    var s = S.items[i], p = 'items.' + i;
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
      '<select data-set="' + p + '.t" aria-label="Tipo">' + TN.map(function (t) { return '<option' + (t === s.t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
      '<div class="qty"><button class="bt" data-act="q" data-n="-1" aria-label="Menos">−</button><input type="number" min="0" data-set="' + p + '.q" value="' + (+s.q || 0) + '" aria-label="Quantidade"><button class="bt" data-act="q" data-n="1" aria-label="Mais">+</button></div>' +
      '</div>' +
      '</div>' +
      '<div class="r2" style="grid-template-columns:1fr 1.6fr">' +
      '<input data-set="' + p + '.dm" value="' + esc(s.dm) + '" placeholder="Dano" aria-label="Dano">' +
      '<input data-set="' + p + '.dt" value="' + esc(s.dt) + '" placeholder="Tipo, alcance ou efeito do dano" aria-label="Tipo de dano">' +
      '</div>' +
      '<textarea rows="4" data-set="' + p + '.d" placeholder="Descrição" aria-label="Descrição">' + esc(s.d) + '</textarea>' +
      '<div class="ctl">' + (s.dm ? '<button class="bt" data-act="roll-item">🎲 Rolar dano</button>' : '') + (s.img ? '<button class="bt" data-act="rmImg">Remover imagem</button>' : '') + '<button class="bt" data-act="delItem">Excluir item</button></div>' +
      '</div>';
    requestAnimationFrame(function () { md.classList.add('on'); });
  }

  function closeItem() {
    if (oi < 0) return;
    oi = -1;
    md.classList.remove('on');
    flush(false);
    render();
  }

  function optimizeAndApplyImage(file, targetPath) {
    var r = new FileReader();
    r.onload = function () {
      if (file.type === 'image/gif' && file.size < 450000) {
        setPath(targetPath, r.result);
        flush(false);
        render();
        if (oi >= 0) openItem(oi);
        return;
      }
      var img = new Image();
      img.onload = function () {
        var maxDim = targetPath === 'bg' ? 1280 : targetPath === 'banner' ? 1000 : 320;
        var ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * ratio));
        var h = Math.max(1, Math.round(img.height * ratio));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setPath(targetPath, dataUrl);
        flush(false);
        render();
        if (oi >= 0) openItem(oi);
      };
      img.onerror = function () { toast('Não foi possível processar essa imagem.'); };
      img.src = r.result;
    };
    r.onerror = function () { toast('Não foi possível ler essa imagem.'); };
    r.readAsDataURL(file);
  }

  if (pick) {
    pick.addEventListener('change', function () {
      var f = pick.files && pick.files[0], p = pend;
      pick.value = '';
      pend = null;
      if (!f || !p) return;
      if (f.size > 10e6) {
        toast('Imagem muito grande (máximo 10 MB).');
        return;
      }
      optimizeAndApplyImage(f, p);
    });
  }

  function rollDamage(expression, label) {
    var text = String(expression || '').replace(/\s+/g, '');
    if (!/^\d{0,2}d\d{1,3}([+-]\d{1,3})?$/i.test(text)) {
      toast('Dano inválido. Use algo como 1d8+2.');
      return;
    }
    if (window.Play) {
      window.Play.roll({ expr: text, label: (S.name || 'Personagem') + ' · ' + (label || 'Dano') });
    }
  }

  document.addEventListener('input', function (e) {
    var t = e.target, p = t.dataset && t.dataset.set;
    if (!p) return;
    var v = t.value;
    if (t.type === 'number') {
      v = parseFloat(v);
      if (isNaN(v) || (v < 0 && !/^attrs/.test(p))) v = 0;
    }
    setPath(p, v);
    save();
    var m = /^(hp|st)\.[cmx]$/.exec(p);
    if (m) fix(m[1]);
    m = /^attrs\.(\d+)\.1$/.exec(p);
    if (m) {
      var el = document.querySelector('[data-mod="' + m[1] + '"]');
      if (el) {
        var q = mod(v);
        el.textContent = sg(q);
        el.className = 'mod ' + (q > 0 ? 'pos' : q < 0 ? 'neg' : '');
      }
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeItem();
    else if (e.key === 'Enter' && e.target.getAttribute && e.target.getAttribute('role') === 'button') e.target.click();
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    if (b === md && e.target !== md) return;
    var a = b.dataset.act, i = +b.dataset.i, k = b.dataset.k, v, n;

    switch (a) {
      case 'nav-sheet':
        adm = 0;
        renderNav();
        render();
        break;
      case 'nav-admin':
        adm = 1;
        renderNav();
        renderAdmin();
        break;
      case 'nav-logout':
        sessionStorage.removeItem('fk');
        KEY = '';
        ME = null;
        renderLogin();
        break;
      case 'sel-player':
        flush(false);
        cid = b.dataset.id;
        render();
        break;
      case 'open-player-sheet':
        cid = b.dataset.id;
        adm = 0;
        renderNav();
        render();
        break;
      case 'toggle-lock':
        S.lock = !S.lock;
        flush(false);
        render();
        toast(S.lock ? 'Atributos travados.' : 'Atributos destravados.');
        break;
      case 'save-now':
        flush(true);
        break;
      case 'del-player':
        if (!confirm('Remover "' + b.dataset.name + '" e apagar sua ficha?')) return;
        api('players/' + b.dataset.id, 'DELETE').then(function () {
          toast('Jogador removido.');
          loadState();
        }).catch(function (err) { toast(err.message); });
        break;
      case 'img':
        pend = b.dataset.p;
        pick.click();
        break;
      case 'dmg':
        v = S[k];
        n = amt(k);
        if (k === 'hp' && v.x > 0) {
          var ab = Math.min(v.x, n);
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
        save();
        render();
        openItem(oi);
        break;
      case 'delItem':
        S.items.splice(oi, 1);
        oi = -1;
        md.classList.remove('on');
        flush(false);
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
      case 'roll-attr':
        n = mod(S.attrs[i][1]);
        if (window.Play) {
          window.Play.roll({ expr: '1d20' + (n ? sg(n) : ''), label: (S.name || 'Personagem') + ' · ' + (S.attrs[i][0] || 'Atributo') });
        }
        break;
      case 'roll-dm':
        rollDamage(S.skills[i].dm, S.skills[i].n);
        break;
      case 'roll-item':
        rollDamage(S.items[oi].dm, S.items[oi].n);
        break;
      case 'rmBg':
        S.bg = '';
        flush(false);
        render();
        break;
    }
  });

  function loadState() {
    api('sheets').then(function (r) {
      DATA = (r.players || []).map(function (p) {
        return Object.assign({}, p, { sheet: normalizeSheet(p.sheet, p.name) });
      });
      if (DATA.length && !DATA.some(function (p) { return p.id === cid; })) {
        cid = DATA[0].id;
      }
      renderNav();
      render();
    }).catch(function (err) { toast(err.message); });
  }

  function boot() {
    if (!KEY) {
      renderLogin();
      return;
    }
    api('me').then(function (m) {
      ME = m;
      loadState();
    }).catch(function () {
      ME = null;
      sessionStorage.removeItem('fk');
      KEY = '';
      renderLogin('Código inválido ou sessão expirada.');
    });
  }

  var cv = document.getElementById('cv'), cx = cv.getContext('2d'), W, H, M = [], rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function mk(i) { return { x: Math.random() * W, y: i ? Math.random() * H : H + 8, r: 0.6 + Math.random() * 1.6, v: 0.15 + Math.random() * 0.4, p: Math.random() * 6.28, a: 0.2 + Math.random() * 0.4 }; }
  function sz() {
    var r = devicePixelRatio || 1;
    W = innerWidth;
    H = innerHeight;
    cv.width = W * r;
    cv.height = H * r;
    cx.setTransform(r, 0, 0, r, 0, 0);
    M = [];
    for (var i = 0; i < Math.min(45, W * H / 26000); i++) M.push(mk(1));
  }
  function fr(t) {
    cx.clearRect(0, 0, W, H);
    M.forEach(function (m) {
      m.y -= m.v;
      m.x += Math.sin(t / 1700 + m.p) * 0.3;
      if (m.y < -8) Object.assign(m, mk(0));
      cx.fillStyle = 'rgba(226,58,70,' + (m.a * (0.5 + 0.5 * Math.sin(t / 800 + m.p)) * Math.min(1, m.y / H + 0.2)).toFixed(3) + ')';
      cx.beginPath();
      cx.arc(m.x, m.y, m.r, 0, 6.283);
      cx.fill();
    });
    if (!rm) requestAnimationFrame(fr);
  }
  sz();
  requestAnimationFrame(fr);
  addEventListener('resize', sz);

  var dh = '';
  for (var j = 0; j < 8; j++) {
    dh += '<i class="dr" style="left:' + (5 + Math.random() * 90).toFixed(1) + '%;--t:' + (6 + Math.random() * 6).toFixed(1) + 's;--dl:' + (Math.random() * 9).toFixed(1) + 's"></i>';
  }
  document.getElementById('drips').innerHTML = dh;

  boot();
})();
