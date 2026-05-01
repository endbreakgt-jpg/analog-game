import { Demands, FixedRoles, Resources, ResourceTypes, Specialties, getDemandVariants } from './data.js';
import * as Actions from './actions.js';

// =============================================
// 共通ヘルパー
// =============================================

/** 配列から指定枚数の組み合わせ（インデックス）を列挙 */
function indexCombinations(arr, count) {
    if (count === 0) return [[]];
    if (arr.length < count) return [];
    const [first, ...rest] = arr;
    return [
        ...indexCombinations(rest, count - 1).map(c => [first, ...c]),
        ...indexCombinations(rest, count),
    ];
}

/** 手札の全部分集合を列挙（短い順：無駄カードを消費しないため） */
function getAllSubsets(handIndices) {
    const result = [[]];
    for (const idx of handIndices) {
        const len = result.length;
        for (let j = 0; j < len; j++) {
            result.push([...result[j], idx]);
        }
    }
    return result.filter(a => a.length > 0).sort((a, b) => a.length - b.length);
}

/**
 * 現在可能なマーケット交換候補を全列挙する。
 * 各候補: { handIndices: number[], marketIndex: number }
 * 交換ルール:
 *   基本資源2枚 → マーケットの基本資源1枚
 *   基本資源3枚 → マーケットの交易品1枚
 *   交易品1枚   → マーケットの基本資源1枚
 *   交易品2枚   → マーケットの交易品1枚
 */
function getValidMarketTrades(player, marketCards) {
    const trades = [];
    const hand = player.hand;

    const baseIdxInHand = hand.map((id, i) => Resources[id].type === ResourceTypes.BASE ? i : -1).filter(i => i !== -1);
    const tradeIdxInHand = hand.map((id, i) => Resources[id].type === ResourceTypes.TRADE ? i : -1).filter(i => i !== -1);

    const baseIdxInMarket = marketCards.map((id, i) => id && Resources[id].type === ResourceTypes.BASE ? i : -1).filter(i => i !== -1);
    const tradeIdxInMarket = marketCards.map((id, i) => id && Resources[id].type === ResourceTypes.TRADE ? i : -1).filter(i => i !== -1);

    // 1. 基本資源2枚 → 基本資源
    if (baseIdxInHand.length >= 2) {
        for (const combo of indexCombinations(baseIdxInHand, 2)) {
            for (const mi of baseIdxInMarket) {
                trades.push({ handIndices: combo, marketIndex: mi });
            }
        }
    }

    // 2. 基本資源3枚 → 交易品
    if (baseIdxInHand.length >= 3) {
        for (const combo of indexCombinations(baseIdxInHand, 3)) {
            for (const mi of tradeIdxInMarket) {
                trades.push({ handIndices: combo, marketIndex: mi });
            }
        }
    }

    // 3. 交易品1枚 → 基本資源
    if (tradeIdxInHand.length >= 1) {
        for (const idx of tradeIdxInHand) {
            for (const mi of baseIdxInMarket) {
                trades.push({ handIndices: [idx], marketIndex: mi });
            }
        }
    }

    // 4. 交易品2枚 → 交易品
    if (tradeIdxInHand.length >= 2) {
        for (const combo of indexCombinations(tradeIdxInHand, 2)) {
            for (const mi of tradeIdxInMarket) {
                trades.push({ handIndices: combo, marketIndex: mi });
            }
        }
    }

    return trades;
}

// 割引マーケット交換（大商館納品効果）用の候補列挙。
function getValidDiscountedMarketTrades(player, marketCards) {
    const trades = [];
    const hand = player.hand;

    const baseIdxInHand = hand.map((id, i) => Resources[id].type === ResourceTypes.BASE ? i : -1).filter(i => i !== -1);
    const tradeIdxInHand = hand.map((id, i) => Resources[id].type === ResourceTypes.TRADE ? i : -1).filter(i => i !== -1);
    const baseIdxInMarket = marketCards.map((id, i) => id && Resources[id].type === ResourceTypes.BASE ? i : -1).filter(i => i !== -1);
    const tradeIdxInMarket = marketCards.map((id, i) => id && Resources[id].type === ResourceTypes.TRADE ? i : -1).filter(i => i !== -1);

    if (baseIdxInHand.length >= 1) {
        for (const idx of baseIdxInHand) {
            for (const mi of baseIdxInMarket) {
                trades.push({ handIndices: [idx], marketIndex: mi });
            }
        }
    }

    if (baseIdxInHand.length >= 2) {
        for (const combo of indexCombinations(baseIdxInHand, 2)) {
            for (const mi of tradeIdxInMarket) {
                trades.push({ handIndices: combo, marketIndex: mi });
            }
        }
    }

    if (tradeIdxInHand.length >= 1) {
        for (const idx of tradeIdxInHand) {
            for (const mi of [...baseIdxInMarket, ...tradeIdxInMarket]) {
                trades.push({ handIndices: [idx], marketIndex: mi });
            }
        }
    }

    return trades;
}

