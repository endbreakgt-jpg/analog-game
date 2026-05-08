const els = {
    status: document.getElementById('status-line'),
    refresh: document.getElementById('btn-refresh'),
    runForm: document.getElementById('run-form'),
    runButton: document.getElementById('btn-run'),
    games: document.getElementById('input-games'),
    players: document.getElementById('input-players'),
    seed: document.getElementById('input-seed'),
    maxSteps: document.getElementById('input-max-steps'),
    profiles: document.getElementById('select-profiles'),
    customProfiles: document.getElementById('input-custom-profiles'),
    customProfileLabel: document.getElementById('custom-profile-label'),
    runAnalysis: document.getElementById('input-run-analysis'),
    resultLinks: document.getElementById('result-links'),
    output: document.getElementById('command-output'),
    logsBody: document.getElementById('logs-body'),
    analyzeSelected: document.getElementById('btn-analyze-selected')
};

let busy = false;
let apiBase = '';

function candidateApiBases() {
    const bases = [''];
    const staticDevPorts = new Set(['5500', '5501']);
    if (staticDevPorts.has(location.port) || location.protocol === 'file:') {
        bases.push('http://localhost:3000');
        bases.push('http://127.0.0.1:3000');
        bases.push('http://localhost:3001');
        bases.push('http://127.0.0.1:3001');
    }
    return [...new Set(bases)];
}

function setBusy(nextBusy, message = '') {
    busy = nextBusy;
    els.runButton.disabled = busy;
    els.refresh.disabled = busy;
    els.analyzeSelected.disabled = busy;
    if (message) els.status.textContent = message;
}

function setOutput(text) {
    els.output.textContent = text || '';
}

