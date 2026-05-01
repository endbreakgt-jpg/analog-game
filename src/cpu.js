import { Demands, FixedRoles, Resources, ResourceTypes, Specialties } from './data.js';
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

    // ある手札で需要/役が達成できるか
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
            const nowOk = isAchievable(player.hand, demand.req, demand.bonus);
            const afterOk = isAchievable(simHand, demand.req, demand.bonus);
            if (afterOk && !nowOk) {
                score += demand.points + (demand.bonus ? demand.bonus.points || 0 : 0);
            } else if (!afterOk) {
                const before = missingCount(player.hand, demand.req);
                const after = missingCount(simHand, demand.req);
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
        const demandObjs = game.demandCards.map(id => Demands.find(d => d.id === id)).filter(Boolean);
        const roleObjs = FixedRoles.filter(r => !player.achievedRoles.includes(r.id));
        const scores = {};

        // 需要・役の要求から欲しい資源を集計
        [...demandObjs, ...roleObjs].forEach(obj => {
            if (!obj) return;
            Object.entries(obj.req).forEach(([key, val]) => {
                if (!key.startsWith('_') && Resources[key] && Resources[key].type === ResourceTypes.BASE) {
                    const has = player.hand.filter(id => id === key).length;
                    const need = Math.max(0, val - has);
                    scores[key] = (scores[key] || 0) + need;
                }
            });
        });

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
                if (d.req[id]) score += d.req[id];
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
        const scores = this.getBaseResourceNeedScores(game, player);
        const wantedResources = Object.values(Resources)
            .filter(r => r.type === ResourceTypes.BASE)
            .map(r => ({ id: r.id, score: scores[r.id] || 0 }))
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score);

        if (wantedResources.length === 0 || player.hand.length === 0) {
            game.completeStockpileExchange(player.id, [], []);
            return true;
        }

        const discardCandidates = player.hand
            .map((id, i) => ({ i, score: scores[id] || 0 }))
            .sort((a, b) => a.score - b.score);

        const exchangeCount = Math.min(2, wantedResources.length, discardCandidates.length);
        const discardIndices = discardCandidates.slice(0, exchangeCount).map(x => x.i);
        const gainResources = wantedResources.slice(0, exchangeCount).map(x => x.id);

        game.completeStockpileExchange(player.id, discardIndices, gainResources);
        return true;
    }

    static getBaseResourceNeedScores(game, player) {
        const scores = {};
        const demandObjs = game.demandCards.map(id => Demands.find(d => d.id === id)).filter(Boolean);
        const roleObjs = FixedRoles.filter(r => !player.achievedRoles.includes(r.id));

        [...demandObjs, ...roleObjs].forEach(obj => {
            Object.entries(obj.req).forEach(([key, val]) => {
                if (!key.startsWith('_') && Resources[key]?.type === ResourceTypes.BASE) {
                    const has = player.hand.filter(id => id === key).length;
                    scores[key] = (scores[key] || 0) + Math.max(0, val - has);
                }
            });
        });

        return scores;
    }

    static tryAchieveBestDemand(game, player) {
        const processed = player.processingPlants || [];
        const subsets = getAllSubsets(player.hand.map((_, i) => i));
        let bestDemand = null, bestIndices = null, maxPts = -1;

        for (const dId of game.demandCards) {
            const demand = Demands.find(d => d.id === dId);
            if (!demand) continue;
            for (const subset of subsets) {
                const cards = subset.map(i => player.hand[i]);
                const check = Actions.ActionValidator.checkRequirements(cards, demand.req, processed, demand.bonus);
                if (check.valid) {
                    const pts = demand.points + check.bonusPoints;
                    if (pts > maxPts) { maxPts = pts; bestDemand = demand; bestIndices = subset; }
                }
            }
        }

        if (!bestDemand) return false;
        const res = Actions.executeDemand(game, player, bestDemand.id, bestIndices);
        return res.success;
    }

    static cpuTurn(game, player) {
        const processed = player.processingPlants || [];

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
        // 効果フラグ: 工房街整備 — 未使用なら加工所を建設
        // -------------------------------------------------
        if (game.turnState.freeProcessingPlant) {
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
            // 建設できない場合はフラグをリセットして終了
            game.turnState.freeProcessingPlant = false;
        }

        // -------------------------------------------------
        // 効果フラグ: 大商館納品 — 未使用なら割引交換を実行
        // -------------------------------------------------
        if (game.turnState.discountedExchange) {
            // 割引交換候補 (通常より1枚少ない支払い)
            const discountTrades = getValidMarketTrades(player, game.marketCards).filter(t => {
                const handCards = t.handIndices.map(i => player.hand[i]);
                const base = handCards.filter(id => Resources[id].type === ResourceTypes.BASE).length;
                const trade = handCards.filter(id => Resources[id].type === ResourceTypes.TRADE).length;
                const mType = Resources[game.marketCards[t.marketIndex]].type;
                // 割引後レート: 基本1→基本1, 基本2→交易1, 交易1→基本1, 交易1→交易1
                return (base === 1 && trade === 0 && mType === ResourceTypes.BASE) ||
                    (base === 2 && trade === 0 && mType === ResourceTypes.TRADE) ||
                    (base === 0 && trade === 1);
            });
            if (discountTrades.length > 0) {
                const best = discountTrades[0];
                const res = Actions.executeDiscountedExchange(game, player, best.handIndices, best.marketIndex);
                if (res.success) return true;
            }
            game.turnState.discountedExchange = false;
        }

        // -------------------------------------------------
        // 優先度5: ターン終了
        // -------------------------------------------------
        game.endTurn();
        return true;
    }
}
