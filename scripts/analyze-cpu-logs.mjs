import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Demands, FixedRoles, Resources, Specialties } from '../src/data.js';

const DEFAULT_OPTIONS = {
    in: 'logs/cpu-sim.jsonl',
    summary: 'logs/cpu-analysis-summary.json',
    report: 'logs/cpu-analysis-report.txt'
};

const demandById = Object.fromEntries(Demands.map(demand => [demand.id, demand]));
const roleById = Object.fromEntries(FixedRoles.map(role => [role.id, role]));
const specialtyById = Object.fromEntries(Object.values(Specialties).map(specialty => [specialty.id, specialty]));

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

        if (['in', 'summary', 'report'].includes(key)) {
            options[key] = value;
        } else {
            throw new Error(`Unknown option --${key}`);
        }
    }

    options.inputs = String(options.in)
        .split(',')
        .map(input => input.trim())
        .filter(Boolean);

    if (options.inputs.length === 0) {
        throw new Error('--in must include at least one JSONL path.');
    }

    return options;
}

function createStats(name = '') {
    return {
        id: '',
        name,
        count: 0,
        wins: 0,
        winRate: 0,
        finalScoreTotal: 0,
        averageFinalScore: 0,
        minFinalScore: Number.POSITIVE_INFINITY,
        maxFinalScore: Number.NEGATIVE_INFINITY
    };
}

function addCount(map, key, amount = 1) {
    map[key] = (map[key] || 0) + amount;
}

function recordStats(stats, player, didWin, amount = 1) {
    stats.count += amount;
    if (didWin) stats.wins += amount;
    stats.finalScoreTotal += player.score * amount;
    stats.minFinalScore = Math.min(stats.minFinalScore, player.score);
    stats.maxFinalScore = Math.max(stats.maxFinalScore, player.score);
}

function finalizeStatsMap(map) {
    Object.entries(map).forEach(([id, stats]) => {
        stats.id = id;
        stats.winRate = stats.count > 0 ? stats.wins / stats.count : 0;
        stats.averageFinalScore = stats.count > 0 ? stats.finalScoreTotal / stats.count : 0;
        if (!Number.isFinite(stats.minFinalScore)) stats.minFinalScore = 0;
        if (!Number.isFinite(stats.maxFinalScore)) stats.maxFinalScore = 0;
    });
}

function getDemandCategory(demandId) {
    if (demandId.startsWith('d_basic')) return 'basic';
    if (demandId.startsWith('d_bonus')) return 'bonus';
    if (demandId.startsWith('d_lux')) return 'luxury';
    return 'other';
}

function ensureStats(map, id, name = id) {
    map[id] ||= createStats(name);
    return map[id];
}

async function readResults(inputs) {
    const results = [];
    for (const input of inputs) {
        const content = await readFile(input, 'utf8');
        content.split(/\r?\n/).forEach((line, index) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            const parsed = JSON.parse(trimmed);
            if (parsed.type !== 'game_result') {
                throw new Error(`${input}:${index + 1} is not a game_result entry.`);
            }
            results.push({ ...parsed, source: input });
        });
    }
    return results;
}