async function fetchJson(url, options = {}) {
    const bases = apiBase ? [apiBase] : candidateApiBases();
    let lastError = null;

    for (const base of bases) {
        try {
            const response = await fetch(`${base}${url}`, {
                headers: {
                    'content-type': 'application/json',
                    ...(options.headers || {})
                },
                ...options
            });
            const text = await response.text();
            if (!text.trim()) {
                throw new Error('APIから空のレスポンスが返りました。');
            }

            let payload = null;
            try {
                payload = JSON.parse(text);
            } catch {
                throw new Error('APIではないサーバから応答が返りました。');
            }

            if (!response.ok || !payload.ok) {
                throw new Error(payload.error || `HTTP ${response.status}`);
            }

            apiBase = base;
            return payload;
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error([
        'シミュレーションAPIに接続できません。',
        'このGUIは npm start で起動したNodeサーバ上で動かしてください。',
        '推奨URL: http://localhost:3000/simulation.html',
        `詳細: ${lastError?.message || 'unknown error'}`
    ].join('\n'));
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
    return new Date(value).toLocaleString();
}

function getKind(file) {
    if (file.ext === '.jsonl') return 'JSONL';
    if (file.name.includes('analysis')) return 'ANALYSIS';
    if (file.name.includes('summary')) return 'SUMMARY';
    return 'REPORT';
}

function profileValue() {
    return els.profiles.value === 'custom'
        ? els.customProfiles.value.trim()
        : els.profiles.value;
}

function makeLink(label, file) {
    if (!file) return '';
    const href = `${apiBase}${file.url}`;
    return `
        <a class="file-link" href="${href}" target="_blank" rel="noreferrer">
            <strong>${label}</strong>
            <span>${file.path}</span>
        </a>
    `;
}

function renderResult(payload) {
    const simulation = payload.simulation;
    const analysis = payload.analysis;
    els.resultLinks.innerHTML = [
        makeLink('JSONL', simulation?.files?.out),
        makeLink('シミュレーション集計', simulation?.files?.summary),
        makeLink('シミュレーションTXT', simulation?.files?.report),
        makeLink('分析集計', analysis?.files?.summary),
        makeLink('分析TXT', analysis?.files?.report)
    ].filter(Boolean).join('');

    setOutput([
        simulation?.stdout || '',
        simulation?.stderr || '',
        analysis?.stdout || '',
        analysis?.stderr || ''
    ].filter(Boolean).join('\n'));
}

function selectedJsonlPaths() {
    return [...document.querySelectorAll('[data-log-select]:checked')]
        .map(input => input.value);
}

function renderLogs(files) {
    if (!files.length) {
        els.logsBody.innerHTML = '<tr><td colspan="6" class="empty-cell">ログはまだありません。</td></tr>';
        return;
    }

    els.logsBody.innerHTML = files.map(file => {
        const isJsonl = file.ext === '.jsonl';
        return `
            <tr>
                <td>
                    ${isJsonl ? `<input data-log-select type="checkbox" value="${file.path}">` : ''}
                </td>
                <td class="file-name">${file.name}</td>
                <td><span class="badge">${getKind(file)}</span></td>
                <td>${formatBytes(file.size)}</td>
                <td>${formatDate(file.modifiedAt)}</td>
                <td><a href="${apiBase}${file.url}" target="_blank" rel="noreferrer">開く</a></td>
            </tr>
        `;
    }).join('');
}

async function loadProfiles() {
    const payload = await fetchJson('/api/simulation/profiles');
    const options = [
        '<option value="mixed">mixed</option>',
        ...payload.profiles.map(profile => `<option value="${profile.id}">${profile.id}</option>`),
        '<option value="custom">custom</option>'
    ];
    els.profiles.innerHTML = options.join('');
}

async function refreshLogs() {
    const payload = await fetchJson('/api/simulation/logs');
    renderLogs(payload.files);
}

async function runSimulation(event) {
    event.preventDefault();
    if (busy) return;

    setBusy(true, 'シミュレーション実行中');
    setOutput('');

    try {
        const payload = await fetchJson('/api/simulation/run', {
            method: 'POST',
            body: JSON.stringify({
                games: Number(els.games.value),
                players: Number(els.players.value),
                maxSteps: Number(els.maxSteps.value),
                seed: els.seed.value.trim(),
                profiles: profileValue(),
                analyze: els.runAnalysis.checked
            })
        });
        renderResult(payload);
        await refreshLogs();
        els.status.textContent = `完了: ${payload.timestamp}`;
    } catch (error) {
        els.status.innerHTML = `<span class="error-text">${error.message}</span>`;
        setOutput(error.stack || error.message);
    } finally {
        setBusy(false);
    }
}

async function analyzeSelected() {
    if (busy) return;
    const inputs = selectedJsonlPaths();
    if (inputs.length === 0) {
        els.status.textContent = 'JSONLログを選択してください';
        return;
    }

    setBusy(true, '分析実行中');
    setOutput('');
    try {
        const payload = await fetchJson('/api/simulation/analyze', {
            method: 'POST',
            body: JSON.stringify({ inputs })
        });
        renderResult({
            simulation: null,
            analysis: payload.analysis
        });
        await refreshLogs();
        els.status.textContent = `分析完了: ${payload.analysis.timestamp}`;
    } catch (error) {
        els.status.innerHTML = `<span class="error-text">${error.message}</span>`;
        setOutput(error.stack || error.message);
    } finally {
        setBusy(false);
    }
}

els.profiles.addEventListener('change', () => {
    els.customProfileLabel.classList.toggle('is-hidden', els.profiles.value !== 'custom');
});

els.runForm.addEventListener('submit', runSimulation);
els.refresh.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true, '更新中');
    try {
        await refreshLogs();
        els.status.textContent = '更新完了';
    } catch (error) {
        els.status.innerHTML = `<span class="error-text">${error.message}</span>`;
    } finally {
        setBusy(false);
    }
});
els.analyzeSelected.addEventListener('click', analyzeSelected);

try {
    await loadProfiles();
    await refreshLogs();
    els.status.textContent = apiBase
        ? `待機中 API: ${apiBase}`
        : '待機中';
} catch (error) {
    els.status.innerHTML = `<span class="error-text">${error.message.replaceAll('\n', '<br>')}</span>`;
    setOutput(error.stack || error.message);
}
