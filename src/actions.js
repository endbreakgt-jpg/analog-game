import { Resources, ResourceTypes, Demands, FixedRoles, Specialties, getDemandVariants } from './data.js';
import { logger } from './logger.js';

export const ActionValidator = {
    canExchange: (handCards, marketCards) => {
        if (marketCards.length !== 1) return { valid: false, msg: 'マーケットから1枚選択してください。' };

        const mType = Resources[marketCards[0]].type;
        const handTypes = handCards.map(id => Resources[id].type);

        const baseCount = handTypes.filter(t => t === ResourceTypes.BASE).length;
        const tradeCount = handTypes.filter(t => t === ResourceTypes.TRADE).length;

        if (baseCount === 2 && tradeCount === 0 && mType === ResourceTypes.BASE) return { valid: true };
        if (baseCount === 3 && tradeCount === 0 && mType === ResourceTypes.TRADE) return { valid: true };
        if (baseCount === 0 && tradeCount === 1 && mType === ResourceTypes.BASE) return { valid: true };
        if (baseCount === 0 && tradeCount === 2 && mType === ResourceTypes.TRADE) return { valid: true };

        return { valid: false, msg: '交換レートが一致しません。選択したリソースの組み合わせを確認してください。' };
    },

    // バックトラッキングによる厳密な条件判定
    checkRequirements: (handCards, req, processedResources = [], bonus = null) => {
        const cards = [...handCards];
        let maxBonusPts = 0;
        let isValid = false;

        // 必須リソース(wood, stoneなど)の消費
        let tempCards = [...cards];
        let directMatch = true;
        for (const [key, val] of Object.entries(req)) {
            if (!key.startsWith('_')) {
                for (let i = 0; i < val; i++) {
                    const idx = tempCards.indexOf(key);
                    if (idx === -1) { directMatch = false; break; }
                    tempCards.splice(idx, 1);
                }
            }
            if (!directMatch) break;
        }

        if (!directMatch) return { valid: false, bonusPoints: 0 };

        // 特殊条件の判定（残りのtempCardsで満たせるか）
        // 組み合わせ全探索（深さ優先）
        const specialKeys = Object.keys(req).filter(k => k.startsWith('_'));

        const tryFulfill = (currentCards, keysIdx) => {
            if (keysIdx >= specialKeys.length) {
                // 全ての特殊条件を満たした
                isValid = true;
                // ボーナス計算（使用した全カード（元のhandCards）について判定）
                let earnedBonus = 0;
                if (bonus && bonus.targets) {
                    const hasBonusTargetProcessed = handCards.some(id =>
                        bonus.targets.includes(id) && processedResources.includes(id)
                    );
                    if (hasBonusTargetProcessed) {
                        earnedBonus = bonus.points;
                    }
                }
                if (earnedBonus > maxBonusPts) maxBonusPts = earnedBonus;
                return;
            }

            const key = specialKeys[keysIdx];
            const neededCount = req[key];

            // 必要な枚数を選ぶ組み合わせを生成するヘルパー関数
            const getCombinations = (arr, size) => {
                if (size === 0) return [[]];
                if (arr.length === 0) return [];
                const res = [];
                const head = arr[0];
                const tail = arr.slice(1);
                for (const comb of getCombinations(tail, size - 1)) {
                    res.push([head, ...comb]);
                }
                for (const comb of getCombinations(tail, size)) {
                    res.push(comb);
                }
                return res;
            };

            const isMatch = (combo, k) => {
                if (k === '_anyBase') return combo.every(id => Resources[id].type === ResourceTypes.BASE);
                if (k === '_anyTrade') return combo.every(id => Resources[id].type === ResourceTypes.TRADE);
                if (k === '_diffBase') {
                    if (!combo.every(id => Resources[id].type === ResourceTypes.BASE)) return false;
                    return new Set(combo).size === neededCount;
                }
                if (k === '_diffTrade') {
                    if (!combo.every(id => Resources[id].type === ResourceTypes.TRADE)) return false;
                    return new Set(combo).size === neededCount;
                }
                if (k === '_anyProcessed') return combo.every(id => processedResources.includes(id));
                if (k === '_diffProcessed') {
                    if (!combo.every(id => processedResources.includes(id))) return false;
                    return new Set(combo).size === neededCount;
                }
                return false;
            };

            const combos = getCombinations(currentCards, neededCount);
            // unique combos only
            const uniqueCombos = [];
            const seen = new Set();
            for (const c of combos) {
                const s = [...c].sort().join(',');
                if (!seen.has(s)) {
                    seen.add(s);
                    uniqueCombos.push(c);
                }
            }

            for (const combo of uniqueCombos) {
                if (isMatch(combo, key)) {
                    // comboを取り除いた新しいカードリストを作成
                    let nextCards = [...currentCards];
                    for (const item of combo) {
                        const idx = nextCards.indexOf(item);
                        nextCards.splice(idx, 1);
                    }
                    tryFulfill(nextCards, keysIdx + 1);
                }
            }
        };

        tryFulfill(tempCards, 0);

        return { valid: isValid, bonusPoints: maxBonusPts };
    },

    checkDemandRequirements: (handCards, demand, processedResources = []) => {
        let best = null;

        getDemandVariants(demand).forEach(variant => {
            const check = ActionValidator.checkRequirements(handCards, variant.req, processedResources, demand.bonus);
            if (!check.valid) return;

            const totalPoints = variant.points + check.bonusPoints;
            if (!best || totalPoints > best.totalPoints) {
                best = {
                    valid: true,
                    variant,
                    bonusPoints: check.bonusPoints,
                    totalPoints
                };
            }
        });

        return best || { valid: false, bonusPoints: 0, totalPoints: 0 };
    }
};

