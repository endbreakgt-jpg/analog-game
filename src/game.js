import { createMarketDeck, createDemandDeck, createSpecialtyDeck } from './data.js';
import { logger } from './logger.js';

export class GameState {
    constructor() {
        this.round = 1;
        this.maxRounds = 6;
        this.players = [];
        this.currentPlayerIndex = 0;
        this.actionsLeft = 2;

        this.marketCards = [];
        this.marketDeck = [];
        this.marketDiscard = [];

        this.demandCards = [];
        this.demandDeck = [];

        this.isGameOver = false;
        this.phase = 'setup';
        this.setupPlayerIndex = 0;
        this.startPlayerIndex = 0;
        this.devPlayerIndex = 0;
        this.maxHandSize = 8;
        this.turnState = { demandAchieved: false, demandAchieveCount: 0, roleAchieved: false };

        this.onStateChange = null;
    }

    init(playerCounts) {
        this.round = 1;
        const totalPlayers = playerCounts.human + playerCounts.cpu;
        this.marketDeck = createMarketDeck();
        this.demandDeck = createDemandDeck();

        // プレイヤー初期化
        const specialtyDeck = createSpecialtyDeck();
        this.players = [];
        let playerId = 0;

        // 人間プレイヤーの追加
        for (let i = 0; i < playerCounts.human; i++) {
            const playerSpecialties = [];
            for (let j = 0; j < 5; j++) playerSpecialties.push(specialtyDeck.pop());
            this.players.push({
                id: playerId,
                name: `Player ${playerId + 1}`,
                isCpu: false,
                score: 0,
                hand: [],
                activeSpecialties: [],
                inactiveSpecialties: playerSpecialties,
                processingPlants: [],
                achievedDemands: [],
                achievedRoles: [],
                maxHandSize: 8,
                bonusApNextTurn: false
            });
            playerId++;
        }

        // CPUプレイヤーの追加
        for (let i = 0; i < playerCounts.cpu; i++) {
            const playerSpecialties = [];
            for (let j = 0; j < 5; j++) playerSpecialties.push(specialtyDeck.pop());
            this.players.push({
                id: playerId,
                name: `CPU ${i + 1}`,
                isCpu: true,
                score: 0,
                hand: [],
                activeSpecialties: [],
                inactiveSpecialties: playerSpecialties,
                processingPlants: [],
                achievedDemands: [],
                achievedRoles: [],
                maxHandSize: 8,
                bonusApNextTurn: false
            });
            playerId++;
        }

        // マーケット初期化 (4枚)
        for (let i = 0; i < 4; i++) {
            this.marketCards.push(this.drawMarketCard());
        }

        // 需要カード初期化 (6枚に変更)
        for (let i = 0; i < 6; i++) {
            this.demandCards.push(this.demandDeck.pop());
        }

        this.currentPlayerIndex = 0;
        this.startPlayerIndex = 0;
        this.actionsLeft = 2;

        logger.log(`ゲーム開始（人間${playerCounts.human}人 / CPU${playerCounts.cpu}人） - 初期配置フェーズ`);

        this.notifyChange();
    }

    completeSetup(playerId, activeIndices) {
        const p = this.players.find(x => x.id === playerId);
        const actives = activeIndices.sort((a, b) => b - a).map(idx => p.inactiveSpecialties.splice(idx, 1)[0]);
        p.activeSpecialties = actives;

        this.setupPlayerIndex++;
        if (this.setupPlayerIndex >= this.players.length) {
            this.phase = 'playing';
            this.currentPlayerIndex = this.startPlayerIndex;
            this.actionsLeft = 2;
            import('./logger.js').then(({ logger }) => {
                logger.log('--- 全プレイヤーの初期配置完了、ゲーム本編開始 ---');
                this.logRoundStart();
                this.produceResources();
            });
        } else {
            this.notifyChange();
        }
    }