function analyze(results, options) {
    const summary = {
        sources: options.inputs,
        games: results.length,
        playerEntries: 0,
        averageScore: 0,
        averageSteps: 0,
        winCountsBySeat: {},
        profileStats: {},
        demandStats: {},
        demandStatsByProfile: {},
        demandCategoryStats: {},
        effectStats: {},
        roleStats: {},
        processingPlantStats: {},
        activeSpecialtyStats: {},
        cpuDecisionCountsByProfile: {}
    };

    let totalScore = 0;
    let totalSteps = 0;

    results.forEach(result => {
        totalSteps += result.steps;
        result.winners.forEach(id => addCount(summary.winCountsBySeat, String(id)));

        const playersById = Object.fromEntries(result.players.map(player => [player.id, player]));
        result.logs.forEach(log => {
            if (log.data?.type !== 'cpu_decision') return;
            const profileId = log.data.profileId || playersById[log.data.playerId]?.cpuProfileId || 'unknown';
            summary.cpuDecisionCountsByProfile[profileId] ||= {};
            addCount(summary.cpuDecisionCountsByProfile[profileId], log.data.action || 'unknown');
        });

        result.players.forEach(player => {
            const didWin = result.winners.includes(player.id);
            const profileId = player.cpuProfileId || 'unknown';
            const profileName = player.cpuProfileName || profileId;
            summary.playerEntries++;
            totalScore += player.score;

            recordStats(ensureStats(summary.profileStats, profileId, profileName), player, didWin);

            player.achievedDemands.forEach(record => {
                const demandId = typeof record === 'string' ? record : record.demandId;
                const demand = demandById[demandId];
                const demandStats = ensureStats(summary.demandStats, demandId, demand?.name || demandId);
                recordStats(demandStats, player, didWin);
                demandStats.category = getDemandCategory(demandId);
                demandStats.effect = demand?.effect || '';
                demandStats.pointsTotal = (demandStats.pointsTotal || 0) + (record.totalPoints ?? record.points ?? demand?.points ?? 0);
                demandStats.bonusPointsTotal = (demandStats.bonusPointsTotal || 0) + (record.bonusPoints || 0);
                demandStats.bonusCount = (demandStats.bonusCount || 0) + ((record.bonusPoints || 0) > 0 ? 1 : 0);

                summary.demandStatsByProfile[profileId] ||= {};
                const demandProfileStats = ensureStats(summary.demandStatsByProfile[profileId], demandId, demand?.name || demandId);
                recordStats(demandProfileStats, player, didWin);
                demandProfileStats.pointsTotal = (demandProfileStats.pointsTotal || 0) + (record.totalPoints ?? record.points ?? demand?.points ?? 0);

                const category = getDemandCategory(demandId);
                recordStats(ensureStats(summary.demandCategoryStats, category, category), player, didWin);

                if (demand?.effect) {
                    const effectStats = ensureStats(summary.effectStats, demand.effect, demand.effect);
                    recordStats(effectStats, player, didWin);
                    effectStats.demandCounts ||= {};
                    addCount(effectStats.demandCounts, demandId);
                }
            });

            player.achievedRoles.forEach(roleId => {
                const role = roleById[roleId];
                const roleStats = ensureStats(summary.roleStats, roleId, role?.name || roleId);
                recordStats(roleStats, player, didWin);
                roleStats.points = role?.points || 0;
            });

            player.processingPlants.forEach(resourceId => {
                const resource = Resources[resourceId];
                recordStats(ensureStats(summary.processingPlantStats, resourceId, resource?.name || resourceId), player, didWin);
            });

            player.activeSpecialties.forEach(specialtyId => {
                const specialty = specialtyById[specialtyId];
                const stats = ensureStats(summary.activeSpecialtyStats, specialtyId, specialty?.name || specialtyId);
                recordStats(stats, player, didWin);
                stats.resourceId = specialty?.resource || '';
            });
        });
    });

    summary.averageScore = totalScore / Math.max(summary.playerEntries, 1);
    summary.averageSteps = totalSteps / Math.max(summary.games, 1);

    [
        summary.profileStats,
        summary.demandStats,
        summary.demandCategoryStats,
        summary.effectStats,
        summary.roleStats,
        summary.processingPlantStats,
        summary.activeSpecialtyStats
    ].forEach(finalizeStatsMap);

    Object.values(summary.demandStats).forEach(stats => {
        stats.averageCardPoints = stats.count > 0 ? (stats.pointsTotal || 0) / stats.count : 0;
        stats.averageBonusPoints = stats.count > 0 ? (stats.bonusPointsTotal || 0) / stats.count : 0;
        stats.bonusRate = stats.count > 0 ? (stats.bonusCount || 0) / stats.count : 0;
    });

    Object.values(summary.demandStatsByProfile).forEach(profileMap => {
        finalizeStatsMap(profileMap);
        Object.values(profileMap).forEach(stats => {
            stats.averageCardPoints = stats.count > 0 ? (stats.pointsTotal || 0) / stats.count : 0;
        });
    });

    [
        summary.profileStats,
        summary.demandStats,
        summary.demandCategoryStats,
        summary.effectStats,
        summary.roleStats,
        summary.processingPlantStats,
        summary.activeSpecialtyStats
    ].forEach(map => {
        Object.values(map).forEach(stats => {
            stats.averageScoreDelta = stats.averageFinalScore - summary.averageScore;
        });
    });

    return summary;
}

function formatNumber(value, digits = 2) {
    return Number.isFinite(value) ? value.toFixed(digits) : String(value);
}

function formatPercent(value) {
    return `${formatNumber(value * 100, 1)}%`;
}

function sortedStats(map) {
    return Object.values(map).sort((a, b) =>
        b.count - a.count ||
        b.averageFinalScore - a.averageFinalScore ||
        a.id.localeCompare(b.id)
    );
}

function pushStatsTable(lines, title, stats, valueFormatter) {
    lines.push(title);
    lines.push('-'.repeat(title.length));
    if (stats.length === 0) {
        lines.push('なし');
        lines.push('');
        return;
    }

    stats.forEach(item => {
        lines.push(valueFormatter(item));
    });
    lines.push('');
}

