import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CPU, CPU_PROFILES, DEFAULT_CPU_PROFILE_ID, getCpuProfile } from '../src/cpu.js';
import { GameState } from '../src/game.js';
import { logger } from '../src/logger.js';
import { createSeededRandom } from '../src/random.js';

const DEFAULT_OPTIONS = {
    games: 1,
    players: 5,
    seed: '1',
    profiles: DEFAULT_CPU_PROFILE_ID,
    outputDir: 'logs/simulations',
    timestamp: null,
    out: null,
    summary: null,
    report: null,
    maxSteps: 5000
};

function formatTimestampForFile(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('') + '-' + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join('');
}

function sanitizeTimestamp(value) {
    return String(value || '')
        .replace(/[^0-9A-Za-z_-]/g, '')
        .slice(0, 40);
}

function parseArgs(argv) {
    const options = { ...DEFAULT_OPTIONS };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
            throw new Error(`Missing value for --${key}`);
        }
        i++;

        if (['games', 'players', 'max-steps'].includes(key)) {
            options[key === 'max-steps' ? 'maxSteps' : key] = Number(value);
        } else if (['seed', 'profiles', 'output-dir', 'timestamp', 'out', 'summary', 'report'].includes(key)) {
            options[key === 'output-dir' ? 'outputDir' : key] = value;
        } else {
            throw new Error(`Unknown option --${key}`);
        }
    }

    if (!Number.isInteger(options.games) || options.games < 1) {
        throw new Error('--games must be a positive integer.');
    }
    if (!Number.isInteger(options.players) || options.players < 2 || options.players > 5) {
        throw new Error('--players must be an integer from 2 to 5.');
    }
    if (!Number.isInteger(options.maxSteps) || options.maxSteps < 1) {
        throw new Error('--max-steps must be a positive integer.');
    }
    options.timestamp = sanitizeTimestamp(options.timestamp) || formatTimestampForFile();
    options.generatedAt = new Date().toISOString();
    options.out ||= path.join(options.outputDir, `cpu-sim-${options.timestamp}.jsonl`);
    options.summary ||= path.join(options.outputDir, `cpu-sim-${options.timestamp}-summary.json`);
    options.report ||= path.join(options.outputDir, `cpu-sim-${options.timestamp}.txt`);
    options.profileIds = parseProfileIds(options.profiles, options.players);

    return options;
}

function parseProfileIds(value, playerCount) {
    const available = Object.keys(CPU_PROFILES);
    const raw = String(value || DEFAULT_CPU_PROFILE_ID).trim();
    const requested = raw === 'mixed'
        ? available
        : raw.split(',').map(id => id.trim()).filter(Boolean);

    if (requested.length === 0) {
        throw new Error('--profiles must include at least one profile id.');
    }

    requested.forEach(id => {
        if (!CPU_PROFILES[id]) {
            throw new Error(`Unknown CPU profile "${id}". Available profiles: ${available.join(', ')}, mixed.`);
        }
    });

    return Array.from({ length: playerCount }, (_, index) => getCpuProfile(requested[index % requested.length]).id);
}

function getCurrentActor(game) {
    if (game.phase === 'setup') return game.players[game.setupPlayerIndex] || null;
    if (game.phase === 'free_development') return game.players[game.devPlayerIndex] || null;
    return game.getCurrentPlayer();
}

function makePlayerResult(player) {
    return {
        id: player.id,
        name: player.name,
        cpuProfileId: player.cpuProfileId || DEFAULT_CPU_PROFILE_ID,
        cpuProfileName: player.cpuProfileName || getCpuProfile(player.cpuProfileId).name,
        score: player.score,
        handCount: player.hand.length,
        activeSpecialties: [...player.activeSpecialties],
        inactiveSpecialties: [...player.inactiveSpecialties],
        processingPlants: [...(player.processingPlants || [])],
        achievedDemands: [...(player.achievedDemands || [])],
        achievedRoles: [...(player.achievedRoles || [])]
    };
}

function makeLogEntry(entry, index) {
    return {
        index,
        timestamp: entry.timestamp || null,
        time: entry.time || null,
        message: entry.message,
        data: entry.data ?? null
    };
}