    completeFreeDevelopment(playerId, activeIndices) {
        const p = this.players.find(x => x.id === playerId);
        const actives = activeIndices.sort((a, b) => b - a).map(idx => p.inactiveSpecialties.splice(idx, 1)[0]);
        p.activeSpecialties.push(...actives);

        this.devPlayerIndex = (this.devPlayerIndex + 1) % this.players.length;
        if (this.devPlayerIndex === this.startPlayerIndex) {
            this.phase = 'playing';
            this.actionsLeft = 2;
            import('./logger.js').then(({ logger }) => {
                logger.log('--- 全プレイヤーの第3ラウンド特産品稼働完了 ---');
                this.logRoundStart();
                this.produceResources();
            });
        } else {
            this.notifyChange();
        }
    }

    drawMarketCard() {
        if (this.marketDeck.length === 0) {
            if (this.marketDiscard.length === 0) {
                logger.log('【警告】マーケット補充山札・捨て札がどちらも空のため、補充できません。');
                return null;
            }
            // 捨て札をシャッフルして山札にする
            this.marketDeck = [...this.marketDiscard].sort(() => Math.random() - 0.5);
            this.marketDiscard = [];
            logger.log('マーケット補充山札が尽きたため、捨て札をシャッフルして新しい補充山札を作りました。');
        }
        // 山札からマーケットへ出すだけ。捨て札への移動はマーケットを離れる時点で行う。
        return this.marketDeck.pop() ?? null;
    }

    produceResources() {
        // 全プレイヤーの稼働特産品から資源を生産
        import('./data.js').then(({ Specialties }) => {
            this.players.forEach(p => {
                let produced = [];
                p.activeSpecialties.forEach(specId => {
                    const resId = Specialties[specId].resource;
                    p.hand.push(resId);
                    produced.push(Specialties[specId].name);
                });
                if (produced.length > 0) {
                    logger.log(`${p.name} が資源を生産しました: ${produced.join(', ')}`);
                }
            });
            this.checkTurnStart();
        });
    }

    checkTurnStart() {
        if (this.isGameOver) {
            this.notifyChange();
            return;
        }

        this.turnState = {
            demandAchieved: false,
            demandAchieveCount: 0,
            roleAchieved: false,
            freeProcessingPlant: false,
            discountedExchange: false
        };
        this.phase = 'playing';
        const p = this.getCurrentPlayer();

        // bonusApNextTurnフラグが立っていれば+1AP
        let baseAp = 2;
        if (p.bonusApNextTurn) {
            baseAp = 3;
            p.bonusApNextTurn = false;
            logger.log(`${p.name} の次ターン+1AP効果が発動しました。`);
        }
        this.actionsLeft = baseAp;

        if (this.round <= this.maxRounds) {
            logger.log(`${p.name} のターンです。`);
        }
        this.notifyChange();
    }

    completeDiscard(playerId, discardIndices) {
        const p = this.players.find(x => x.id === playerId);
        const sorted = [...discardIndices].sort((a, b) => b - a);
        sorted.forEach(idx => {
            p.hand.splice(idx, 1);
        });
        logger.log(`${p.name} が手札上限を超過したため、${discardIndices.length}枚の資源を破棄しました。`);

        this.completeTurnEnd();
    }

    // 効果: 食料市 — 基本資源1枚を得る
    completeGainResource(playerId, resourceId) {
        const p = this.players.find(x => x.id === playerId);
        p.hand.push(resourceId);
        import('./data.js').then(({ Resources }) => {
            logger.log(`${p.name} が食料市の効果で ${Resources[resourceId].name} を得ました。`);
        });
        this.phase = 'playing';
        this.notifyChange();
    }