export const executeExchange = (game, player, handIndices, marketIndex, options = {}) => {
    const handCards = handIndices.map(i => player.hand[i]);
    const marketCards = [game.marketCards[marketIndex]];

    const val = ActionValidator.canExchange(handCards, marketCards);
    if (!val.valid) return { success: false, msg: val.msg };

    handIndices.sort((a, b) => b - a).forEach(idx => {
        player.hand.splice(idx, 1);
    });

    const obtained = game.marketCards.splice(marketIndex, 1, null)[0];
    player.hand.push(obtained);

    // 取られたマーケットカードは補充捨て札に戻し、19枚のプールを維持する
    if (obtained) game.marketDiscard.push(obtained);

    // 取られた枠は空き枠（null）として残す

    const sourceSuffix = options.source ? `（${options.source}）` : '';
    logger.log(`${player.name} がマーケット交換を実行${sourceSuffix}: ${handCards.map(id => Resources[id].name).join(', ')} → ${Resources[obtained].name}`);

    if (options.free) {
        if (game.turnState) game.turnState.freeMarketExchange = false;
        game.notifyChange();
    } else {
        game.useAction();
    }
    return { success: true };
};

export const executeDemand = (game, player, demandId, handIndices) => {
    const achievedCount = game.turnState.demandAchieveCount ?? (game.turnState.demandAchieved ? 1 : 0);
    const isAdditionalDemand = achievedCount > 0;

    if (isAdditionalDemand && game.actionsLeft <= 0) {
        return { success: false, msg: '追加の需要達成には1APが必要です。' };
    }

    const demand = Demands.find(d => d.id === demandId);
    if (!demand) return { success: false, msg: '需要カードが見つかりません。' };

    const dIndex = game.demandCards.indexOf(demandId);
    if (dIndex === -1) return { success: false, msg: '場にない需要カードです。' };

    const handCards = handIndices.map(i => player.hand[i]);
    const processedResources = player.processingPlants || [];
    const check = ActionValidator.checkDemandRequirements(handCards, demand, processedResources);

    if (!check.valid) {
        return { success: false, msg: '条件を満たしていません。リソースの組み合わせを確認してください。' };
    }

    handIndices.sort((a, b) => b - a).forEach(idx => player.hand.splice(idx, 1));
    game.demandCards.splice(dIndex, 1);

    const totalPoints = check.totalPoints;
    player.achievedDemands.push({
        demandId,
        variantId: check.variant.id,
        variantLabel: check.variant.label,
        points: check.variant.points,
        bonusPoints: check.bonusPoints,
        totalPoints
    });
    player.score += totalPoints;
    if (isAdditionalDemand) {
        game.actionsLeft--;
        logger.log(`${player.name} が追加需要達成のため1APを消費しました。`);
    }
    game.turnState.demandAchieveCount = achievedCount + 1;
    game.turnState.demandAchieved = true;

    while (game.demandCards.length < 6 && game.demandDeck.length > 0) {
        game.demandCards.push(game.demandDeck.pop());
    }

    const variantMsg = check.variant.id === 'normal' ? '' : `（${check.variant.label}条件）`;
    const bonusMsg = check.bonusPoints > 0 ? ` (加工ボーナス +${check.bonusPoints})` : '';
    logger.log(`${player.name} が需要達成: ${demand.name}${variantMsg} (+${totalPoints}点)${bonusMsg}`);

    // 効果の発動
    if (demand.effect) {
        if (demand.effect === 'bonus_ap_next_turn') {
            game.actionsLeft += 1;
            logger.log(`${player.name} が「兵站整備」効果を得ました。このターン中のAPが+1されます。`);
        } else if (demand.effect === 'stockpile_exchange') {
            game.phase = 'stockpile_exchange';
        } else if (demand.effect === 'hand_exchange_1') {
            game.phase = 'hand_exchange_1';
        } else if (demand.effect === 'gain_base_resource') {
            // UIフェーズ変更で処理（CPUは自動選択）
            game.phase = 'gain_resource';
        } else if (demand.effect === 'market_replace_2') {
            // UIフェーズ変更で処理（CPUは自動選択）
            game.phase = 'market_replace';
        } else if (demand.effect === 'free_processing_plant') {
            game.turnState.freeProcessingPlant = true;
            logger.log(`${player.name} が「工房街整備」効果を得ました。AP・資源コストなしで加工所を1回建設できます。`);
        } else if (demand.effect === 'discounted_exchange') {
            game.turnState.discountedExchange = true;
            logger.log(`${player.name} が「大商館納品」効果を得ました。割引レートでマーケット交換を1回行えます。`);
        } else if (demand.effect === 'normal_market_exchange') {
            game.turnState.freeMarketExchange = true;
            logger.log(`${player.name} が「船団整備」効果を得ました。AP不要で通常のマーケット交換を1回行えます。`);
        }
    }

    return { success: true };
};

