import { GameState } from './game.js';
import { UIManager } from './ui.js';

const CLIENT_ID_KEY = 'analog_game_client_id';
const PLAYER_NAME_KEY = 'analog_game_player_name';
const LEGACY_CLIENT_ID_KEY = 'analog-game-client-id';
const LEGACY_PLAYER_NAME_KEY = 'analog-game-player-name';

function migrateStorageValue(key, legacyKey) {
    const value = localStorage.getItem(key);
    const legacyValue = localStorage.getItem(legacyKey);
    if (value) {
        localStorage.removeItem(legacyKey);
        return value;
    }
    if (legacyValue) {
        localStorage.setItem(key, legacyValue);
        localStorage.removeItem(legacyKey);
    }
    return legacyValue;
}

let clientId = migrateStorageValue(CLIENT_ID_KEY, LEGACY_CLIENT_ID_KEY);
if (!clientId) {
    clientId = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, clientId);
}

let currentGame = null;
let latestPayload = null;
let ui = null;
let uiReady = false;

function init() {
    hideLocalSetup();
    createLobby();
    bindLobby();
    connectEvents();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}

function hideLocalSetup() {
    const setup = document.getElementById('setup-overlay');
    const gameContainer = document.getElementById('game-container');
    if (setup) setup.style.display = 'none';
    if (gameContainer) gameContainer.style.display = 'none';
}

