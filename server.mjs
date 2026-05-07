import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GameState } from './src/game.js';
import * as Actions from './src/actions.js';
import { CPU } from './src/cpu.js';
import { logger } from './src/logger.js';

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HIDDEN_RESOURCE = '__hidden_resource__';
const HIDDEN_SPECIALTY = '__hidden_specialty__';

const clients = new Map();
const streams = new Map();

let hostClientId = null;
let game = null;
let started = false;
let cpuTimer = null;

logger.onLogAdded = () => broadcastAll();

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function json(res, status, body) {
    const content = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(content)
    });
    res.end(content);
}

function getClient(clientId) {
    if (!clientId) return null;
    return clients.get(clientId) || null;
}

function getJoinedClients() {
    return [...clients.values()]
        .filter(client => client.name)
        .sort((a, b) => a.joinedAt - b.joinedAt);
}

function getLobby() {
    return {
        players: getJoinedClients().map(client => ({
            clientId: client.clientId,
            name: client.name,
            isHost: client.clientId === hostClientId,
            playerId: client.playerId ?? null
        })),
        maxPlayers: 5
    };
}

function clonePlayerForViewer(player, viewerPlayerId) {
    const isSelf = player.id === viewerPlayerId;
    return {
        id: player.id,
        name: player.name,
        isCpu: player.isCpu,
        score: player.score,
        hand: isSelf ? [...player.hand] : Array(player.hand.length).fill(HIDDEN_RESOURCE),
        activeSpecialties: [...player.activeSpecialties],
        inactiveSpecialties: isSelf
            ? [...player.inactiveSpecialties]
            : Array(player.inactiveSpecialties.length).fill(HIDDEN_SPECIALTY),
        processingPlants: [...(player.processingPlants || [])],
        achievedDemands: deepClone(player.achievedDemands || []),
        achievedRoles: [...(player.achievedRoles || [])],
        maxHandSize: player.maxHandSize
    };
}

function stateForClient(client) {
    if (!started || !game) return null;
    const viewerPlayerId = client?.playerId ?? null;
    return {
        round: game.round,
        maxRounds: game.maxRounds,
        players: game.players.map(player => clonePlayerForViewer(player, viewerPlayerId)),
        currentPlayerIndex: game.currentPlayerIndex,
        actionsLeft: game.actionsLeft,
        marketCards: [...game.marketCards],
        marketDeck: Array(game.marketDeck.length).fill(null),
        marketDiscard: Array(game.marketDiscard.length).fill(null),
        demandCards: [...game.demandCards],
        demandDeck: Array(game.demandDeck.length).fill(null),
        isGameOver: game.isGameOver,
        phase: game.phase,
        setupPlayerIndex: game.setupPlayerIndex,
        startPlayerIndex: game.startPlayerIndex,
        devPlayerIndex: game.devPlayerIndex,
        maxHandSize: game.maxHandSize,
        turnState: deepClone(game.turnState || {}),
        marketReplaceStep: game.marketReplaceStep || null,
        localPlayerId: viewerPlayerId
    };
}

function payloadFor(clientId) {
    const client = getClient(clientId);
    return {
        started,
        playerId: client?.playerId ?? null,
        isHost: clientId === hostClientId,
        lobby: getLobby(),
        logs: logger.logs.slice(-200),
        state: stateForClient(client)
    };
}