function runGame({ gameIndex, players, seed, maxSteps, profileIds }) {
    const gameSeed = `${seed}:${gameIndex}`;
    const game = new GameState({ random: createSeededRandom(gameSeed) });
    logger.clear();
    game.init({ human: 0, cpu: players });
    const assignedProfiles = game.players.map((player, index) => {
        const profile = getCpuProfile(profileIds[index]);
        player.cpuProfileId = profile.id;
        player.cpuProfileName = profile.name;
        return {
            playerId: player.id,
            playerName: player.name,
            profileId: profile.id,
            profileName: profile.name
        };
    });
    logger.log('CPU profiles assigned', {
        type: 'cpu_profiles',
        profiles: assignedProfiles
    });

    let steps = 0;
    while (!game.isGameOver && steps < maxSteps) {
        const actor = getCurrentActor(game);
        if (!actor) {
            throw new Error(`No actor for phase ${game.phase}.`);
        }
        if (!actor.isCpu) {
            throw new Error(`Non-CPU actor ${actor.name} encountered in CPU-only simulation.`);
        }

        const changed = CPU.takeAction(game, actor);
        steps++;
        if (!changed) {
            throw new Error(`CPU action made no progress in phase ${game.phase} for ${actor.name}.`);
        }
    }

    if (!game.isGameOver) {
        throw new Error(`Game ${gameIndex} exceeded max steps ${maxSteps}.`);
    }

    const playersResult = game.players.map(makePlayerResult);
    const maxScore = Math.max(...playersResult.map(player => player.score));
    const winners = playersResult.filter(player => player.score === maxScore).map(player => player.id);

    return {
        type: 'game_result',
        generatedAt: new Date().toISOString(),
        gameIndex,
        seed: gameSeed,
        playerCount: players,
        profiles: assignedProfiles,
        steps,
        winners,
        players: playersResult,
        logs: logger.logs.map(makeLogEntry)
    };
}

function addCount(map, key, amount = 1) {
    map[key] = (map[key] || 0) + amount;
}

function summarize(results, options) {
    const summary = {
        games: results.length,
        generatedAt: options.generatedAt,
        timestamp: options.timestamp,
        players: options.players,
        seed: String(options.seed),
        profiles: [...options.profileIds],
        averageSteps: 0,
        averageScore: 0,
        winCountsBySeat: {},
        scoreBySeat: {},
        scoreByProfile: {},
        demandCounts: {},
        demandCountsByProfile: {},
        roleCounts: {},
        roleCountsByProfile: {},
        cpuDecisionCounts: {},
        cpuDecisionCountsByProfile: {}
    };

    let totalSteps = 0;
    let totalScore = 0;
    let scoreEntries = 0;

    results.forEach(result => {
        totalSteps += result.steps;
        result.winners.forEach(id => addCount(summary.winCountsBySeat, String(id)));

        result.players.forEach(player => {
            const seat = String(player.id);
            const profileId = player.cpuProfileId || DEFAULT_CPU_PROFILE_ID;
            const scoreStats = summary.scoreBySeat[seat] || {
                games: 0,
                total: 0,
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                average: 0
            };
            scoreStats.games++;
            scoreStats.total += player.score;
            scoreStats.min = Math.min(scoreStats.min, player.score);
            scoreStats.max = Math.max(scoreStats.max, player.score);
            summary.scoreBySeat[seat] = scoreStats;

            const profileStats = summary.scoreByProfile[profileId] || {
                name: player.cpuProfileName || getCpuProfile(profileId).name,
                games: 0,
                wins: 0,
                total: 0,
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                average: 0
            };
            profileStats.games++;
            profileStats.total += player.score;
            profileStats.min = Math.min(profileStats.min, player.score);
            profileStats.max = Math.max(profileStats.max, player.score);
            if (result.winners.includes(player.id)) profileStats.wins++;
            summary.scoreByProfile[profileId] = profileStats;

            totalScore += player.score;
            scoreEntries++;

            player.achievedDemands.forEach(record => {
                const demandId = typeof record === 'string' ? record : record.demandId;
                addCount(summary.demandCounts, demandId);
                summary.demandCountsByProfile[profileId] ||= {};
                addCount(summary.demandCountsByProfile[profileId], demandId);
            });
            player.achievedRoles.forEach(roleId => addCount(summary.roleCounts, roleId));
            player.achievedRoles.forEach(roleId => {
                summary.roleCountsByProfile[profileId] ||= {};
                addCount(summary.roleCountsByProfile[profileId], roleId);
            });
        });
        result.logs.forEach(log => {
            if (log.data?.type === 'cpu_decision') {
                addCount(summary.cpuDecisionCounts, log.data.action || 'unknown');
                const profileId = log.data.profileId || DEFAULT_CPU_PROFILE_ID;
                summary.cpuDecisionCountsByProfile[profileId] ||= {};
                addCount(summary.cpuDecisionCountsByProfile[profileId], log.data.action || 'unknown');
            }
        });
    });

    summary.averageSteps = totalSteps / Math.max(results.length, 1);
    summary.averageScore = totalScore / Math.max(scoreEntries, 1);

    Object.values(summary.scoreBySeat).forEach(stats => {
        stats.average = stats.total / Math.max(stats.games, 1);
    });
    Object.values(summary.scoreByProfile).forEach(stats => {
        stats.average = stats.total / Math.max(stats.games, 1);
    });

    return summary;
}