function createReport(summary, options) {
    const lines = [];
    lines.push('CPU Simulation Analysis Report');
    lines.push('==============================');
    lines.push('');
    lines.push('Run Summary');
    lines.push('-----------');
    lines.push(`Sources: ${options.inputs.join(', ')}`);
    lines.push(`Games: ${summary.games}`);
    lines.push(`Player entries: ${summary.playerEntries}`);
    lines.push(`Average score: ${formatNumber(summary.averageScore)}`);
    lines.push(`Average CPU steps: ${formatNumber(summary.averageSteps)}`);
    lines.push(`Summary JSON: ${options.summary}`);
    lines.push('');

    lines.push('Notes');
    lines.push('-----');
    lines.push('- Win rate is calculated per player entry. Tied winners all count as wins.');
    lines.push('- Delta is the average final score difference from the overall player average.');
    lines.push('- Demand card stats use achieved demand records, so unachieved public appearances are not counted yet.');
    lines.push('- Role stats use achieved role IDs; bonus-point details are not stored in the current JSONL format.');
    lines.push('- Active specialty counts use final active specialty copies, including duplicates.');
    lines.push('');

    pushStatsTable(lines, 'Profile Results', sortedStats(summary.profileStats), stats =>
        `${stats.id} (${stats.name}): count=${stats.count}, winRate=${formatPercent(stats.winRate)}, avgScore=${formatNumber(stats.averageFinalScore)}, delta=${formatNumber(stats.averageScoreDelta)}, min=${stats.minFinalScore}, max=${stats.maxFinalScore}`
    );

    pushStatsTable(lines, 'Demand Category Results', sortedStats(summary.demandCategoryStats), stats =>
        `${stats.id}: count=${stats.count}, winRate=${formatPercent(stats.winRate)}, avgScore=${formatNumber(stats.averageFinalScore)}, delta=${formatNumber(stats.averageScoreDelta)}`
    );

    pushStatsTable(lines, 'Demand Card Results', sortedStats(summary.demandStats), stats =>
        `${stats.id} ${stats.name}: count=${stats.count}, winRate=${formatPercent(stats.winRate)}, avgScore=${formatNumber(stats.averageFinalScore)}, delta=${formatNumber(stats.averageScoreDelta)}, avgCardPts=${formatNumber(stats.averageCardPoints)}, bonusRate=${formatPercent(stats.bonusRate || 0)}, effect=${stats.effect || 'none'}`
    );

    pushStatsTable(lines, 'Effect Results', sortedStats(summary.effectStats), stats =>
        `${stats.id}: count=${stats.count}, winRate=${formatPercent(stats.winRate)}, avgScore=${formatNumber(stats.averageFinalScore)}, delta=${formatNumber(stats.averageScoreDelta)}, demands=${Object.keys(stats.demandCounts || {}).join(', ')}`
    );

    pushStatsTable(lines, 'Fixed Role Results', sortedStats(summary.roleStats), stats =>
        `${stats.id} ${stats.name}: count=${stats.count}, winRate=${formatPercent(stats.winRate)}, avgScore=${formatNumber(stats.averageFinalScore)}, delta=${formatNumber(stats.averageScoreDelta)}, basePts=${stats.points}`
    );

    pushStatsTable(lines, 'Processing Plant Results', sortedStats(summary.processingPlantStats), stats =>
        `${stats.id} ${stats.name}: count=${stats.count}, winRate=${formatPercent(stats.winRate)}, avgScore=${formatNumber(stats.averageFinalScore)}, delta=${formatNumber(stats.averageScoreDelta)}`
    );

    pushStatsTable(lines, 'Active Specialty Results', sortedStats(summary.activeSpecialtyStats), stats =>
        `${stats.id} ${stats.name}: count=${stats.count}, winRate=${formatPercent(stats.winRate)}, avgScore=${formatNumber(stats.averageFinalScore)}, delta=${formatNumber(stats.averageScoreDelta)}, resource=${stats.resourceId}`
    );

    lines.push('CPU Decision Counts By Profile');
    lines.push('------------------------------');
    Object.entries(summary.cpuDecisionCountsByProfile)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([profileId, counts]) => {
            const text = Object.entries(counts)
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([action, count]) => `${action}:${count}`)
                .join(', ');
            lines.push(`${profileId}: ${text}`);
        });
    lines.push('');

    return lines.join('\n') + '\n';
}

async function writeTextFile(filePath, content) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const results = await readResults(options.inputs);
    const summary = analyze(results, options);
    const report = createReport(summary, options);

    await writeTextFile(options.summary, JSON.stringify(summary, null, 2) + '\n');
    await writeTextFile(options.report, report);

    console.log(`Analyzed ${summary.games} game(s) from ${options.inputs.join(', ')}`);
    console.log(`Wrote analysis summary to ${options.summary}`);
    console.log(`Wrote analysis report to ${options.report}`);
    console.log(JSON.stringify({
        games: summary.games,
        playerEntries: summary.playerEntries,
        averageScore: summary.averageScore,
        topDemandCards: sortedStats(summary.demandStats).slice(0, 5).map(stats => ({
            id: stats.id,
            name: stats.name,
            count: stats.count,
            winRate: stats.winRate,
            averageFinalScore: stats.averageFinalScore
        })),
        topEffects: sortedStats(summary.effectStats).slice(0, 5).map(stats => ({
            id: stats.id,
            count: stats.count,
            winRate: stats.winRate,
            averageFinalScore: stats.averageFinalScore
        }))
    }, null, 2));
}

main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
});