function getBaseResourceNeedScores(game, player, hand = player.hand, excludedDemandId = null) {
    const scores = {};
    const demandObjs = game.demandCards
        .filter(id => id !== excludedDemandId)
        .map(id => Demands.find(d => d.id === id))
        .filter(Boolean);
    const roleObjs = FixedRoles.filter(r => !player.achievedRoles.includes(r.id));

    demandObjs.forEach(demand => {
        getDemandVariants(demand).forEach(variant => {
            Object.entries(variant.req).forEach(([key, val]) => {
                if (!key.startsWith('_') && Resources[key]?.type === ResourceTypes.BASE) {
                    const has = hand.filter(id => id === key).length;
                    scores[key] = (scores[key] || 0) + Math.max(0, val - has);
                }
            });
        });
    });

    roleObjs.forEach(obj => {
        Object.entries(obj.req).forEach(([key, val]) => {
            if (!key.startsWith('_') && Resources[key]?.type === ResourceTypes.BASE) {
                const has = hand.filter(id => id === key).length;
                scores[key] = (scores[key] || 0) + Math.max(0, val - has);
            }
        });
    });

    return scores;
}

function getBuildableProcessingResources(game, player, hand = player.hand) {
    const processed = player.processingPlants || [];
    return player.activeSpecialties
        .map(sId => Specialties[sId])
        .filter(spec => spec && Resources[spec.resource].type === ResourceTypes.BASE)
        .filter(spec => !processed.includes(spec.resource))
        .filter(spec => hand.includes(spec.resource))
        .map(spec => spec.resource);
}

function hasRelevantProcessingOpportunity(game, player, hand = player.hand, excludedDemandId = null) {
    const buildableResources = getBuildableProcessingResources(game, player, hand);
    if (buildableResources.length === 0) return false;

    const targets = [
        ...game.demandCards.filter(id => id !== excludedDemandId).map(id => Demands.find(d => d.id === id)),
        ...FixedRoles.filter(r => !player.achievedRoles.includes(r.id))
    ].filter(Boolean);

    const getReqs = (obj) => obj.variants ? getDemandVariants(obj).map(variant => variant.req) : [obj.req];

    return targets.some(obj =>
        getReqs(obj).some(req => req?._anyProcessed || req?._diffProcessed) ||
        (obj.bonus?.targets || []).some(resourceId => buildableResources.includes(resourceId))
    );
}

function countLowValueMarketCards(game, excludedDemandId = null) {
    const demandObjs = game.demandCards
        .filter(id => id !== excludedDemandId)
        .map(id => Demands.find(d => d.id === id))
        .filter(Boolean);
    return game.marketCards.filter(resourceId => {
        if (!resourceId) return false;
        return !demandObjs.some(demand =>
            getDemandVariants(demand).some(variant => variant.req[resourceId] > 0)
        );
    }).length;
}

const DEFAULT_UNKNOWN_EFFECT_VALUE = 0.75;
const MAX_EFFECT_VALUE = 2;

