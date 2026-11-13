const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-key'
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: CORS });

const defaultMapState = () => ({
  mapId: '',
  name: 'Mesa Principal',
  bg: '',
  grid: 24,
  cellMeters: 1.5,
  fog: { on: false, ops: [] },
  tokens: []
});

const defaultLibrary = () => ({
  maps: [],
  npcs: []
});


const defaultCombat = () => ({ phase: 'idle', round: 0, turn: 0, order: [] });

const DICE_LOG_LIMIT = 60;

const randomInt = (sides) => {
  const buffer = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / sides) * sides;
  let value;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return (value % sides) + 1;
};

const parseDiceExpression = (text) => {
  const clean = String(text || '').toLowerCase().replace(/\s+/g, '');
  const match = clean.match(/^(\d{0,2})d(\d{1,3})([+-]\d{1,3})?$/);
  if (!match) return null;
  const count = match[1] === '' ? 1 : Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;
  if (count < 1 || count > 20 || sides < 2 || sides > 1000) return null;
  return { count, sides, modifier };
};

const formatExpression = ({ count, sides, modifier }) =>
  `${count}d${sides}` + (modifier ? (modifier > 0 ? '+' : '') + modifier : '');

const rollExpression = (parsed, mode) => {
  if (mode && parsed.count === 1 && parsed.sides === 20) {
    const first = randomInt(20);
    const second = randomInt(20);
    const kept = mode === 'adv' ? Math.max(first, second) : Math.min(first, second);
    return { rolls: [first, second], kept: [kept], total: kept + parsed.modifier };
  }
  const rolls = Array.from({ length: parsed.count }, () => randomInt(parsed.sides));
  const sum = rolls.reduce((acc, value) => acc + value, 0);
  return { rolls, kept: rolls, total: sum + parsed.modifier };
};

const abilityModifier = (score) => {
  const value = Number(score) || 0;
  if (value <= 1) return value - 6;
  if (value === 2) return -4;
  if (value === 3) return -3;
  if (value <= 5) return -2;
  if (value <= 8) return -1;
  if (value <= 12) return 0;
  if (value <= 15) return 1;
  if (value <= 17) return 2;
  return value - 15;
};

const dexterityModifier = (sheet) => {
  const attrs = Array.isArray(sheet && sheet.attrs) ? sheet.attrs : [];
  const dexterity = attrs.find((attr) => String(attr[0]).toLowerCase().startsWith('destreza'));
  return dexterity ? abilityModifier(dexterity[1]) : 0;
};

const movementLimitOf = (sheet) => {
  const value = parseFloat(String((sheet && sheet.speed) ?? '').replace(',', '.'));
  return value > 0 ? value : 9;
};

