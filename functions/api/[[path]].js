// Backend Serverless Cloudflare Pages (functions/api/[[path]].js)
const J = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-key'
  }
});

export async function onRequest({ request, env, params }) {
  if (request.method === 'OPTIONS') return J(null, 204);
  if (!env.RPG || !env.MASTER_KEY) {
    return J({ error: 'Configuração ausente no Cloudflare: KV "RPG" ou MASTER_KEY.' }, 500);
  }

  const key = (request.headers.get('x-key') || '').trim();
  const path = [].concat(params.path || []);
  const action = path[0] || '';
  const subAction = path[1] || '';
  const method = request.method;

  const players = JSON.parse((await env.RPG.get('players')) || '[]');
  const isMaster = key !== '' && key === env.MASTER_KEY;
  const player = !isMaster && players.find(p => p.pin === key);

  if (!isMaster && !player) {
    return J({ error: 'Código de acesso inválido.' }, 401);
  }

  const body = ['POST', 'PUT', 'PATCH'].includes(method)
    ? await request.json().catch(() => ({}))
    : {};

  try {
    // Identificação do usuário logado
    if (action === 'me' && method === 'GET') {
      return J({
        role: isMaster ? 'master' : 'player',
        id: player ? player.id : 'master',
        name: player ? player.name : 'Mestre'
      });
    }

    // Gerenciamento de Jogadores (Apenas Mestre)
    if (action === 'players') {
      if (!isMaster) return J({ error: 'Apenas o Mestre pode gerenciar jogadores.' }, 403);

      const isPinInvalid = (pin, ignoreId = '') =>
        !pin ||
        pin === env.MASTER_KEY ||
        players.some(p => p.pin === pin && p.id !== ignoreId);

      if (method === 'POST') {
        const name = String(body.name || '').trim().slice(0, 40);
        const pin = String(body.pin || '').trim().slice(0, 32);
        if (!name || isPinInvalid(pin)) {
          return J({ error: 'Informe um nome válido e um código exclusivo.' }, 400);
        }
        const newPlayer = { id: crypto.randomUUID().slice(0, 8), name, pin };
        players.push(newPlayer);
        await env.RPG.put('players', JSON.stringify(players));
        return J({ ok: true, player: newPlayer });
      }

      if (method === 'PATCH') {
        const target = players.find(x => x.id === subAction);
        if (!target) return J({ error: 'Jogador não encontrado.' }, 404);

        const nextName = body.name !== undefined ? String(body.name).trim().slice(0, 40) : target.name;
        const nextPin = body.pin !== undefined ? String(body.pin).trim().slice(0, 32) : target.pin;

        if (!nextName || isPinInvalid(nextPin, subAction)) {
          return J({ error: 'Nome inválido ou código já em uso.' }, 400);
        }

        target.name = nextName;
        target.pin = nextPin;
        await env.RPG.put('players', JSON.stringify(players));
        return J({ ok: true });
      }

      if (method === 'DELETE') {
        const idx = players.findIndex(x => x.id === subAction);
        if (idx >= 0) {
          players.splice(idx, 1);
          await env.RPG.put('players', JSON.stringify(players));
          await env.RPG.delete('sheet:' + subAction);
        }
        return J({ ok: true });
      }
    }

    // Listagem de Fichas
    if (action === 'sheets' && method === 'GET') {
      const out = [];
      for (const p of players) {
        if (!isMaster && p.id !== player.id) continue;
        const sheet = JSON.parse((await env.RPG.get('sheet:' + p.id)) || 'null');
        if (sheet && !isMaster) delete sheet.mnotes;
        out.push({
          id: p.id,
          name: p.name,
          pin: isMaster ? p.pin : undefined,
          sheet
        });
      }
      return J({ players: out });
    }

    // Atualização da Ficha
    if (action === 'sheet' && method === 'PUT') {
      if (!subAction) return J({ error: 'ID da ficha ausente.' }, 400);
      if (!isMaster && subAction !== player.id) {
        return J({ error: 'Você não tem permissão para editar esta ficha.' }, 403);
      }

      const old = JSON.parse((await env.RPG.get('sheet:' + subAction)) || 'null') || {};
      const next = { ...body };

      // Proteção de campos travados pelo Mestre
      if (!isMaster) {
        next.lock = !!old.lock;
        next.mnotes = old.mnotes || '';
        if (old.lock) {
          ['attrs', 'bonus2', 'bonus1', 'level'].forEach(k => {
            if (old[k] !== undefined) next[k] = old[k];
          });
        }
      }

      await env.RPG.put('sheet:' + subAction, JSON.stringify(next));
      return J({ ok: true });
    }

    return J({ error: 'Rota não encontrada.' }, 404);
  } catch (err) {
    return J({ error: err.message || 'Erro interno no servidor.' }, 500);
  }
}