export const executeFixedRole = (game, player, roleId, handIndices) => {
    if (game.turnState.roleAchieved) {
        return { success: false, msg: '固定役達成は1ターンに1回までです。' };
    }

    if (player.achievedRoles.includes(roleId)) return { success: false, msg: '既に達成済みの役です。' };

    const role = FixedRoles.find(r => r.id === roleId);
    if (!role) return { success: false, msg: '役が見つかりません。' };

    const handCards = handIndices.map(i => player.hand[i]);
    const processedResources = player.processingPlants || [];
    const check = ActionValidator.checkRequirements(handCards, role.req, processedResources, role.bonus);

    if (!check.valid) {
        return { success: false, msg: '条件を満たしていません。' };
    }

    handIndices.sort((a, b) => b - a).forEach(idx => player.hand.splice(idx, 1));
    player.achievedRoles.push(roleId);
    const totalPoints = role.points + check.bonusPoints;
    player.score += totalPoints;
    game.turnState.roleAchieved = true;

    const bonusMsg = check.bonusPoints > 0 ? ` (加工ボーナス +${check.bonusPoints})` : '';
    logger.log(`${player.name} が固定役達成: ${role.name} (+${totalPoints}点)${bonusMsg}`);

    return { success: true };
};

export const executeBuildProcessingPlant = (game, player, specialtyId, handIndex, isFree = false) => {
    const spec = Specialties[specialtyId];
    if (!spec) return { success: false, msg: '特産品が見つかりません。' };

    if (Resources[spec.resource].type !== ResourceTypes.BASE) {
        return { success: false, msg: '交易品の特産品には加工所を建設できません。' };
    }

    if (!player.activeSpecialties.includes(specialtyId)) {
        return { success: false, msg: '対象の特産品が稼働していません。' };
    }

    player.processingPlants = player.processingPlants || [];
    if (player.processingPlants.includes(spec.resource)) {
        return { success: false, msg: '既にこの資源の加工所は建設済みです。' };
    }

    if (!isFree) {
        const costResource = player.hand[handIndex];
        if (costResource !== spec.resource) {
            return { success: false, msg: `加工所の建設には対応する資源（${Resources[spec.resource].name}）が必要です。` };
        }
        player.hand.splice(handIndex, 1);
    }

    player.processingPlants.push(spec.resource);

    logger.log(`${player.name} が ${spec.name} に加工所を建設しました！${isFree ? '（工房街整備効果：AP・資源コスト不要）' : ''}`);

    if (!isFree) game.useAction();
    if (isFree) {
        game.turnState.freeProcessingPlant = false;
        game.notifyChange();
    }
    return { success: true };
};

// 割引マーケット交換（支払い枚数-1、最低1枚）
export const executeDiscountedExchange = (game, player, handIndices, marketIndex) => {
    if (!game.turnState.discountedExchange) {
        return { success: false, msg: '割引交換の効果を持っていません。' };
    }
    const handCards = handIndices.map(i => player.hand[i]);
    const mType = Resources[game.marketCards[marketIndex]].type;
    const baseCount = handCards.filter(id => Resources[id].type === ResourceTypes.BASE).length;
    const tradeCount = handCards.filter(id => Resources[id].type === ResourceTypes.TRADE).length;

    // 割引後のレート検証（通常-1枚、最低1枚）
    const isValid =
        (baseCount === 1 && tradeCount === 0 && mType === ResourceTypes.BASE) ||
        (baseCount === 2 && tradeCount === 0 && mType === ResourceTypes.TRADE) ||
        (baseCount === 0 && tradeCount === 1 && mType === ResourceTypes.BASE) ||
        (baseCount === 0 && tradeCount === 1 && mType === ResourceTypes.TRADE);

    if (!isValid) {
        return { success: false, msg: '割引交換レートが一致しません。\n(基本1→基本1, 基本2→交易1, 交易1→基本1, 交易1→交易1)' };
    }

    handIndices.sort((a, b) => b - a).forEach(idx => player.hand.splice(idx, 1));
    const obtained = game.marketCards.splice(marketIndex, 1, null)[0];
    player.hand.push(obtained);
    if (obtained) game.marketDiscard.push(obtained);

    game.turnState.discountedExchange = false;
    logger.log(`${player.name} が割引交換を実行: ${handCards.map(id => Resources[id].name).join(', ')} → ${Resources[obtained].name}（大商館納品効果）`);

    return { success: true };
};