function createLobby() {
    const overlay = document.createElement('div');
    overlay.id = 'online-lobby-overlay';
    overlay.style.cssText = `
        position:fixed; inset:0; z-index:2500; background:var(--bg-dark);
        display:flex; align-items:center; justify-content:center; color:var(--text-main);
    `;
    overlay.innerHTML = `
        <div style="background:var(--bg-parchment); border:3px solid var(--border-gold); border-radius:8px; padding:28px; width:min(560px,92vw);">
            <h2 style="font-size:1.6rem; margin-bottom:12px; color:var(--border-dark);">Online Lobby</h2>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
                <input id="online-player-name" maxlength="24" placeholder="Player name" style="flex:1; min-width:180px; font-size:1rem; padding:8px;" />
                <button id="online-join" class="btn primary-btn">Join</button>
            </div>
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px;">
                <label>CPU:
                    <input id="online-cpu-count" type="number" min="0" max="4" value="0" style="width:64px; font-size:1rem; padding:5px; text-align:center;" />
                </label>
                <button id="online-start" class="btn primary-btn" disabled>Start Game</button>
            </div>
            <div id="online-lobby-status" style="min-height:1.4em; margin-bottom:10px; color:var(--accent-red);"></div>
            <div style="font-weight:bold; margin-bottom:6px;">Players</div>
            <div id="online-player-list" style="display:grid; gap:6px;"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const savedName = migrateStorageValue(PLAYER_NAME_KEY, LEGACY_PLAYER_NAME_KEY);
    if (savedName) {
        document.getElementById('online-player-name').value = savedName;
    }
}

function bindLobby() {
    document.getElementById('online-join').addEventListener('click', async () => {
        const name = document.getElementById('online-player-name').value.trim();
        if (!name) return setLobbyStatus('名前を入力してください。');
        localStorage.setItem(PLAYER_NAME_KEY, name);
        try {
            await postJson('/api/join', { clientId, name });
            setLobbyStatus('');
        } catch (error) {
            setLobbyStatus(error.message);
        }
    });

    document.getElementById('online-start').addEventListener('click', async () => {
        const cpuCount = Number(document.getElementById('online-cpu-count').value || 0);
        try {
            await postJson('/api/start', { clientId, cpuCount });
            setLobbyStatus('');
        } catch (error) {
            setLobbyStatus(error.message);
        }
    });
}

function connectEvents() {
    const events = new EventSource(`/events?clientId=${encodeURIComponent(clientId)}`);
    events.addEventListener('state', event => {
        applyServerPayload(JSON.parse(event.data));
    });
    events.onerror = () => {
        setLobbyStatus('サーバーとの接続が切れています。再接続中...');
    };
}

async function postJson(path, body) {
    const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Request failed.');
    return data;
}

function applyServerPayload(payload) {
    latestPayload = payload;
    renderLobby(payload);

    if (!payload.started || !payload.state) return;

    document.getElementById('online-lobby-overlay').style.display = 'none';
    const localSetup = document.getElementById('setup-overlay');
    if (localSetup) localSetup.style.display = 'none';

    currentGame = Object.assign(new GameState(), payload.state);
    currentGame.onStateChange = null;

    if (!uiReady) {
        ui = new UIManager();
        configureUiHandlers();
        ui.init(currentGame);
        bindEffectButtons();
        uiReady = true;
    } else {
        ui.renderAll(currentGame);
    }

    renderLogs(payload.logs || []);
}

function renderLobby(payload) {
    const overlay = document.getElementById('online-lobby-overlay');
    if (!overlay || payload.started) return;

    const list = document.getElementById('online-player-list');
    const players = payload.lobby?.players || [];
    list.innerHTML = players.length === 0
        ? '<div style="opacity:.75;">No players yet.</div>'
        : players.map(player => `
            <div style="padding:8px 10px; border:1px solid var(--border-dark); border-radius:4px; background:rgba(255,255,255,.35);">
                ${escapeHtml(player.name)}${player.isHost ? ' / host' : ''}
            </div>
        `).join('');

    const joined = players.some(player => player.clientId === clientId);
    const start = document.getElementById('online-start');
    start.disabled = !payload.isHost || !joined || players.length === 0;

    const cpuInput = document.getElementById('online-cpu-count');
    cpuInput.max = Math.max(0, 5 - players.length);
    if (Number(cpuInput.value) > Number(cpuInput.max)) cpuInput.value = cpuInput.max;
}

function setLobbyStatus(message) {
    const el = document.getElementById('online-lobby-status');
    if (el) el.textContent = message || '';
}

function configureUiHandlers() {
    ui.onMarketExchange = async (handIndices, marketIndex) => {
        if (handIndices.length === 0) return ui.showAlert('手札を選択してください。');
        if (marketIndex === -1) return ui.showAlert('マーケットのカードを選択してください。');

        const mode = ui._discountedExchangeMode && currentGame.turnState?.discountedExchange
            ? 'discounted'
            : (ui._freeMarketExchangeMode && currentGame.turnState?.freeMarketExchange ? 'free' : 'normal');

        await sendAction('marketExchange', { handIndices, marketIndex, mode });
        ui._discountedExchangeMode = false;
        ui._freeMarketExchangeMode = false;
        ui.clearSelection();
    };

    ui.onDemandAchieve = async (demandId, handIndices) => {
        if (!demandId) return ui.showAlert('需要カードを選択してください。');
        if (handIndices.length === 0) return ui.showAlert('手札を選択してください。');
        await sendAction('demandAchieve', { demandId, handIndices });
        ui.clearSelection();
    };

    ui.onRoleAchieve = async (roleId, handIndices) => {
        if (handIndices.length === 0) return ui.showAlert('手札を選択してください。');
        await sendAction('roleAchieve', { roleId, handIndices });
        ui.clearSelection();
    };

    ui.onBuildProcessingPlant = async (activeSpecialtyIdx, handIndices) => {
        if (activeSpecialtyIdx === -1) return ui.showAlert('特産品を選択してください。');
        if (handIndices.length !== 1) return ui.showAlert('支払う手札を1枚選択してください。');
        await sendAction('buildProcessingPlant', { activeSpecialtyIdx, handIndices });
        ui.clearSelection();
    };

    ui.onEndTurn = async () => {
        ui.clearSelection();
        await sendAction('endTurn');
    };

    ui.onSetupConfirm = async (activeIndices) => {
        await sendAction('setupConfirm', { activeIndices });
    };

    ui.onDiscardConfirm = async (discardIndices) => {
        await sendAction('discardConfirm', { discardIndices });
    };
}

function bindEffectButtons() {
    document.getElementById('btn-gain-resource-confirm').addEventListener('click', async () => {
        if (!ui._gainResourceSelected) return ui.showAlert('資源を1枚選択してください。');
        await sendAction('gainResource', { resourceId: ui._gainResourceSelected });
        ui._gainResourceSelected = null;
    });

    document.getElementById('btn-market-replace-confirm').addEventListener('click', async () => {
        const isGainStep = currentGame.marketReplaceStep === 'gain' || ui._marketReplaceStep === 'gain';
        if (isGainStep) {
            await sendAction('marketReplaceConfirm', { gainIndex: ui._marketReplaceGainIndex ?? -1 });
            ui._marketReplaceStep = null;
            ui._marketReplaceGainIndex = -1;
            return;
        }

        await sendAction('marketReplaceConfirm', { marketIndices: ui._marketReplaceSelected || [] });
        ui._marketReplaceSelected = [];
    });

    document.getElementById('btn-stockpile-confirm').addEventListener('click', async () => {
        const discardIndices = ui._stockpileDiscardSelected || [];
        const gainCounts = ui._stockpileGainCounts || {};
        const resourceIds = Object.entries(gainCounts)
            .flatMap(([id, count]) => Array.from({ length: count }, () => id));

        if (discardIndices.length !== resourceIds.length) {
            return ui.showAlert('破棄枚数と獲得枚数を同じにしてください。');
        }

        await sendAction('handExchange', { discardIndices, resourceIds });
        ui._stockpileDiscardSelected = [];
        ui._stockpileGainCounts = {};
    });

    document.getElementById('btn-free-plant-confirm').addEventListener('click', async () => {
        if (!ui._freePlantSpecialty) return ui.showAlert('建設する特産品を選択してください。');
        await sendAction('freePlant', { specialtyId: ui._freePlantSpecialty });
        document.getElementById('free-plant-overlay').classList.add('hidden');
        ui._freePlantSpecialty = null;
    });

    document.getElementById('btn-free-plant-cancel').addEventListener('click', () => {
        document.getElementById('free-plant-overlay').classList.add('hidden');
    });
}

async function sendAction(type, payload = {}) {
    try {
        await postJson('/api/action', { clientId, type, payload });
    } catch (error) {
        ui.showAlert(error.message);
    }
}

function renderLogs(logs) {
    const logContent = document.getElementById('log-content');
    if (!logContent) return;

    logContent.innerHTML = '';
    logs.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'log-entry';
        const time = document.createElement('span');
        time.className = 'log-time';
        time.textContent = `[${entry.time}]`;
        div.appendChild(time);
        div.appendChild(document.createTextNode(` ${entry.message}`));
        logContent.appendChild(div);
    });

    const panel = document.getElementById('log-panel');
    if (panel) panel.scrollTop = panel.scrollHeight;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}