const LOG_ANNOTATIONS = [
    {
        id: 'cpu_decision',
        label: 'CPU判断',
        description: 'CPUが候補をスコア評価して選んだ行動です。dataにプロファイル、選択理由、候補、スコアなどを記録します。',
        match: message => message.startsWith('CPU_DECISION')
    },
    {
        id: 'game_start',
        label: 'ゲーム開始',
        description: '試合の初期化条件です。CPU人数や初期配置フェーズ開始を示します。',
        match: message => message.includes('ゲーム開始')
    },
    {
        id: 'cpu_profiles',
        label: 'CPU設定',
        description: '席ごとに割り当てたCPUプロファイルです。プロファイルごとの傾向比較に使います。',
        match: message => message.includes('CPU profiles assigned')
    },
    {
        id: 'setup_complete',
        label: '初期配置完了',
        description: '全CPUの初期特産品選択が終わり、本編へ入ったことを示します。',
        match: message => message.includes('初期配置完了') || message.includes('第3ラウンド特産品稼働完了')
    },
    {
        id: 'round_start',
        label: 'ラウンド開始',
        description: '新しいラウンドや特殊フェーズの開始地点です。',
        match: message => /^--- ラウンド \d+ 開始/.test(message)
    },
    {
        id: 'public_demands',
        label: '公開需要',
        description: 'その時点で場に公開されている需要カード一覧です。',
        match: message => message.includes('公開需要カード')
    },
    {
        id: 'production',
        label: '資源生産',
        description: '稼働中の特産品から手札へ資源が追加された記録です。',
        match: message => message.includes('資源を生産')
    },
    {
        id: 'turn_start',
        label: 'ターン開始',
        description: '対象CPUの手番開始です。ここから需要達成、固定役、AP行動が実行されます。',
        match: message => message.includes('のターンです')
    },
    {
        id: 'demand_ap',
        label: '追加需要AP',
        description: '同一ターン2回目以降の需要達成で1APを消費した記録です。',
        match: message => message.includes('追加需要達成のため1AP')
    },
    {
        id: 'demand_achieved',
        label: '需要達成',
        description: '公開需要カードを達成し、得点やカード効果を得た記録です。',
        match: message => message.includes('需要達成')
    },
    {
        id: 'fixed_role',
        label: '固定役達成',
        description: '固定役表の条件を満たして得点した記録です。ターン1回までの無料行動です。',
        match: message => message.includes('固定役達成')
    },
    {
        id: 'processing_plant',
        label: '加工所建設',
        description: '基本特産品に加工所を建て、以後その資源を加工品として扱えるようにした記録です。',
        match: message => message.includes('加工所を建設')
    },
    {
        id: 'market_exchange',
        label: 'マーケット交換',
        description: '手札資源を支払い、中央マーケットの資源を取得したAP行動または効果行動です。',
        match: message => message.includes('マーケット交換') || message.includes('割引交換')
    },
    {
        id: 'effect_resolution',
        label: '効果解決',
        description: '需要カードなどで得た即時効果の獲得または解決内容です。',
        match: message =>
            message.includes('効果を得ました') ||
            message.includes('効果で') ||
            message.includes('効果を解決') ||
            message.includes('マーケットを')
    },
    {
        id: 'discard',
        label: '手札破棄',
        description: '手札上限超過や交換効果により、手札を破棄した記録です。',
        match: message => message.includes('手札上限') || message.includes('破棄')
    },
    {
        id: 'turn_end_refill',
        label: 'ターン終了補充',
        description: 'ターン終了時に空いたマーケット枠へ山札から補充した記録です。',
        match: message => message.includes('ターン終了時')
    },
    {
        id: 'turn_end',
        label: 'ターン終了',
        description: '対象CPUの手番が終わり、次のプレイヤーへ進む地点です。',
        match: message => message.includes('ターンが終了')
    },
    {
        id: 'round_score',
        label: 'ラウンド得点',
        description: 'ラウンド終了時点の全CPU得点状況です。',
        match: message => message.includes('得点状況')
    },
    {
        id: 'deck_status',
        label: '山札状況',
        description: 'ラウンド終了時点のマーケット山札と需要山札の残数です。',
        match: message => message.includes('山札:')
    },
    {
        id: 'market_refresh',
        label: 'マーケット更新',
        description: 'ラウンド終了や山札切れに伴う中央マーケット更新です。',
        match: message => message.includes('中央マーケットを全入れ替え') || message.includes('補充山札')
    },
    {
        id: 'game_end',
        label: 'ゲーム終了',
        description: 'ゲーム終了、順位、最終得点の出力です。',
        match: message => message.includes('ゲーム終了') || message.includes('最終結果') || /位:/.test(message)
    },
    {
        id: 'warning',
        label: '警告',
        description: '山札枯れや不整合など、進行上の注意点です。',
        match: message => message.includes('警告')
    }
];