    // 効果: 国家備蓄 — 手札を最大2枚交換し、同数の基本資源を得る
    completeStockpileExchange(playerId, discardIndices, resourceIds) {
        const p = this.players.find(x => x.id === playerId);
        if (!p) return;

        const discards = [...discardIndices].slice(0, 2);
        const gains = [...resourceIds].slice(0, 2);

        if (discards.length !== gains.length) {
            logger.log('【警告】国家備蓄の破棄枚数と獲得枚数が一致しないため、効果を中断しました。');
            this.phase = 'playing';
            this.notifyChange();
            return;
        }

        const discardedCards = discards
            .sort((a, b) => b - a)
            .map(idx => p.hand.splice(idx, 1)[0])
            .filter(Boolean);

        p.hand.push(...gains);

        import('./data.js').then(({ Resources }) => {
            const discardedText = discardedCards.length > 0
                ? discardedCards.map(id => Resources[id].name).join(', ')
                : 'なし';
            const gainedText = gains.length > 0
                ? gains.map(id => Resources[id].name).join(', ')
                : 'なし';
            logger.log(`${p.name} が国家備蓄の効果を解決しました。破棄: ${discardedText} / 獲得: ${gainedText}`);
        });

        this.phase = 'playing';
        this.notifyChange();
    }

    // 効果: 造船材調達 — マーケットを最大2枚入れ替える
    completeMarketReplace(marketIndices) {
        // 選択されたカードを捨て札へ
        [...marketIndices].sort((a, b) => b - a).forEach(i => {
            const card = this.marketCards[i];
            if (card) this.marketDiscard.push(card);
            this.marketCards[i] = null;
        });
        // 空きを補充
        let replenished = 0;
        for (let i = 0; i < this.marketCards.length; i++) {
            if (this.marketCards[i] === null) {
                this.marketCards[i] = this.drawMarketCard();
                if (this.marketCards[i] !== null) replenished++;
            }
        }
        logger.log(`造船材調達の効果でマーケットを ${marketIndices.length} 枚入れ替え、${replenished} 枚補充しました。`);
        this.phase = 'playing';
        this.notifyChange();
    }

    useAction() {
        this.actionsLeft--;
        this.notifyChange();
    }

    endTurn() {
        const player = this.getCurrentPlayer();

        // 1. 手札上限確認をターン終了時に行う（最終ラウンドは手札上限による破棄を行わない）
        const playerMaxHand = player.maxHandSize || this.maxHandSize;
        if (this.round < this.maxRounds && player.hand.length > playerMaxHand) {
            this.phase = 'discard';
            this.notifyChange();
            return; // 破棄完了後に completeTurnEnd() が呼ばれる
        }

        this.completeTurnEnd();
    }