// 新しい効果付き需要カードを追加した場合は、effect名ごとにここへ評価関数を足す。
const DemandEffectEstimators = {
    gain_base_resource: ({ game, player, demand, remainingHand }) => {
        const needScores = getBaseResourceNeedScores(game, player, remainingHand, demand.id);
        return Math.max(...Object.values(needScores), 0) > 0 ? 1 : 0.5;
    },
    bonus_ap_next_turn: ({ game }) => {
        if (game.round >= game.maxRounds) return 0;
        if (game.round === game.maxRounds - 1) return 0.75;
        return 1.5;
    },
    free_processing_plant: ({ game, player, demand, remainingHand }) => {
        const buildable = getBuildableProcessingResources(game, player, remainingHand);
        if (buildable.length === 0) return 0.2;
        return hasRelevantProcessingOpportunity(game, player, remainingHand, demand.id) ? 2 : 1.5;
    },
    stockpile_exchange: ({ game, player, demand, remainingHand }) => {
        if (remainingHand.length === 0) return 0.2;
        const needScores = getBaseResourceNeedScores(game, player, remainingHand, demand.id);
        const wantedCount = Object.values(needScores).filter(score => score > 0).length;
        const disposableCount = remainingHand.filter(resourceId => (needScores[resourceId] || 0) === 0).length;
        const usefulExchangeCount = Math.min(2, wantedCount, Math.max(disposableCount, 1), remainingHand.length);
        return usefulExchangeCount === 0 ? 0.5 : 1 + (usefulExchangeCount - 1) * 0.5;
    },
    market_replace_2: ({ game, demand }) => {
        const lowValueCount = countLowValueMarketCards(game, demand.id);
        if (lowValueCount >= 2) return 1;
        if (lowValueCount === 1) return 0.75;
        return 0.5;
    },
    discounted_exchange: ({ game, player, remainingHand }) => {
        const simulatedPlayer = { ...player, hand: remainingHand };
        const trades = getValidDiscountedMarketTrades(simulatedPlayer, game.marketCards);
        return trades.length > 0 ? 1.5 : 0.3;
    },
    normal_market_exchange: ({ game, player, remainingHand }) => {
        const simulatedPlayer = { ...player, hand: remainingHand };
        const trades = getValidMarketTrades(simulatedPlayer, game.marketCards);
        return trades.length > 0 ? 1.25 : 0.25;
    },
    hand_exchange_1: ({ game, player, demand, remainingHand }) => {
        if (remainingHand.length === 0) return 0.2;
        const needScores = getBaseResourceNeedScores(game, player, remainingHand, demand.id);
        const wantedCount = Object.values(needScores).filter(score => score > 0).length;
        const disposableCount = remainingHand.filter(resourceId => (needScores[resourceId] || 0) === 0).length;
        return wantedCount > 0 && disposableCount > 0 ? 1 : 0.4;
    }
};

function estimateDemandEffectValue(game, player, demand, remainingHand) {
    if (!demand.effect) return 0;
    const estimator = DemandEffectEstimators[demand.effect];
    const value = estimator
        ? estimator({ game, player, demand, remainingHand })
        : DEFAULT_UNKNOWN_EFFECT_VALUE;
    return Math.max(0, Math.min(MAX_EFFECT_VALUE, value));
}

function evaluateDemandScore(game, player, demand, variant, check, hand, usedIndices) {
    const remainingHand = [...hand];
    [...usedIndices].sort((a, b) => b - a).forEach(idx => remainingHand.splice(idx, 1));
    return variant.points + check.bonusPoints + estimateDemandEffectValue(game, player, demand, remainingHand);
}

function getBestDemandEvaluation(game, player, demand, hand = player.hand) {
    const processed = player.processingPlants || [];
    const subsets = getAllSubsets(hand.map((_, i) => i));
    let best = null;

    for (const variant of getDemandVariants(demand)) {
        for (const subset of subsets) {
            const cards = subset.map(i => hand[i]);
            const check = Actions.ActionValidator.checkRequirements(cards, variant.req, processed, demand.bonus);
            if (!check.valid) continue;

            const score = evaluateDemandScore(game, player, demand, variant, check, hand, subset);
            if (!best || score > best.score) {
                best = { demand, variant, handIndices: subset, check, score };
            }
        }
    }

    return best;
}

function isBetterDemandEvaluation(candidate, currentBest) {
    if (!currentBest) return true;
    if (candidate.score !== currentBest.score) return candidate.score > currentBest.score;
    return Boolean(candidate.demand.effect) && !currentBest.demand.effect;
}

/**
 * 交換候補を評価して最善の1件を返す。
 * 評価軸:
 *   - 交換後の手札で需要達成できる → demand.points 分加点
 *   - 交換後の手札で固定役達成できる → role.points 分加点
 *   - 近づいた（不足枚数が減った）→ +2 or +1
 *   - 交易品を取得 → +1
 */
