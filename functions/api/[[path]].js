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
    try {
      const raw = await env.RPG.get(k);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const putKV = (k, val) => env.RPG.put(k, JSON.stringify(val));

  const players = await getKV('players', []);
  const isMaster = key === env.MASTER_KEY;
  const currentPlayer = !isMaster ? players.find(p => p.pin === key) : null;

  if (!isMaster && !currentPlayer) {
    return json({ error: 'Código de acesso inválido.' }, 401);
  }

  try {
    // --- AUTENTICAÇÃO ---
    if (action === 'me' && method === 'GET') {
      return json({
        role: isMaster ? 'master' : 'player',
        id: currentPlayer ? currentPlayer.id : 'master',
        name: currentPlayer ? currentPlayer.name : 'Mestre'
      });
    }

    // --- FICHAS ---
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

    // --- GERENCIAR JOGADORES ---
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

    // --- VTT: ESTADO COMPLETO DA MESA + ELENCO + BIBLIOTECA ---
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
      // Sincroniza avatar/nome/HP atualizados da ficha nos tokens de jogadores que não têm foto forçada
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

    // --- VTT: SALVAR BIBLIOTECA DE MAPAS E NPCS ---
    if (action === 'vtt' && sub === 'library' && method === 'POST') {
      if (!isMaster) return json({ error: 'Apenas o mestre edita a biblioteca.' }, 403);
      const body = await request.json();
      const current = { ...defaultLibrary(), ...(await getKV('vtt_library', defaultLibrary())) };
      if (Array.isArray(body.maps)) current.maps = body.maps;
      if (Array.isArray(body.npcs)) current.npcs = body.npcs;
      await putKV('vtt_library', current);
      return json({ ok: true, library: current });
    }

    // --- VTT: AÇÕES DA MESA (ATIVAR MAPA, PÔR/TIRAR PLAYERS, INVOCAR NPCS) ---
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

      if (body.op === 'update_map') {
        if (body.name !== undefined) map.name = String(body.name);
        if (body.bg !== undefined) map.bg = String(body.bg);
        if (body.grid !== undefined) map.grid = Math.max(0, Math.min(80, Number(body.grid) || 0));
        if (body.cellMeters !== undefined) map.cellMeters = Math.max(0.5, Number(body.cellMeters) || 1.5);
        if (body.fogOn !== undefined) map.fog = { ...(map.fog || { ops: [] }), on: Boolean(body.fogOn) };
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

    // --- VTT: MOVER TOKEN ---
    if (action === 'vtt' && sub === 'move' && method === 'POST') {
      const body = await request.json();
      const map = { ...defaultMapState(), ...(await getKV('map_state', defaultMapState())) };
      const tok = map.tokens.find(t => t.id === body.id);
      if (!tok) return json({ error: 'Token não encontrado.' }, 404);
      if (!isMaster && tok.owner !== currentPlayer.id) {
        return json({ error: 'Você só pode mover seu próprio personagem.' }, 403);
      }
      tok.x = Math.max(1, Math.min(99, Number(body.x) || 50));
      tok.y = Math.max(1, Math.min(99, Number(body.y) || 50));
      await putKV('map_state', map);
      return json({ ok: true });
    }

    // --- VTT: NÉVOA DE GUERRA (EM LOTE) ---
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

    return json({ error: 'Rota não encontrada.' }, 404);
  } catch (err) {
    return json({ error: err.message || 'Erro interno' }, 500);
  }
}