const DEFAULT_LOG_ANNOTATION = {
    id: 'event',
    label: 'イベント',
    description: '分類ルールに未登録の通常ログです。ゲーム進行の補足情報として扱います。'
};

function annotateLog(message) {
    return LOG_ANNOTATIONS.find(annotation => annotation.match(message)) || DEFAULT_LOG_ANNOTATION;
}

function formatNumber(value, digits = 2) {
    return Number.isFinite(value) ? value.toFixed(digits) : String(value);
}

function formatObjectMap(map) {
    const entries = Object.entries(map);
    if (entries.length === 0) return 'なし';
    return entries
        .sort((a, b) => Number(a[0]) - Number(b[0]) || a[0].localeCompare(b[0]))
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
}

function createAnnotatedReport(results, summary, options) {
    const lines = [];
    lines.push('CPU Simulation Annotated Report');
    lines.push('================================');
    lines.push('');
    lines.push('Run Summary');
    lines.push('-----------');
    lines.push(`Generated at: ${summary.generatedAt}`);
    lines.push(`Run timestamp: ${summary.timestamp}`);
    lines.push(`Games: ${summary.games}`);
    lines.push(`Players: ${summary.players}`);
    lines.push(`Seed: ${summary.seed}`);
    lines.push(`Profiles by seat: ${summary.profiles.join(', ')}`);
    lines.push(`Average score: ${formatNumber(summary.averageScore)}`);
    lines.push(`Average CPU steps: ${formatNumber(summary.averageSteps)}`);
    lines.push(`Win counts by seat: ${formatObjectMap(summary.winCountsBySeat)}`);
    lines.push(`JSONL source: ${options.out}`);
    lines.push(`Summary source: ${options.summary}`);
    lines.push('');

    lines.push('Log Item Notes');
    lines.push('--------------');
    LOG_ANNOTATIONS.forEach(annotation => {
        lines.push(`- [${annotation.label}] ${annotation.description}`);
    });
    lines.push(`- [${DEFAULT_LOG_ANNOTATION.label}] ${DEFAULT_LOG_ANNOTATION.description}`);
    lines.push('');

    lines.push('Aggregate Scores By Seat');
    lines.push('------------------------');
    Object.entries(summary.scoreBySeat)
        .sort(([a], [b]) => Number(a) - Number(b))
        .forEach(([seat, stats]) => {
            lines.push(`Seat ${seat}: avg=${formatNumber(stats.average)}, min=${stats.min}, max=${stats.max}, games=${stats.games}`);
        });
    lines.push('');

    lines.push('Aggregate Scores By Profile');
    lines.push('---------------------------');
    Object.entries(summary.scoreByProfile)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([profileId, stats]) => {
            lines.push(`${profileId} (${stats.name}): avg=${formatNumber(stats.average)}, min=${stats.min}, max=${stats.max}, seats=${stats.games}, wins=${stats.wins}`);
        });
    lines.push('');

    lines.push('Aggregate Demand Counts');
    lines.push('-----------------------');
    Object.entries(summary.demandCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .forEach(([id, count]) => lines.push(`${id}: ${count}`));
    lines.push('');

    lines.push('Aggregate Role Counts');
    lines.push('---------------------');
    Object.entries(summary.roleCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .forEach(([id, count]) => lines.push(`${id}: ${count}`));
    lines.push('');

    lines.push('Aggregate CPU Decision Counts');
    lines.push('-----------------------------');
    Object.entries(summary.cpuDecisionCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .forEach(([id, count]) => lines.push(`${id}: ${count}`));
    lines.push('');

    lines.push('Aggregate CPU Decision Counts By Profile');
    lines.push('----------------------------------------');
    Object.entries(summary.cpuDecisionCountsByProfile)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([profileId, counts]) => {
            lines.push(`${profileId}: ${formatObjectMap(counts)}`);
        });
    lines.push('');

    lines.push('Integrated Match Logs');
    lines.push('---------------------');
    results.forEach(result => {
        lines.push('');
        lines.push(`Game ${result.gameIndex} / seed=${result.seed} / steps=${result.steps}`);
        lines.push(`Winners: ${result.winners.map(id => `CPU ${id + 1}`).join(', ')}`);
        lines.push('Final standings:');
        [...result.players]
            .sort((a, b) => b.score - a.score || a.id - b.id)
            .forEach((player, index) => {
                lines.push(`  ${index + 1}. ${player.name} [${player.cpuProfileId}]: ${player.score} points, hand=${player.handCount}, demands=${player.achievedDemands.length}, roles=${player.achievedRoles.length}, plants=${player.processingPlants.length}`);
            });
        lines.push('Logs:');
        result.logs.forEach(log => {
            const annotation = annotateLog(log.message);
            lines.push(`  ${String(log.index).padStart(4, '0')} [${annotation.label}] ${log.message}`);
            if (log.data) {
                lines.push(`       data: ${JSON.stringify(log.data)}`);
            }
        });
    });

    return lines.join('\n') + '\n';
}

async function writeTextFile(filePath, content) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const previousConsoleEnabled = logger.consoleEnabled;
    const previousOnLogAdded = logger.onLogAdded;
    logger.consoleEnabled = false;
    logger.onLogAdded = null;

    try {
        const results = [];
        for (let gameIndex = 0; gameIndex < options.games; gameIndex++) {
            results.push(runGame({ ...options, gameIndex }));
        }

        const jsonl = results.map(result => JSON.stringify(result)).join('\n') + '\n';
        const summary = summarize(results, options);
        const report = createAnnotatedReport(results, summary, options);

        await writeTextFile(options.out, jsonl);
        await writeTextFile(options.summary, JSON.stringify(summary, null, 2) + '\n');
        await writeTextFile(options.report, report);

        console.log(`Wrote ${results.length} game(s) to ${options.out}`);
        console.log(`Wrote summary to ${options.summary}`);
        console.log(`Wrote annotated report to ${options.report}`);
        console.log(JSON.stringify({
            games: summary.games,
            players: summary.players,
            seed: summary.seed,
            profiles: summary.profiles,
            averageScore: summary.averageScore,
            averageSteps: summary.averageSteps,
            winCountsBySeat: summary.winCountsBySeat,
            scoreByProfile: summary.scoreByProfile
        }, null, 2));
    } finally {
        logger.consoleEnabled = previousConsoleEnabled;
        logger.onLogAdded = previousOnLogAdded;
    }
}

main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
});