function chooseCpuMarketTrade(game, player) {
    const trades = getValidMarketTrades(player, game.marketCards);
    if (trades.length === 0) return null;

    const processed = player.processingPlants || [];
    const demandObjs = game.demandCards.map(id => Demands.find(d => d.id === id)).filter(Boolean);
    const roleObjs = FixedRoles.filter(r => !player.achievedRoles.includes(r.id));

    // ある手札で役が達成できるか
    function isAchievable(hand, req, bonus) {
        const idxArr = hand.map((_, i) => i);
        for (const sub of getAllSubsets(idxArr)) {
            const cards = sub.map(i => hand[i]);
            if (Actions.ActionValidator.checkRequirements(cards, req, processed, bonus).valid) return true;
        }
        return false;
    }

    // 不足枚数（具体指定資源のみ）
    function missingCount(hand, req) {
        let missing = 0;
        for (const [key, val] of Object.entries(req)) {
            if (!key.startsWith('_')) {
                const has = hand.filter(id => id === key).length;
                missing += Math.max(0, val - has);
            }
        }
        return missing;
    }

    const scored = trades.map(trade => {
        let score = 0;
        const acquired = game.marketCards[trade.marketIndex];

        // 交換後の手札をシミュレート
        const simHand = [...player.hand];
        [...trade.handIndices].sort((a, b) => b - a).forEach(i => simHand.splice(i, 1));
        simHand.push(acquired);

        // 需要達成への貢献
        for (const demand of demandObjs) {
            const nowEval = getBestDemandEvaluation(game, player, demand, player.hand);
            const afterEval = getBestDemandEvaluation(game, player, demand, simHand);
            if (afterEval && !nowEval) {
                score += afterEval.score;
            } else if (!afterEval) {
                const before = Math.min(...getDemandVariants(demand).map(variant => missingCount(player.hand, variant.req)));
                const after = Math.min(...getDemandVariants(demand).map(variant => missingCount(simHand, variant.req)));
                if (after < before) score += 2;
            }
        }

        // 固定役達成への貢献
        for (const role of roleObjs) {
            const nowOk = isAchievable(player.hand, role.req, role.bonus);
            const afterOk = isAchievable(simHand, role.req, role.bonus);
            if (afterOk && !nowOk) {
                score += role.points + (role.bonus ? role.bonus.points || 0 : 0);
            } else if (!afterOk) {
                const before = missingCount(player.hand, role.req);
                const after = missingCount(simHand, role.req);
                if (after < before) score += 1;
            }
        }

        // 交易品を取得するなら小加点
        if (acquired && Resources[acquired].type === ResourceTypes.TRADE) score += 1;

        return { trade, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // スコア 0 以下（何も改善しない）なら交換しない
    if (scored[0].score <= 0) return null;

    return scored[0].trade;
}

// =============================================
// CPUクラス
// =============================================

export class CPU {
    static takeAction(game, player) {
        if (game.phase === 'setup') {
            return this.cpuSetup(game, player);
        } else if (game.phase === 'free_development') {
            return this.cpuFreeDevelopment(game, player);
        } else if (game.phase === 'discard') {
            return this.cpuDiscard(game, player);
        } else if (game.phase === 'gain_resource') {
            return this.cpuGainResource(game, player);
        } else if (game.phase === 'market_replace') {
            return this.cpuMarketReplace(game, player);
        } else if (game.phase === 'stockpile_exchange') {
            return this.cpuStockpileExchange(game, player);
        } else if (game.phase === 'hand_exchange_1') {
            return this.cpuHandExchange(game, player, 1, '住宅整備');
        } else if (game.phase === 'playing') {
            return this.cpuTurn(game, player);
        }
        return false;
    }

    static cpuSetup(game, player) {
        game.completeSetup(player.id, [0, 1, 2]);
        return true;
    }

    static cpuFreeDevelopment(game, player) {
        game.completeFreeDevelopment(player.id, [0]);
        return true;
    }

    static cpuDiscard(game, player) {
        const maxHand = player.maxHandSize || game.maxHandSize;
        const excess = player.hand.length - maxHand;
        if (excess <= 0) return false;
        const discardIndices = Array.from({ length: excess }, (_, i) => i);
        game.completeDiscard(player.id, discardIndices);
        return true;
    }

    // 効果: 食料市 — 最も欲しい基本資源を自動選択
    static cpuGainResource(game, player) {
        const scores = this.getBaseResourceNeedScores(game, player);

        // 最もスコアが高い基本資源を選択（なければ木材）
        const baseResources = Object.values(Resources).filter(r => r.type === ResourceTypes.BASE);
        let best = baseResources[0].id;
        let bestScore = -1;
        baseResources.forEach(r => {
            const s = scores[r.id] || 0;
            if (s > bestScore) { bestScore = s; best = r.id; }
        });

        game.completeGainResource(player.id, best);
        return true;
    }

    // 効果: 造船材調達 — 需要に関係ない2枚を入れ替える
    static cpuMarketReplace(game, player) {
        const demandObjs = game.demandCards.map(id => Demands.find(d => d.id === id)).filter(Boolean);
        // マーケットの各カードの「欲しさ」をスコア化
        const marketScores = game.marketCards.map((id, i) => {
            if (!id) return { i, score: -999 };
            let score = 0;
            demandObjs.forEach(d => {
                getDemandVariants(d).forEach(variant => {
                    if (variant.req[id]) score += variant.req[id];
                    if (Resources[id].type === ResourceTypes.TRADE && variant.req._anyTrade) score += 0.75;
                    if (Resources[id].type === ResourceTypes.BASE && variant.req._anyBase) score += 0.5;
                });
            });
            return { i, score };
        });
        // スコアが低い順に最大2枚を入れ替え
        marketScores.sort((a, b) => a.score - b.score);
        const replaceIndices = marketScores.slice(0, 2).filter(x => x.score < 1).map(x => x.i);
        game.completeMarketReplace(replaceIndices);
        return true;
    }

    // 効果: 国家備蓄 — 不要度の低い手札を最大2枚、必要度の高い基本資源に交換する
    static cpuStockpileExchange(game, player) {
        return this.cpuHandExchange(game, player, 2, '国家備蓄');
    }

    static cpuHandExchange(game, player, maxCount, sourceName) {
        const scores = this.getBaseResourceNeedScores(game, player);
        const wantedResources = Object.values(Resources)
            .filter(r => r.type === ResourceTypes.BASE)
            .map(r => ({ id: r.id, score: scores[r.id] || 0 }))
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score);

        if (wantedResources.length === 0 || player.hand.length === 0) {
            game.completeHandExchange(player.id, [], [], maxCount, sourceName);
            return true;
        }

        const discardCandidates = player.hand
            .map((id, i) => ({ i, score: scores[id] || 0 }))
            .sort((a, b) => a.score - b.score);

        const exchangeCount = Math.min(maxCount, wantedResources.length, discardCandidates.length);
        const discardIndices = discardCandidates.slice(0, exchangeCount).map(x => x.i);
        const gainResources = wantedResources.slice(0, exchangeCount).map(x => x.id);

        game.completeHandExchange(player.id, discardIndices, gainResources, maxCount, sourceName);
        return true;
    }

    static getBaseResourceNeedScores(game, player) {
        return getBaseResourceNeedScores(game, player);
    }

    static tryAchieveBestDemand(game, player) {
        let best = null;

        for (const dId of game.demandCards) {
            const demand = Demands.find(d => d.id === dId);
            if (!demand) continue;
            const evaluation = getBestDemandEvaluation(game, player, demand);
            if (evaluation && isBetterDemandEvaluation(evaluation, best)) {
                best = evaluation;
            }
        }

        if (!best) return false;
        const res = Actions.executeDemand(game, player, best.demand.id, best.handIndices);
        return res.success;
    }

    static resolvePendingTurnEffect(game, player) {
        if (game.turnState.freeProcessingPlant) {
            const processed = player.processingPlants || [];
            for (let i = 0; i < player.activeSpecialties.length; i++) {
                const sId = player.activeSpecialties[i];
                const spec = Specialties[sId];
                if (Resources[spec.resource].type !== ResourceTypes.BASE) continue;
                if (processed.includes(spec.resource)) continue;
                const handIdx = player.hand.indexOf(spec.resource);
                if (handIdx === -1) continue;
                const res = Actions.executeBuildProcessingPlant(game, player, sId, handIdx, true);
                if (res.success) return true;
            }
            game.turnState.freeProcessingPlant = false;
        }

        if (game.turnState.freeMarketExchange) {
            const best = chooseCpuMarketTrade(game, player);
            if (best) {
                const res = Actions.executeExchange(game, player, best.handIndices, best.marketIndex, {
                    free: true,
                    source: '船団整備効果'
                });
                if (res.success) return true;
            }
            game.turnState.freeMarketExchange = false;
        }

        if (game.turnState.discountedExchange) {
            const discountTrades = getValidDiscountedMarketTrades(player, game.marketCards);
            if (discountTrades.length > 0) {
                const best = discountTrades[0];
                const res = Actions.executeDiscountedExchange(game, player, best.handIndices, best.marketIndex);
                if (res.success) return true;
            }
            game.turnState.discountedExchange = false;
        }

        return false;
    }

    static cpuTurn(game, player) {
        const processed = player.processingPlants || [];

        // 需要達成で得た即時効果は、次の通常アクションより先に処理する。
        if (this.resolvePendingTurnEffect(game, player)) {
            return true;
        }

        // -------------------------------------------------
        // 優先度1: 需要カードの達成 (1回目は無料)
        // -------------------------------------------------
        const demandCount = game.turnState.demandAchieveCount ?? (game.turnState.demandAchieved ? 1 : 0);
        if (demandCount === 0 && this.tryAchieveBestDemand(game, player)) {
            return true;
        }

        // -------------------------------------------------
        // 優先度2: 固定役の達成 (1ターンに1回まで)
        // -------------------------------------------------
        if (!game.turnState.roleAchieved) {
            const subsets = getAllSubsets(player.hand.map((_, i) => i));
            let bestRole = null, bestIndices = null, maxPts = -1;

            for (const role of FixedRoles) {
                if (player.achievedRoles.includes(role.id)) continue;
                for (const subset of subsets) {
                    const cards = subset.map(i => player.hand[i]);
                    const check = Actions.ActionValidator.checkRequirements(cards, role.req, processed, role.bonus);
                    if (check.valid) {
                        const pts = role.points + check.bonusPoints;
                        if (pts > maxPts) { maxPts = pts; bestRole = role; bestIndices = subset; }
                    }
                }
            }

            if (bestRole) {
                const res = Actions.executeFixedRole(game, player, bestRole.id, bestIndices);
                if (res.success) return true;
            }
        }

        // -------------------------------------------------
        // 優先度2.5: 追加需要達成 (2回目以降は1AP)
        // -------------------------------------------------
        const currentDemandCount = game.turnState.demandAchieveCount ?? (game.turnState.demandAchieved ? 1 : 0);
        if (currentDemandCount > 0 && game.actionsLeft > 0 && this.tryAchieveBestDemand(game, player)) {
            return true;
        }

        // -------------------------------------------------
        // 優先度3: 加工所の建設 (1AP)
        // -------------------------------------------------
        if (game.actionsLeft > 0) {
            for (let i = 0; i < player.activeSpecialties.length; i++) {
                const sId = player.activeSpecialties[i];
                const spec = Specialties[sId];
                if (Resources[spec.resource].type !== ResourceTypes.BASE) continue;
                if (processed.includes(spec.resource)) continue;

                const handIdx = player.hand.indexOf(spec.resource);
                if (handIdx === -1) continue;

                // 現在の需要/役に加工品要求があれば建設する
                const hasProcessedReq = [
                    ...game.demandCards.map(id => Demands.find(d => d.id === id)),
                    ...FixedRoles.filter(r => !player.achievedRoles.includes(r.id))
                ].some(obj => obj && (
                    (obj.req && (obj.req['_anyProcessed'] || obj.req['_diffProcessed'])) ||
                    (obj.bonus && obj.bonus.targets && obj.bonus.targets.includes(spec.resource))
                ));

                if (hasProcessedReq) {
                    const res = Actions.executeBuildProcessingPlant(game, player, sId, handIdx);
                    if (res.success) return true;
                }
            }
        }

        // -------------------------------------------------
        // 優先度4: マーケット交換 (1AP) — 全候補列挙→評価→実行
        // -------------------------------------------------
        if (game.actionsLeft > 0) {
            const best = chooseCpuMarketTrade(game, player);
            if (best) {
                const res = Actions.executeExchange(game, player, best.handIndices, best.marketIndex);
                if (res.success) return true;
            }
        }

        // -------------------------------------------------
        // 優先度5: ターン終了
        // -------------------------------------------------
        game.endTurn();
        return true;
    }
}