function writeEvent(res, payload) {
    res.write(`event: state\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastAll() {
    for (const [clientId, res] of streams) {
        writeEvent(res, payloadFor(clientId));
    }
}

function currentActor() {
    if (!game || game.players.length === 0) return null;
    if (game.phase === 'setup') return game.players[game.setupPlayerIndex] || null;
    if (game.phase === 'free_development') return game.players[game.devPlayerIndex] || null;
    return game.getCurrentPlayer();
}

function assertCurrentHuman(client) {
    if (!started || !game) throw new Error('Game has not started.');
    if (client?.playerId === undefined || client?.playerId === null) throw new Error('Join before acting.');
    const actor = currentActor();
    if (!actor || actor.id !== client.playerId) throw new Error('It is not your turn.');
    return actor;
}

function scheduleCpu() {
    if (!started || !game || game.isGameOver || cpuTimer) return;

    const actor = currentActor();
    if (!actor?.isCpu || game.cpuActionPending) return;

    game.cpuActionPending = true;
    cpuTimer = setTimeout(() => {
        cpuTimer = null;
        const changed = CPU.takeAction(game, actor);
        game.cpuActionPending = false;
        if (changed) {
            game.notifyChange();
        } else {
            broadcastAll();
            scheduleCpu();
        }
    }, 1000);
}

function attachGameCallbacks() {
    game.onStateChange = () => {
        broadcastAll();
        scheduleCpu();
    };
}

function startGame(clientId, cpuCount) {
    if (clientId !== hostClientId) throw new Error('Only the host can start the game.');
    if (started) throw new Error('Game already started.');

    const joined = getJoinedClients();
    const humans = joined.length;
    const cpus = Math.max(0, Math.min(Number(cpuCount) || 0, 5 - humans));
    if (humans < 1 || humans + cpus > 5) throw new Error('Total players must be 1 to 5.');

    logger.logs = [];
    game = new GameState();
    game.init({ human: humans, cpu: cpus });

    joined.forEach((client, index) => {
        const player = game.players[index];
        client.playerId = player.id;
        player.name = client.name;
        player.isCpu = false;
    });

    attachGameCallbacks();
    started = true;
    broadcastAll();
    scheduleCpu();
}

function applyAction(client, type, payload = {}) {
    const player = assertCurrentHuman(client);
    let result = null;

    switch (type) {
        case 'setupConfirm': {
            const activeIndices = Array.isArray(payload.activeIndices) ? payload.activeIndices : [];
            const expected = game.phase === 'setup' ? 3 : 1;
            if (!['setup', 'free_development'].includes(game.phase)) throw new Error('Not in setup phase.');
            if (activeIndices.length !== expected) throw new Error(`Select ${expected} cards.`);
            if (game.phase === 'setup') game.completeSetup(player.id, activeIndices);
            else game.completeFreeDevelopment(player.id, activeIndices);
            break;
        }
        case 'discardConfirm': {
            if (game.phase !== 'discard') throw new Error('Not in discard phase.');
            const discardIndices = Array.isArray(payload.discardIndices) ? payload.discardIndices : [];
            game.completeDiscard(player.id, discardIndices);
            break;
        }
        case 'marketExchange': {
            if (game.phase !== 'playing') throw new Error('Not in playing phase.');
            const handIndices = Array.isArray(payload.handIndices) ? payload.handIndices : [];
            const marketIndex = Number(payload.marketIndex);
            if (payload.mode === 'discounted') {
                result = Actions.executeDiscountedExchange(game, player, handIndices, marketIndex);
            } else if (payload.mode === 'free') {
                if (!game.turnState?.freeMarketExchange) throw new Error('Free exchange is not available.');
                result = Actions.executeExchange(game, player, handIndices, marketIndex, {
                    free: true,
                    source: 'free market exchange'
                });
            } else {
                if (game.actionsLeft <= 0) throw new Error('No actions left.');
                result = Actions.executeExchange(game, player, handIndices, marketIndex);
            }
            break;
        }
        case 'demandAchieve': {
            if (game.phase !== 'playing') throw new Error('Not in playing phase.');
            const handIndices = Array.isArray(payload.handIndices) ? payload.handIndices : [];
            result = Actions.executeDemand(game, player, payload.demandId, handIndices);
            break;
        }
        case 'roleAchieve': {
            if (game.phase !== 'playing') throw new Error('Not in playing phase.');
            const handIndices = Array.isArray(payload.handIndices) ? payload.handIndices : [];
            result = Actions.executeFixedRole(game, player, payload.roleId, handIndices);
            break;
        }
        case 'buildProcessingPlant': {
            if (game.phase !== 'playing') throw new Error('Not in playing phase.');
            if (game.actionsLeft <= 0) throw new Error('No actions left.');
            const specialtyId = player.activeSpecialties[Number(payload.activeSpecialtyIdx)];
            const handIndices = Array.isArray(payload.handIndices) ? payload.handIndices : [];
            result = Actions.executeBuildProcessingPlant(game, player, specialtyId, handIndices[0]);
            break;
        }
        case 'endTurn': {
            game.endTurn();
            break;
        }
        case 'gainResource': {
            if (game.phase !== 'gain_resource') throw new Error('Not in gain resource phase.');
            game.completeGainResource(player.id, payload.resourceId);
            break;
        }
        case 'marketReplaceConfirm': {
            if (game.phase !== 'market_replace') throw new Error('Not in market replace phase.');
            if (game.marketReplaceStep === 'gain') {
                game.completeMarketReplaceGain(player.id, Number(payload.gainIndex ?? -1));
                game.marketReplaceStep = null;
            } else {
                const marketIndices = Array.isArray(payload.marketIndices) ? payload.marketIndices : [];
                game.replaceMarketCards(marketIndices);
                game.marketReplaceStep = 'gain';
                game.notifyChange();
            }
            break;
        }
        case 'handExchange': {
            if (!['stockpile_exchange', 'hand_exchange_1'].includes(game.phase)) throw new Error('Not in hand exchange phase.');
            const maxCount = game.phase === 'hand_exchange_1' ? 1 : 2;
            const sourceName = game.phase === 'hand_exchange_1' ? 'hand exchange' : 'stockpile';
            const discardIndices = Array.isArray(payload.discardIndices) ? payload.discardIndices : [];
            const resourceIds = Array.isArray(payload.resourceIds) ? payload.resourceIds : [];
            game.completeHandExchange(player.id, discardIndices, resourceIds, maxCount, sourceName);
            break;
        }
        case 'freePlant': {
            if (!game.turnState?.freeProcessingPlant) throw new Error('Free plant is not available.');
            result = Actions.executeBuildProcessingPlant(game, player, payload.specialtyId, null, true);
            break;
        }
        default:
            throw new Error('Unknown action.');
    }

    if (result && !result.success) throw new Error(result.msg || 'Action failed.');
    game.notifyChange();
}

async function readJson(req) {
    let body = '';
    for await (const chunk of req) {
        body += chunk;
        if (body.length > 100_000) throw new Error('Request is too large.');
    }
    return body ? JSON.parse(body) : {};
}

function sendEvents(req, res, url) {
    const clientId = url.searchParams.get('clientId');
    if (!clientId) return json(res, 400, { ok: false, error: 'Missing clientId.' });

    res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive'
    });
    res.write(`retry: 2000\n\n`);
    streams.set(clientId, res);
    writeEvent(res, payloadFor(clientId));

    req.on('close', () => {
        streams.delete(clientId);
    });
}

async function serveApi(req, res, url) {
    try {
        if (req.method === 'GET' && url.pathname === '/api/mode') {
            return json(res, 200, { ok: true, mode: 'online' });
        }

        if (req.method === 'GET' && url.pathname === '/events') {
            return sendEvents(req, res, url);
        }

        if (req.method === 'POST' && url.pathname === '/api/join') {
            const body = await readJson(req);
            const clientId = String(body.clientId || '').trim();
            const name = String(body.name || '').trim().slice(0, 24);
            if (!clientId || !name) throw new Error('Name is required.');

            let client = clients.get(clientId);
            if (!client) {
                client = { clientId, joinedAt: Date.now(), playerId: null };
                clients.set(clientId, client);
            }

            if (started && client.playerId === null) throw new Error('Game already started.');
            if (!hostClientId) hostClientId = clientId;

            client.name = name;
            broadcastAll();
            return json(res, 200, { ok: true, ...payloadFor(clientId) });
        }

        if (req.method === 'POST' && url.pathname === '/api/start') {
            const body = await readJson(req);
            startGame(String(body.clientId || ''), body.cpuCount);
            return json(res, 200, { ok: true, ...payloadFor(String(body.clientId || '')) });
        }

        if (req.method === 'POST' && url.pathname === '/api/action') {
            const body = await readJson(req);
            const client = getClient(String(body.clientId || ''));
            applyAction(client, body.type, body.payload);
            return json(res, 200, { ok: true });
        }

        return json(res, 404, { ok: false, error: 'Not found.' });
    } catch (error) {
        return json(res, 400, { ok: false, error: error.message || String(error) });
    }
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8'
};

async function serveStatic(res, pathname) {
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const resolved = path.resolve(ROOT, relative);
    if (!resolved.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    try {
        const data = await readFile(resolved);
        res.writeHead(200, {
            'content-type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream'
        });
        res.end(data);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/') || url.pathname === '/events') {
        await serveApi(req, res, url);
        return;
    }
    await serveStatic(res, url.pathname);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Online game server: http://localhost:${PORT}`);
});