export async function onRequest({ request, env, params }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.RPG || !env.MASTER_KEY) {
    return json({ error: 'Configuração ausente: KV "RPG" ou MASTER_KEY.' }, 500);
  }

  const key = (request.headers.get('x-key') || '').trim();
  const path = [].concat(params.path || []).filter(Boolean);
  const action = path[0] || 'me';
  const sub = path[1] || '';
  const method = request.method;

  const getKV = async (k, fallback) => {
    const raw = await env.RPG.get(k);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };

  const putKV = (k, val) => env.RPG.put(k, JSON.stringify(val));

  let players;
  try {
    players = await getKV('players', []);
  } catch {
    return json({ error: 'Falha ao ler o armazenamento. Tente novamente.' }, 503);
  }
  const isMaster = key === env.MASTER_KEY;
  const currentPlayer = !isMaster ? players.find(p => p.pin === key) : null;

  if (!isMaster && !currentPlayer) {
    return json({ error: 'Código de acesso inválido.' }, 401);
  }

  const actor = { id: isMaster ? 'master' : currentPlayer.id, name: isMaster ? 'Mestre' : currentPlayer.name };

  const recordRoll = async ({ parsed, mode, label, hidden, kind, who }) => {
    const result = rollExpression(parsed, mode);
    const entry = {
      id: crypto.randomUUID(),
      at: Date.now(),
      whoId: (who || actor).id,
      who: (who || actor).name,
      label,
      expr: formatExpression(parsed),
      mode,
      sides: parsed.sides,
      rolls: result.rolls,
      kept: result.kept,
      modifier: parsed.modifier,
      total: result.total,
      hidden,
      kind
    };
    const log = await getKV('dice_log', []);
    log.push(entry);
    await putKV('dice_log', log.slice(-DICE_LOG_LIMIT));
    return entry;
  };

  try {
    if (action === 'me' && method === 'GET') {
      return json({
        role: isMaster ? 'master' : 'player',
        id: currentPlayer ? currentPlayer.id : 'master',
        name: currentPlayer ? currentPlayer.name : 'Mestre'
      });
    }

    if (action === 'sheets' && method === 'GET') {
      const targetPlayers = isMaster ? players : [currentPlayer];
      const enriched = await Promise.all(
        targetPlayers.map(async p => {
          const sheet = await getKV(`sheet:${p.id}`, null);
          return {
            id: p.id,
            name: p.name,
            pin: isMaster ? p.pin : undefined,
            sheet
          };
        })
      );
      return json({ players: enriched });
    }

    if (action === 'sheet' && sub && method === 'PUT') {
      if (!isMaster && currentPlayer.id !== sub) {
        return json({ error: 'Sem permissão para editar esta ficha.' }, 403);
      }
      const body = await request.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json({ error: 'Ficha inválida.' }, 400);
      }
      const existing = await getKV(`sheet:${sub}`, {});
      if (!isMaster && existing && existing.lock) {
        body.attrs = existing.attrs || body.attrs;
        body.level = existing.level ?? body.level;
        body.lock = true;
      }
      if (!isMaster && existing && existing.mnotes !== undefined) {
        body.mnotes = existing.mnotes;
      }
      await putKV(`sheet:${sub}`, body);
      return json({ ok: true });
    }

    if (action === 'players') {
      if (!isMaster) return json({ error: 'Apenas o mestre gerencia jogadores.' }, 403);

      if (method === 'POST') {
        const body = await request.json();
        const name = String(body.name || '').trim().slice(0, 40);
        const pin = String(body.pin || '').trim().slice(0, 40);
        if (!name || !pin) return json({ error: 'Nome e código são obrigatórios.' }, 400);
        if (pin === env.MASTER_KEY || players.some(p => p.pin === pin)) {
          return json({ error: 'Este código já está em uso.' }, 400);
        }
        const id = 'p_' + Date.now().toString(36);
        players.push({ id, name, pin });
        await putKV('players', players);
        return json({ ok: true, id });
      }

      if (method === 'DELETE' && sub) {
        const next = players.filter(p => p.id !== sub);
        await putKV('players', next);
        await env.RPG.delete(`sheet:${sub}`);
        const mapState = await getKV('map_state', defaultMapState());
        mapState.tokens = (mapState.tokens || []).filter(t => t.owner !== sub);
        await putKV('map_state', mapState);
        return json({ ok: true });
      }
    }

    if (action === 'vtt' && sub === 'state' && method === 'GET') {
      const [mapRaw, libRaw, roster] = await Promise.all([
        getKV('map_state', defaultMapState()),
        isMaster ? getKV('vtt_library', defaultLibrary()) : Promise.resolve(defaultLibrary()),
        Promise.all(
          players.map(async p => {
            const s = (await getKV(`sheet:${p.id}`, null)) || {};
            return {
              id: p.id,
              playerName: p.name,
              charName: s.name || p.name,
              avatar: s.avatar || '',
              hp: Number(s.hp ?? 20),
              mhp: Number(s.mhp ?? 20),
              ac: Number(s.ac ?? 10),
              speed: s.speed || '9m'
            };
          })
        )
      ]);

      const map = { ...defaultMapState(), ...mapRaw };
      map.tokens = (map.tokens || []).map(tok => {
        if (tok.kind !== 'player') return tok;
        const pInfo = roster.find(r => r.id === tok.owner);
        if (!pInfo) return tok;
        return {
          ...tok,
          name: tok.customName || pInfo.charName,
          avatar: tok.customAvatar || pInfo.avatar || '',
          hp: pInfo.hp,
          mhp: pInfo.mhp,
          ac: pInfo.ac,
          speed: pInfo.speed
        };
      });

      return json({
        isMaster,
        me: {
          id: currentPlayer ? currentPlayer.id : 'master',
          name: currentPlayer ? currentPlayer.name : 'Mestre'
        },
        map,
        roster,
        library: isMaster ? { ...defaultLibrary(), ...libRaw } : undefined
      });
    }

    if (action === 'vtt' && sub === 'library' && method === 'POST') {
      if (!isMaster) return json({ error: 'Apenas o mestre edita a biblioteca.' }, 403);
      const body = await request.json();
      const current = { ...defaultLibrary(), ...(await getKV('vtt_library', defaultLibrary())) };
      if (Array.isArray(body.maps)) current.maps = body.maps;
      if (Array.isArray(body.npcs)) current.npcs = body.npcs;
      await putKV('vtt_library', current);
      return json({ ok: true, library: current });
    }

    if (action === 'vtt' && sub === 'table' && method === 'POST') {
      if (!isMaster) return json({ error: 'Apenas o mestre controla a mesa.' }, 403);
      const body = await request.json();
      const map = { ...defaultMapState(), ...(await getKV('map_state', defaultMapState())) };

      if (body.op === 'activate_map') {
        const m = body.map || {};
        map.mapId = m.id || '';
        map.name = m.name || 'Cena Ativa';
        map.bg = m.bg || '';
        map.grid = Number(m.grid ?? 24);
        map.cellMeters = Number(m.cellMeters || 1.5);
        map.fog = {
          on: Boolean(m.fogOn),
          ops: body.keepFog ? (map.fog?.ops || []) : []
        };
        if (!body.keepTokens) {
          map.tokens = (map.tokens || []).filter(t => t.kind === 'player');
        }
      }

      if (body.op === 'put_player') {
        const pId = String(body.playerId || '');
        const pObj = players.find(p => p.id === pId);
        if (pObj && !map.tokens.some(t => t.kind === 'player' && t.owner === pId)) {
          const s = (await getKV(`sheet:${pId}`, null)) || {};
          const idx = map.tokens.filter(t => t.kind === 'player').length;
          map.tokens.push({
            id: 'tok_p_' + pId,
            kind: 'player',
            owner: pId,
            name: s.name || pObj.name,
            avatar: s.avatar || '',
            customAvatar: '',
            color: body.color || '#2e6f95',
            size: 1,
            x: Math.min(85, 18 + idx * 8),
            y: 50
          });
        }
      }

      if (body.op === 'remove_player') {
        const pId = String(body.playerId || '');
        map.tokens = map.tokens.filter(t => !(t.kind === 'player' && t.owner === pId));
      }

      if (body.op === 'spawn_npc') {
        const npc = body.npc || {};
        const baseName = String(npc.name || 'Inimigo').trim();
        const sameCount = map.tokens.filter(t => t.npcId === npc.id || t.baseName === baseName).length;
        const displayName = sameCount > 0 ? `${baseName} #${sameCount + 1}` : baseName;
        map.tokens.push({
          id: 'tok_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          kind: 'npc',
          npcId: npc.id || '',
          owner: 'master',
          baseName,
          name: displayName,
          avatar: npc.avatar || '',
          color: npc.color || '#9e1b1b',
          size: Math.max(1, Math.min(4, Number(npc.size) || 1)),
          hp: Number(npc.hp ?? 15),
          mhp: Number(npc.mhp ?? npc.hp ?? 15),
          ac: Number(npc.ac ?? 12),
          x: 50 + ((sameCount % 5) - 2) * 5,
          y: 45 + (Math.floor(sameCount / 5) * 6)
        });
      }

      if (body.op === 'update_token') {
        const tok = map.tokens.find(t => t.id === body.id);
        if (tok) {
          if (body.name !== undefined) {
            tok.name = String(body.name);
            if (tok.kind === 'player') tok.customName = tok.name;
          }
          if (body.avatar !== undefined) {
            tok.avatar = String(body.avatar);
            if (tok.kind === 'player') tok.customAvatar = tok.avatar;
          }
          if (body.color !== undefined) tok.color = String(body.color);
          if (body.size !== undefined) tok.size = Math.max(1, Math.min(4, Number(body.size) || 1));
          if (body.hp !== undefined) tok.hp = Number(body.hp);
          if (body.mhp !== undefined) tok.mhp = Number(body.mhp);
        }
      }

      if (body.op === 'remove_token') {
        map.tokens = map.tokens.filter(t => t.id !== body.id);
      }

      if (body.op === 'clear_npcs') {
        map.tokens = map.tokens.filter(t => t.kind === 'player');
      }

      await putKV('map_state', map);
      return json({ ok: true, map });
    }

    if (action === 'vtt' && sub === 'move' && method === 'POST') {
      const body = await request.json();
      const map = { ...defaultMapState(), ...(await getKV('map_state', defaultMapState())) };
      const tok = map.tokens.find(t => t.id === body.id);
      if (!tok) return json({ error: 'Token não encontrado.' }, 404);
      if (!isMaster && tok.owner !== currentPlayer.id) {
        return json({ error: 'Você só pode mover seu próprio personagem.' }, 403);
      }
      if (!isMaster) {
        const combat = await getKV('combat', defaultCombat());
        const current = combat.phase === 'running' ? combat.order[combat.turn] : null;
        if (!current || current.tokenId !== tok.id) {
          return json({ error: 'Você só pode se mover durante o combate, no seu turno.' }, 403);
        }
        const meters = Math.max(0, Number(body.meters) || 0);
        if (current.moved + meters > current.limit + 0.05) {
          return json({ error: 'Movimento do turno esgotado.' }, 400);
        }
        current.moved = Math.round((current.moved + meters) * 100) / 100;
        await putKV('combat', combat);
      }
      tok.x = Math.max(1, Math.min(99, Number(body.x) || 50));
      tok.y = Math.max(1, Math.min(99, Number(body.y) || 50));
      await putKV('map_state', map);
      return json({ ok: true });
    }

    if (action === 'vtt' && sub === 'fog' && method === 'POST') {
      if (!isMaster) return json({ error: 'Apenas o mestre controla a névoa.' }, 403);
      const body = await request.json();
      const map = { ...defaultMapState(), ...(await getKV('map_state', defaultMapState())) };
      map.fog = map.fog || { on: true, ops: [] };

      if (body.op === 'cover_all') {
        map.fog.on = true;
        map.fog.ops = [];
      } else if (body.op === 'reveal_all') {
        map.fog.on = false;
        map.fog.ops = [];
      } else if (Array.isArray(body.ops)) {
        map.fog.on = true;
        map.fog.ops.push(...body.ops);
        map.fog.ops = map.fog.ops.slice(-900);
      }

      await putKV('map_state', map);
      return json({ ok: true });
    }

    if (action === 'dice' && sub === 'roll' && method === 'POST') {
      const body = await request.json();
      const parsed = parseDiceExpression(body.expr);
      if (!parsed) return json({ error: 'Dado inválido. Use algo como 2d6+3.' }, 400);
      const entry = await recordRoll({
        parsed,
        mode: ['adv', 'dis'].includes(body.mode) ? body.mode : '',
        label: String(body.label || '').slice(0, 60),
        hidden: isMaster && Boolean(body.hidden),
        kind: 'roll'
      });
      return json({ ok: true, entry });
    }

    if (action === 'play' && sub === 'state' && method === 'GET') {
      const [log, combat, mapRaw] = await Promise.all([
        getKV('dice_log', []),
        getKV('combat', defaultCombat()),
        getKV('map_state', defaultMapState())
      ]);
      const tokens = mapRaw.tokens || [];
      const order = combat.order.map((entry) => {
        const tok = tokens.find((t) => t.id === entry.tokenId);
        return {
          tokenId: entry.tokenId,
          name: tok ? tok.name : entry.name,
          kind: entry.kind,
          owner: entry.owner,
          init: entry.init,
          mod: entry.mod,
          moved: entry.moved,
          limit: entry.limit,
          present: Boolean(tok),
          alive: Boolean(tok) && (tok.kind !== 'npc' || Number(tok.hp) > 0)
        };
      });
      const current = combat.phase === 'running' ? combat.order[combat.turn] : null;
      return json({
        me: { role: isMaster ? 'master' : 'player', id: actor.id, name: actor.name },
        dice: log.filter((entry) => isMaster || !entry.hidden).slice(-30),
        combat: {
          phase: combat.phase,
          round: combat.round,
          turn: combat.turn,
          order,
          currentTokenId: current ? current.tokenId : ''
        }
      });
    }

    if (action === 'combat' && method === 'POST') {
      const body = await request.json();
      const combat = await getKV('combat', defaultCombat());
      const mapRaw = await getKV('map_state', defaultMapState());
      const tokens = mapRaw.tokens || [];
      const isEntryActive = (entry) =>
        tokens.some((t) => t.id === entry.tokenId && (t.kind !== 'npc' || Number(t.hp) > 0));

      const rollInitiative = async (entry) => {
        const logged = await recordRoll({
          parsed: { count: 1, sides: 20, modifier: entry.mod },
          mode: '',
          label: `Iniciativa — ${entry.name}`,
          hidden: false,
          kind: 'initiative',
          who: { id: entry.owner, name: entry.name }
        });
        entry.init = logged.total;
        entry.roll = logged.rolls[0];
        entry.tie = randomInt(1000);
        return logged;
      };

      const beginIfReady = () => {
        const pending = combat.order.filter((entry) => isEntryActive(entry) && entry.init === null);
        if (combat.phase !== 'rolling' || pending.length) return;
        combat.order = combat.order
          .filter(isEntryActive)
          .sort((a, b) => b.init - a.init || b.mod - a.mod || b.roll - a.roll || b.tie - a.tie);
        combat.order.forEach((entry) => { entry.moved = 0; });
        combat.phase = 'running';
        combat.round = 1;
        combat.turn = 0;
      };

      const advanceTurn = () => {
        const total = combat.order.length;
        for (let step = 0; step < total; step++) {
          combat.turn += 1;
          if (combat.turn >= total) {
            combat.turn = 0;
            combat.round += 1;
          }
          if (isEntryActive(combat.order[combat.turn])) break;
        }
        combat.order[combat.turn].moved = 0;
      };

      const needMaster = () => (isMaster ? null : json({ error: 'Apenas o mestre controla o combate.' }, 403));
      let entryResult = null;

      if (body.op === 'start') {
        const denied = needMaster();
        if (denied) return denied;
        const entries = [];
        for (const tok of tokens) {
          if (tok.kind === 'npc' && Number(tok.hp) <= 0) continue;
          const sheet = tok.kind === 'player' ? await getKV(`sheet:${tok.owner}`, null) : null;
          entries.push({
            tokenId: tok.id,
            name: tok.name,
            kind: tok.kind,
            owner: tok.owner,
            init: null,
            roll: 0,
            tie: 0,
            mod: sheet ? dexterityModifier(sheet) : 0,
            moved: 0,
            limit: sheet ? movementLimitOf(sheet) : 9
          });
        }
        if (!entries.length) {
          return json({ error: 'Coloque jogadores ou inimigos na mesa antes de iniciar o combate.' }, 400);
        }
        await putKV('combat', { phase: 'rolling', round: 0, turn: 0, order: entries });
        return json({ ok: true });
      }

      if (body.op === 'roll_initiative') {
        const entry = combat.order.find((item) => item.tokenId === body.tokenId);
        if (combat.phase !== 'rolling' || !entry) return json({ error: 'Iniciativa não está aberta.' }, 400);
        if (!isMaster && entry.owner !== actor.id) return json({ error: 'Esta iniciativa não é sua.' }, 403);
        if (entry.init !== null) return json({ error: 'Iniciativa já rolada.' }, 400);
        entryResult = await rollInitiative(entry);
        beginIfReady();
      } else if (body.op === 'roll_pending') {
        const denied = needMaster();
        if (denied) return denied;
        for (const entry of combat.order) {
          if (entry.init === null && isEntryActive(entry)) await rollInitiative(entry);
        }
        beginIfReady();
      } else if (body.op === 'end_turn') {
        const current = combat.order[combat.turn];
        if (combat.phase !== 'running' || !current) return json({ error: 'Não há combate em andamento.' }, 400);
        if (!isMaster && current.owner !== actor.id) return json({ error: 'Não é o seu turno.' }, 403);
        advanceTurn();
      } else if (body.op === 'stop') {
        const denied = needMaster();
        if (denied) return denied;
        await putKV('combat', defaultCombat());
        return json({ ok: true });
      } else {
        return json({ error: 'Operação de combate desconhecida.' }, 400);
      }

      await putKV('combat', combat);
      return json({ ok: true, entry: entryResult });
    }

    return json({ error: 'Rota não encontrada.' }, 404);
  } catch (err) {
    return json({ error: err.message || 'Erro interno' }, 500);
  }
}