    completeTurnEnd() {
        const player = this.getCurrentPlayer();

        // 需要カードの補充はアクションごと（即時補充）に変更されたため、ここは安全のための補充とする（6枚に変更）
        while (this.demandCards.length < 6 && this.demandDeck.length > 0) {
            this.demandCards.push(this.demandDeck.pop());
        }

        // マーケットの空き枠をターン終了時に補充
        let replenishedCount = 0;
        for (let i = 0; i < this.marketCards.length; i++) {
            if (this.marketCards[i] === null) {
                this.marketCards[i] = this.drawMarketCard();
                if (this.marketCards[i] !== null) replenishedCount++;
            }
        }
        // 万が一配列長が足りない場合のフェイルセーフ
        while (this.marketCards.length < 4) {
            const card = this.drawMarketCard();
            if (card) {
                this.marketCards.push(card);
                replenishedCount++;
            } else {
                break;
            }
        }

        if (replenishedCount > 0) {
            logger.log(`ターン終了時: マーケットに ${replenishedCount} 枚補充しました。`);
        }

        logger.log(`${player.name} のターンが終了しました。`);

        // 次のプレイヤーへ
        const nextPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
        if (nextPlayerIndex === this.startPlayerIndex) {

            // ラウンド終了時のステータスログ出力
            const scoreLog = this.players.map(p => `${p.name}: ${p.score}点`).join(', ');
            logger.log(`[ラウンド ${this.round} 終了] 得点状況: ${scoreLog}`);
            logger.log(`[ラウンド ${this.round} 終了] 山札: マーケット残り${this.marketDeck.length}枚, 需要残り${this.demandDeck.length}枚`);

            // マーケット全入れ替え
            this.marketCards.forEach(c => {
                if (c) this.marketDiscard.push(c);
            });
            this.marketCards = [];
            for (let i = 0; i < 4; i++) {
                this.marketCards.push(this.drawMarketCard());
            }
            logger.log(`中央マーケットを全入れ替えしました。`);

            // スタートプレイヤー交代
            this.startPlayerIndex = (this.startPlayerIndex + 1) % this.players.length;
            this.currentPlayerIndex = this.startPlayerIndex;
            this.round++;

            if (this.round > this.maxRounds) {
                logger.log('ゲーム終了！');
                this.isGameOver = true;
                this.phase = 'gameover';
                this.calculateFinalScores();
                this.notifyChange();
            } else {
                if (this.round === 3) {
                    this.phase = 'free_development';
                    this.devPlayerIndex = this.startPlayerIndex;
                    logger.log(`--- ラウンド ${this.round} 開始 (特産品無料稼働フェーズ) ---`);
                    this.notifyChange();
                } else if (this.round === 4) {
                    logger.log(`--- ラウンド ${this.round} 開始 (残り特産品自動稼働) ---`);
                    this.players.forEach(p => {
                        if (p.inactiveSpecialties.length > 0) {
                            const spec = p.inactiveSpecialties.pop();
                            p.activeSpecialties.push(spec);
                            logger.log(`${p.name} の特産品が自動稼働しました: ${spec}`);
                        }
                    });
                    this.actionsLeft = 2;
                    this.logRoundStart();
                    this.produceResources();
                } else {
                    this.actionsLeft = 2;
                    this.logRoundStart();
                    this.produceResources();
                }
            }
        } else {
            this.currentPlayerIndex = nextPlayerIndex;
            this.actionsLeft = 2;
            this.checkTurnStart();
        }
    }

    logRoundStart() {
        logger.log(`--- ラウンド ${this.round} 開始 ---`);
        import('./data.js').then(({ Demands }) => {
            const pubDemands = this.demandCards.map(id => {
                const d = Demands.find(x => x.id === id);
                return d ? d.name : '不明';
            });
            logger.log(`[公開需要カード] ${pubDemands.join(', ')}`);
        });
    }

    calculateFinalScores() {
        logger.log('====== 最終結果 ======');
        logger.log(`プレイ人数: ${this.players.length}人`);

        import('./data.js').then(({ Demands, FixedRoles, Resources }) => {
            const sortedPlayers = [...this.players].sort((a, b) => b.score - a.score);
            sortedPlayers.forEach((p, i) => {
                let demandPts = 0;
                p.achievedDemands.forEach(id => {
                    const d = Demands.find(x => x.id === id);
                    if (d) demandPts += d.points;
                });
                let rolePts = 0;
                p.achievedRoles.forEach(id => {
                    const r = FixedRoles.find(x => x.id === id);
                    if (r) rolePts += r.points;
                });
                const bonusPts = p.score - demandPts - rolePts;
                const bonusStr = bonusPts > 0 ? `, 加工ボーナス: ${bonusPts}` : '';
                const handCounts = p.hand.reduce((counts, resourceId) => {
                    counts[resourceId] = (counts[resourceId] || 0) + 1;
                    return counts;
                }, {});
                const handDetails = Object.keys(Resources)
                    .filter(resourceId => handCounts[resourceId] > 0)
                    .map(resourceId => `${Resources[resourceId].name}${handCounts[resourceId]}枚`)
                    .join(', ') || 'なし';
                logger.log(`${i + 1}位: ${p.name} - 最終得点: ${p.score}点 (需要基本点: ${demandPts}, 固定役基本点: ${rolePts}${bonusStr}) | 残り手札: ${p.hand.length}枚 [${handDetails}]`);
            });
            logger.log('======================');
        });
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    notifyChange() {
        if (this.onStateChange) {
            this.onStateChange(this);
        }
    }
}
