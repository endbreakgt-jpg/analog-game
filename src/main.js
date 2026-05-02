import { GameState } from './game.js';
import { UIManager } from './ui.js';
import * as Actions from './actions.js';
import { logger } from './logger.js';
import { CPU } from './cpu.js';

document.addEventListener('DOMContentLoaded', () => {
    const game = new GameState();
    const ui = new UIManager();

    // ロガーとUIの紐付け
    logger.onLogAdded = (entry) => {
        ui.addLog(entry);
    };

    // UIからのアクションハンドラ登録
    ui.onMarketExchange = (handIndices, marketIndex) => {
        if (handIndices.length === 0) return ui.showAlert('手札から交換に出す資源を選択してください。');
        if (marketIndex === -1) return ui.showAlert('マーケットから欲しい資源を1枚選択してください。');

        // 割引交換モード
        if (ui._discountedExchangeMode && game.turnState?.discountedExchange) {
            const res = Actions.executeDiscountedExchange(game, game.getCurrentPlayer(), handIndices, marketIndex);
            if (res.success) {
                ui._discountedExchangeMode = false;
                ui.clearSelection();
                game.notifyChange();
            } else {
                ui.showAlert(res.msg);
            }
            return;
        }

        // 船団整備効果のAP不要通常交換モード
        if (ui._freeMarketExchangeMode && game.turnState?.freeMarketExchange) {
            const res = Actions.executeExchange(game, game.getCurrentPlayer(), handIndices, marketIndex, {
                free: true,
                source: '船団整備効果'
            });
            if (res.success) {
                ui._freeMarketExchangeMode = false;
                ui.clearSelection();
                game.notifyChange();
            } else {
                ui.showAlert(res.msg);
            }
            return;
        }

        if (game.actionsLeft <= 0) return ui.showAlert('アクションポイントが足りません。');

        const res = Actions.executeExchange(game, game.getCurrentPlayer(), handIndices, marketIndex);
        if (res.success) {
            ui.clearSelection();
            game.notifyChange();
        } else {
            ui.showAlert(res.msg);
        }
    };


    ui.onDemandAchieve = (demandId, handIndices) => {
        if (!demandId) return ui.showAlert('達成する需要カードを選択してください。');
        if (handIndices.length === 0) return ui.showAlert('手札から消費する資源を選択してください。');

        const res = Actions.executeDemand(game, game.getCurrentPlayer(), demandId, handIndices);
        if (res.success) {
            ui.clearSelection();
            game.notifyChange();
        } else {
            ui.showAlert(res.msg);
        }
    };

    ui.onRoleAchieve = (roleId, handIndices) => {
        if (handIndices.length === 0) return ui.showAlert('手札から消費する資源を選択してください。');

        const res = Actions.executeFixedRole(game, game.getCurrentPlayer(), roleId, handIndices);
        if (res.success) {
            ui.clearSelection();
            game.notifyChange();
        } else {
            ui.showAlert(res.msg);
        }
    };

    ui.onBuildProcessingPlant = (activeSpecialtyIdx, handIndices) => {
        if (game.actionsLeft <= 0) return ui.showAlert('アクションポイントが足りません。');
        if (activeSpecialtyIdx === -1) return ui.showAlert('加工所を建設する稼働中特産品を選択してください。');
        if (handIndices.length !== 1) return ui.showAlert('建設コストとして対応する資源を1枚だけ手札から選択してください。');

        const player = game.getCurrentPlayer();
        const specialtyId = player.activeSpecialties[activeSpecialtyIdx];

        const res = Actions.executeBuildProcessingPlant(game, player, specialtyId, handIndices[0]);
        if (res.success) {
            ui.clearSelection();
            game.notifyChange();
        } else {
            ui.showAlert(res.msg);
        }
    };

    ui.onEndTurn = () => {
        ui.clearSelection();
        game.endTurn();
    };

    // ステート変更時の再描画
    game.onStateChange = (state) => {
        ui.renderAll(state);

        // CPU処理のトリガー
        let cp = null;
        if (state.phase === 'setup' && state.players.length > 0 && state.setupPlayerIndex < state.players.length) {
            cp = state.players[state.setupPlayerIndex];
        } else if (state.phase === 'free_development' && state.players.length > 0) {
            cp = state.players[state.devPlayerIndex];
        } else if (state.players.length > 0) {
            cp = state.getCurrentPlayer();
        }

        if (cp && cp.isCpu && !state.isGameOver && !state.cpuActionPending) {
            state.cpuActionPending = true;
            setTimeout(() => {
                const changed = CPU.takeAction(state, cp);
                if (changed) {
                    state.cpuActionPending = false;
                    state.notifyChange();
                } else {
                    state.cpuActionPending = false;
                }
            }, 1000);
        }
    };

    // セットアップ画面の処理
    document.getElementById('btn-start-game').addEventListener('click', () => {
        const humanCount = parseInt(document.getElementById('input-human-count').value) || 0;
        const cpuCount = parseInt(document.getElementById('input-cpu-count').value) || 0;
        const total = humanCount + cpuCount;
        const errorMsg = document.getElementById('setup-error-msg');

        if (total < 1 || total > 5) {
            errorMsg.textContent = 'プレイ人数の合計は1〜5人にしてください。';
            return;
        }
        errorMsg.textContent = '';

        document.getElementById('setup-overlay').style.display = 'none';
        document.getElementById('game-container').style.display = 'none';

        // ゲーム初期化
        game.init({ human: humanCount, cpu: cpuCount });
        ui.init(game);

        // 効果: 食料市 — 資源決定ボタン
        document.getElementById('btn-gain-resource-confirm').addEventListener('click', () => {
            if (!ui._gainResourceSelected) return ui.showAlert('基本資源を1枚選択してください。');
            game.completeGainResource(game.getCurrentPlayer().id, ui._gainResourceSelected);
            ui._gainResourceSelected = null;
        });

        // 効果: 造船材調達 — マーケット入れ替え決定ボタン
        document.getElementById('btn-market-replace-confirm').addEventListener('click', () => {
            const selected = ui._marketReplaceSelected || [];
            game.completeMarketReplace(selected);
            ui._marketReplaceSelected = [];
        });

        // 効果: 国家備蓄/住宅整備 — 手札交換決定ボタン
        document.getElementById('btn-stockpile-confirm').addEventListener('click', () => {
            const discardIndices = ui._stockpileDiscardSelected || [];
            const gainCounts = ui._stockpileGainCounts || {};
            const resourceIds = Object.entries(gainCounts)
                .flatMap(([id, count]) => Array.from({ length: count }, () => id));
            const maxCount = ui._handExchangeMaxCount || 2;
            const sourceName = game.phase === 'hand_exchange_1' ? '住宅整備' : '国家備蓄';

            if (discardIndices.length > maxCount) return ui.showAlert(`破棄できる手札は最大${maxCount}枚までです。`);
            if (discardIndices.length !== resourceIds.length) {
                return ui.showAlert('破棄した枚数と同じ枚数の基本資源を選択してください。0枚交換も可能です。');
            }

            game.completeHandExchange(game.getCurrentPlayer().id, discardIndices, resourceIds, maxCount, sourceName);
            ui._stockpileDiscardSelected = [];
            ui._stockpileGainCounts = {};
            ui._handExchangeMaxCount = null;
        });

        // 効果: 工房街整備 — 建設ボタン
        document.getElementById('btn-free-plant-confirm').addEventListener('click', () => {
            const specId = ui._freePlantSpecialty;
            const handIdx = ui._freePlantHandIndex;
            if (!specId) return ui.showAlert('建設する特産品を選択してください。');
            if (handIdx === -1) return ui.showAlert('支払う資源を手札から選択してください。');
            const player = game.getCurrentPlayer();
            const res = Actions.executeBuildProcessingPlant(game, player, specId, handIdx, true);
            if (res.success) {
                document.getElementById('free-plant-overlay').classList.add('hidden');
                ui._freePlantSpecialty = null;
                ui._freePlantHandIndex = -1;
                game.notifyChange();
            } else {
                ui.showAlert(res.msg);
            }
        });

        document.getElementById('btn-free-plant-cancel').addEventListener('click', () => {
            document.getElementById('free-plant-overlay').classList.add('hidden');
        });
    });
});
