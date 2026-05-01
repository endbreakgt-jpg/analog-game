import { Resources, ResourceTypes, Specialties, Demands, FixedRoles } from './data.js';

const EffectDescriptions = {
    'gain_base_resource': '効果：好きな基本資源1枚を得る',
    'bonus_ap_next_turn': '効果：次の自分のターンに+1AP',
    'free_processing_plant': '効果：APを使わず加工所を1回建設できる',
    'stockpile_exchange': '効果：手札を2枚まで捨て、同じ枚数だけ好きな基本資源を得る',
    'market_replace_2': '効果：マーケットのカードを最大2枚まで入れ替える',
    'discounted_exchange': '効果：1回だけマーケットでの交換コストを1軽減する（最低コスト1枚）'
};

export class UIManager {
    constructor() {
        this.selectedHandIndices = [];
        this.selectedMarketIndex = -1;
        this.selectedDemandId = null;
        this.selectedInactiveSpecialtyIndex = -1;
        this.selectedActiveSpecialtyIndex = -1;

        this.onMarketExchange = null;
        this.onMarketRefresh = null;
        this.onDevelop = null;
        this.onDemandAchieve = null;
        this.onRoleAchieve = null;
        this.onBuildProcessingPlant = null;
        this.onEndTurn = null;

        this.gameRef = null;
    }

    init(game) {
        this.gameRef = game;
        this.bindEvents();
        this.renderAll(game);
    }

    bindEvents() {
        document.getElementById('btn-end-turn').addEventListener('click', () => {
            if (this.onEndTurn) this.onEndTurn();
        });

        document.getElementById('btn-market-exchange').addEventListener('click', () => {
            if (this.onMarketExchange) this.onMarketExchange(this.selectedHandIndices, this.selectedMarketIndex);
        });

        document.getElementById('btn-achieve-demand').addEventListener('click', () => {
            if (this.onDemandAchieve) this.onDemandAchieve(this.selectedDemandId, this.selectedHandIndices);
        });

        document.getElementById('btn-achieve-fixed-role').addEventListener('click', () => {
            this.showRolesModal(true); // 達成モードで開く
        });

        const buildPlantBtn = document.getElementById('btn-build-processing-plant');
        if (buildPlantBtn) {
            buildPlantBtn.addEventListener('click', () => {
                if (this.onBuildProcessingPlant) {
                    this.onBuildProcessingPlant(this.selectedActiveSpecialtyIndex, this.selectedHandIndices);
                }
            });
        }

        document.getElementById('btn-modal-close').addEventListener('click', () => this.closeModal());
        document.getElementById('btn-modal-close-icon').addEventListener('click', () => this.closeModal());

        document.getElementById('btn-modal-confirm').addEventListener('click', () => {
            const selectedRadio = document.querySelector('input[name="role-select"]:checked');
            if (selectedRadio && this.onRoleAchieve) {
                this.onRoleAchieve(selectedRadio.value, this.selectedHandIndices);
                this.closeModal();
            } else {
                alert('役を選択してください。');
            }
        });

        document.getElementById('btn-setup-confirm').addEventListener('click', () => {
            if (!Array.isArray(this.selectedInactiveSpecialtyIndex)) return;
            const game = this.gameRef;
            const expectedCount = game.phase === 'setup' ? 3 : 1;

            if (this.selectedInactiveSpecialtyIndex.length !== expectedCount) {
                alert(`稼働させる特産品を${expectedCount}枚選んでください。`);
                return;
            }

            const activeIndices = [...this.selectedInactiveSpecialtyIndex];
            this.selectedInactiveSpecialtyIndex = [];

            if (game.phase === 'setup') {
                const p = game.players[game.setupPlayerIndex];
                game.completeSetup(p.id, activeIndices);
            } else if (game.phase === 'free_development') {
                const p = game.players[game.devPlayerIndex];
                game.completeFreeDevelopment(p.id, activeIndices);
            }
        });

        document.getElementById('btn-discard-confirm').addEventListener('click', () => {
            if (!Array.isArray(this.selectedDiscardIndices)) return;
            const game = this.gameRef;
            if (game.phase !== 'discard') return;

            const p = game.getCurrentPlayer();
            const maxHand = p.maxHandSize || game.maxHandSize;
            const excess = p.hand.length - maxHand;

            if (this.selectedDiscardIndices.length !== excess) {
                alert(`手札が上限を超えています。${excess}枚選んで破棄してください。`);
                return;
            }

            const discardIndices = [...this.selectedDiscardIndices];
            this.selectedDiscardIndices = [];
            game.completeDiscard(p.id, discardIndices);
        });

        document.getElementById('btn-restart-game').addEventListener('click', () => {
            location.reload();
        });

        const btnReturnScreen = document.getElementById('btn-return-screen');
        if (btnReturnScreen) {
            btnReturnScreen.addEventListener('click', () => {
                document.getElementById('result-overlay').classList.add('hidden');
            });
        }

        document.getElementById('btn-show-rate').addEventListener('click', () => {
            this.showRateModal();
        });
    }

    clearSelection() {
        this.selectedHandIndices = [];
        this.selectedMarketIndex = -1;
        this.selectedDemandId = null;
        this.selectedInactiveSpecialtyIndex = Array.isArray(this.selectedInactiveSpecialtyIndex) ? [] : -1;
        this.selectedActiveSpecialtyIndex = -1;
        this.selectedDiscardIndices = [];
    }

    renderAll(game) {
        this.gameRef = game;

        const setupOverlay = document.getElementById('setup-phase-overlay');
        const discardOverlay = document.getElementById('discard-phase-overlay');
        const resultOverlay = document.getElementById('result-overlay');

        if (game.isGameOver) {
            if (setupOverlay) setupOverlay.classList.add('hidden');
            if (discardOverlay) discardOverlay.classList.add('hidden');
            this.hideEffectOverlays();
            this.showResultScreen(game);
        } else {
            if (resultOverlay) resultOverlay.classList.add('hidden');

            if (game.phase === 'setup' || game.phase === 'free_development') {
                setupOverlay.classList.remove('hidden');
                if (discardOverlay) discardOverlay.classList.add('hidden');
                this.hideEffectOverlays();
                this.renderSetupPhase(game);
                return;
            } else if (game.phase === 'discard') {
                if (setupOverlay) setupOverlay.classList.add('hidden');
                discardOverlay.classList.remove('hidden');
                this.hideEffectOverlays();
                this.renderDiscardPhase(game);
                return;
            } else if (game.phase === 'gain_resource') {
                if (setupOverlay) setupOverlay.classList.add('hidden');
                if (discardOverlay) discardOverlay.classList.add('hidden');
                this.hideEffectOverlays();
                this.renderGainResourcePhase(game);
                return;
            } else if (game.phase === 'market_replace') {
                if (setupOverlay) setupOverlay.classList.add('hidden');
                if (discardOverlay) discardOverlay.classList.add('hidden');
                this.hideEffectOverlays();
                this.renderMarketReplacePhase(game);
                return;
            } else if (game.phase === 'stockpile_exchange') {
                if (setupOverlay) setupOverlay.classList.add('hidden');
                if (discardOverlay) discardOverlay.classList.add('hidden');
                this.hideEffectOverlays();
                this.renderStockpileExchangePhase(game);
                return;
            } else {
                if (setupOverlay) setupOverlay.classList.add('hidden');
                if (discardOverlay) discardOverlay.classList.add('hidden');
                this.hideEffectOverlays();
            }
        }

        document.getElementById('val-round').textContent = game.round;
        const cp = game.getCurrentPlayer();
        document.getElementById('val-player').textContent = cp.name;
        document.getElementById('val-actions').textContent = game.actionsLeft;

        const actionBadge = document.getElementById('action-info');
        if (game.actionsLeft <= 0) {
            actionBadge.classList.remove('highlight');
            actionBadge.style.backgroundColor = '#555';
        } else {
            actionBadge.classList.add('highlight');
            actionBadge.style.backgroundColor = '';
        }

        const demandBtn = document.getElementById('btn-achieve-demand');
        if (demandBtn) {
            const demandCount = game.turnState?.demandAchieveCount ?? (game.turnState?.demandAchieved ? 1 : 0);
            const additionalDemand = demandCount > 0;
            demandBtn.disabled = additionalDemand && game.actionsLeft <= 0;
            demandBtn.textContent = additionalDemand ? '追加需要達成 (1AP)' : '需要達成 (無料)';
            demandBtn.style.opacity = demandBtn.disabled ? '0.5' : '1';
        }

        const roleBtn = document.getElementById('btn-achieve-fixed-role');
        if (roleBtn) {
            roleBtn.disabled = game.turnState?.roleAchieved || false;
            roleBtn.style.opacity = roleBtn.disabled ? '0.5' : '1';
        }

        document.getElementById('val-market-deck').textContent = game.marketDeck.length;
        document.getElementById('val-demand-deck').textContent = game.demandDeck.length;

        this.renderMarket(game);
        this.renderDemands(game);
        this.renderPlayers(game);
        this.renderPersistentRoles(game);
    }

    addLog(entry) {
        const logContent = document.getElementById('log-content');
        if (!logContent) return;
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.innerHTML = `<span class="log-time">[${entry.time}]</span> ${entry.message}`;
        logContent.appendChild(div);

        // オートスクロール
        const panel = document.getElementById('log-panel');
        if (panel) {
            panel.scrollTop = panel.scrollHeight;
        }
    }

    renderPersistentRoles(game) {
        const container = document.getElementById('persistent-role-table');
        if (!container) return;

        let html = '<table class="role-table" style="width:100%;"><tr><th>役名</th><th>条件</th><th>得点</th></tr>';
        const cp = game.getCurrentPlayer();

        FixedRoles.forEach(r => {
            const isAchieved = cp.achievedRoles.includes(r.id);
            html += `<tr style="${isAchieved ? 'opacity:0.5; background:rgba(0,0,0,0.1);' : ''}">`;
            html += `<td>${r.name}${isAchieved ? ' (済)' : ''}</td><td>${r.reqText}</td><td>${r.points}</td></tr>`;
        });
        html += '</table>';
        container.innerHTML = html;
    }

    renderSetupPhase(game) {
        if (!Array.isArray(this.selectedInactiveSpecialtyIndex)) {
            this.selectedInactiveSpecialtyIndex = [];
        }

        const isSetup = game.phase === 'setup';
        const p = isSetup ? game.players[game.setupPlayerIndex] : game.players[game.devPlayerIndex];
        const maxSelect = isSetup ? 3 : 1;

        document.getElementById('setup-player-name').textContent = p.name;
        document.getElementById('setup-action-name').textContent = isSetup ? '初期配置' : '無料稼働 (第3ラウンド)';
        document.getElementById('setup-desc').textContent = isSetup
            ? '初期特産品5枚のうち、最初から稼働させる3枚を選択してください。'
            : '未開発の特産品から、稼働させるものを1枚選択してください。';

        // 公開需要カードの表示
        const demandContainer = document.getElementById('setup-demand-cards');
        if (demandContainer) {
            demandContainer.innerHTML = '';
            game.demandCards.forEach(dId => {
                const d = Demands.find(x => x.id === dId);
                if (d) {
                    const reqHtml = Object.entries(d.req).map(([k, v]) => {
                        if (k === '_diffBase') return `異なる基本資源${v}種`;
                        if (k === '_diffTrade') return `異なる交易品${v}種`;
                        if (k === '_anyBase') return `任意の基本資源${v}個`;
                        if (k === '_anyTrade') return `任意の交易品${v}個`;
                        if (k === '_anyProcessed') return `任意の加工品${v}個`;
                        if (k === '_diffProcessed') return `異なる加工品${v}種`;
                        return `${Resources[k] ? Resources[k].name : k}${v}`;
                    }).join('<br>');

                    let customClass = 'demand';
                    let titleText = d.name;
                    let tooltip = null;
                    if (d.effect) {
                        customClass += ' has-effect';
                        titleText += ' ⚙️';
                        tooltip = EffectDescriptions[d.effect];
                    }
                    const card = this.createCardElement(titleText, `条件:\n${reqHtml}`, `+${d.points}🏆`, customClass, null, null, tooltip);
                    demandContainer.appendChild(card);
                }
            });
        }

        const container = document.getElementById('setup-specialties');
        container.innerHTML = '';

        p.inactiveSpecialties.forEach((sId, idx) => {
            const s = Specialties[sId];
            const card = this.createCardElement(s.name, s.resource, s.icon, `specialty ${Resources[s.resource].type}`, (el) => {
                const arrIdx = this.selectedInactiveSpecialtyIndex.indexOf(idx);
                if (arrIdx > -1) {
                    this.selectedInactiveSpecialtyIndex.splice(arrIdx, 1);
                    el.classList.remove('selected');
                } else {
                    if (this.selectedInactiveSpecialtyIndex.length < maxSelect) {
                        this.selectedInactiveSpecialtyIndex.push(idx);
                        el.classList.add('selected');
                    }
                }
            });
            if (this.selectedInactiveSpecialtyIndex.includes(idx)) card.classList.add('selected');
            container.appendChild(card);
        });
    }

    showRateModal() {
        const html = `
            <div style="font-size: 1.1rem; line-height: 1.6;">
                <p>手札の資源を支払い、中央マーケットの資源と交換します。</p>
                <br>
                <table class="role-table" style="width:100%; text-align:center;">
                    <tr><th>支払う資源</th><th></th><th>得られる資源</th></tr>
                    <tr><td>基本資源 2枚</td><td>→</td><td>基本資源 1枚</td></tr>
                    <tr><td>交易品 1枚</td><td>→</td><td>基本資源 1枚</td></tr>
                    <tr><td>交易品 2枚</td><td>→</td><td>交易品 1枚</td></tr>
                    <tr><td>基本資源 3枚</td><td>→</td><td>交易品 1枚</td></tr>
                </table>
            </div>
        `;
        document.getElementById('modal-title').textContent = 'マーケット交換レート';
        document.getElementById('modal-body').innerHTML = html;
        document.getElementById('btn-modal-confirm').classList.add('hidden');
        document.getElementById('modal-overlay').classList.remove('hidden');
    }

    showResultScreen(game) {
        const overlay = document.getElementById('result-overlay');
        const content = document.getElementById('result-content');

        const sortedPlayers = [...game.players].sort((a, b) => b.score - a.score);

        let html = '<table class="role-table" style="width:100%; font-size:1.2rem; text-align:center;">';
        html += '<tr><th>順位</th><th>プレイヤー</th><th>得点</th></tr>';

        sortedPlayers.forEach((p, i) => {
            let rowStyle = i === 0 ? 'color: var(--accent-red); font-weight: bold; background: rgba(255,215,0,0.2);' : '';
            html += `<tr style="${rowStyle}"><td>${i + 1}位</td><td>${p.name}</td><td>${p.score}点</td></tr>`;
        });

        html += '</table>';
        content.innerHTML = html;
        overlay.classList.remove('hidden');
    }

    createCardElement(title, typeText, icon, customClass, onClick, overlayContent = null, tooltipText = null) {
        const div = document.createElement('div');
        div.className = `card ${customClass}`;
        if (tooltipText) {
            div.setAttribute('title', tooltipText);
        }
        let inner = `
            <div class="card-title">${title}</div>
            <div class="card-icon">${icon}</div>
            <div class="card-type">${typeText}</div>
        `;
        if (overlayContent) {
            inner += `<div class="card-overlay">${overlayContent}</div>`;
        }
        div.innerHTML = inner;
        if (onClick) {
            div.addEventListener('click', () => onClick(div));
        }
        return div;
    }

    renderDiscardPhase(game) {
        if (!Array.isArray(this.selectedDiscardIndices)) {
            this.selectedDiscardIndices = [];
        }

        const p = game.getCurrentPlayer();
        const maxHand = p.maxHandSize || game.maxHandSize;
        const excess = p.hand.length - maxHand;

        document.getElementById('discard-player-name').textContent = p.name;
        document.getElementById('discard-max').textContent = maxHand;
        document.getElementById('discard-excess').textContent = excess;

        // 公開需要カードの表示
        const demandContainer = document.getElementById('discard-demand-cards');
        if (demandContainer) {
            demandContainer.innerHTML = '';
            game.demandCards.forEach(dId => {
                const d = Demands.find(x => x.id === dId);
                if (d) {
                    const reqHtml = Object.entries(d.req).map(([k, v]) => {
                        if (k === '_diffBase') return `異なる基本資源${v}種`;
                        if (k === '_diffTrade') return `異なる交易品${v}種`;
                        if (k === '_anyBase') return `任意の基本資源${v}個`;
                        if (k === '_anyTrade') return `任意の交易品${v}個`;
                        if (k === '_anyProcessed') return `任意の加工品${v}個`;
                        if (k === '_diffProcessed') return `異なる加工品${v}種`;
                        return `${Resources[k] ? Resources[k].name : k}${v}`;
                    }).join('<br>');

                    let customClass = 'demand';
                    let titleText = d.name;
                    let tooltip = null;
                    if (d.effect) {
                        customClass += ' has-effect';
                        titleText += ' ⚙️';
                        tooltip = EffectDescriptions[d.effect];
                    }
                    const card = this.createCardElement(titleText, `条件:\n${reqHtml}`, `+${d.points}🏆`, customClass, null, null, tooltip);
                    demandContainer.appendChild(card);
                }
            });
        }

        // プレイヤーの手札表示
        const handContainer = document.getElementById('discard-hand-cards');
        if (handContainer) {
            handContainer.innerHTML = '';
            p.hand.forEach((resId, idx) => {
                const r = Resources[resId];
                const card = this.createCardElement(r.name, r.type === 'base' ? '基本資源' : '交易品', r.icon, `resource ${r.type}`, (el) => {
                    const arrIdx = this.selectedDiscardIndices.indexOf(idx);
                    if (arrIdx > -1) {
                        this.selectedDiscardIndices.splice(arrIdx, 1);
                        el.classList.remove('selected');
                    } else {
                        if (this.selectedDiscardIndices.length < excess) {
                            this.selectedDiscardIndices.push(idx);
                            el.classList.add('selected');
                        }
                    }
                });
                if (this.selectedDiscardIndices.includes(idx)) card.classList.add('selected');
                handContainer.appendChild(card);
            });
        }
    }

    renderMarket(game) {
        const container = document.getElementById('market-cards');
        container.innerHTML = '';

        game.marketCards.forEach((resId, index) => {
            if (!resId) {
                const emptyCard = document.createElement('div');
                emptyCard.className = 'card empty-slot';
                emptyCard.style.opacity = '0.3';
                emptyCard.style.borderStyle = 'dashed';
                emptyCard.innerHTML = '<div style="margin:auto; font-size:0.9rem;">空き枠</div>';
                container.appendChild(emptyCard);
                return;
            }
            const res = Resources[resId];
            const card = this.createCardElement(res.name, res.type === 'base' ? '基本資源' : '交易品', res.icon, `resource ${res.type}`, (el) => {
                // Toggle selection
                if (this.selectedMarketIndex === index) {
                    this.selectedMarketIndex = -1;
                    el.classList.remove('selected');
                } else {
                    // Deselect others
                    Array.from(container.children).forEach(c => c.classList.remove('selected'));
                    this.selectedMarketIndex = index;
                    el.classList.add('selected');
                }
            });
            if (this.selectedMarketIndex === index) card.classList.add('selected');
            container.appendChild(card);
        });
    }

    renderDemands(game) {
        const container = document.getElementById('demand-cards');
        container.innerHTML = '';

        game.demandCards.forEach(dId => {
            const d = Demands.find(x => x.id === dId);
            if (!d) return;
            const reqHtml = Object.entries(d.req).map(([k, v]) => {
                if (k === '_diffBase') return `異なる基本資源${v}種`;
                if (k === '_diffTrade') return `異なる交易品${v}種`;
                if (k === '_anyBase') return `任意の基本資源${v}個`;
                if (k === '_anyTrade') return `任意の交易品${v}個`;
                if (k === '_anyProcessed') return `任意の加工品${v}個`;
                if (k === '_diffProcessed') return `異なる加工品${v}種`;
                return `${Resources[k] ? Resources[k].name : k}${v}`;
            }).join('<br>');

            let customClass = 'demand';
            let titleText = d.name;
            let tooltip = null;
            if (d.effect) {
                customClass += ' has-effect';
                titleText += ' ⚙️';
                tooltip = EffectDescriptions[d.effect];
            }
            const card = this.createCardElement(titleText, `条件:\n${reqHtml}`, `+${d.points}🏆`, customClass, (el) => {
                if (this.selectedDemandId === d.id) {
                    this.selectedDemandId = null;
                    el.classList.remove('selected');
                } else {
                    Array.from(container.children).forEach(c => c.classList.remove('selected'));
                    this.selectedDemandId = d.id;
                    el.classList.add('selected');
                }
            }, null, tooltip);
            if (this.selectedDemandId === d.id) card.classList.add('selected');
            container.appendChild(card);
        });
    }

    renderPlayers(game) {
        const container = document.getElementById('players-area');
        container.innerHTML = '';
        const tpl = document.getElementById('tpl-player-board').content;

        game.players.forEach(player => {
            const clone = document.importNode(tpl, true);
            const board = clone.querySelector('.player-board');

            if (player.id === game.currentPlayerIndex) {
                board.classList.add('active-player');
            }

            board.querySelector('.player-name').textContent = player.name;
            board.querySelector('.score-val').textContent = player.score;
            const handCountEl = board.querySelector('.hand-count-val');
            handCountEl.textContent = player.hand.length;
            const maxHand = player.maxHandSize || 8;
            // 手札数/上限の表示を動的に更新
            const handSpan = board.querySelector('.player-stats span[title="手札枚数"]');
            if (handSpan) handSpan.innerHTML = `手札: <span class="hand-count-val">${player.hand.length}</span>/${maxHand}枚`;

            // 手札の警告色
            if (player.hand.length > maxHand) {
                handCountEl.style.color = 'red';
            }

            // 稼働特産品
            const activeCont = board.querySelector('.active-specialties');
            player.activeSpecialties.forEach((sId, idx) => {
                const s = Specialties[sId];
                const isCurrentPlayer = player.id === game.currentPlayerIndex;
                const hasPlant = player.processingPlants && player.processingPlants.includes(s.resource);
                const overlay = hasPlant ? '🏭' : null;
                const card = this.createCardElement(s.name, s.resource, s.icon, `specialty ${Resources[s.resource].type}`, isCurrentPlayer ? (el) => {
                    if (this.selectedActiveSpecialtyIndex === idx) {
                        this.selectedActiveSpecialtyIndex = -1;
                        el.classList.remove('selected');
                    } else {
                        Array.from(activeCont.children).forEach(c => c.classList.remove('selected'));
                        this.selectedActiveSpecialtyIndex = idx;
                        el.classList.add('selected');
                    }
                } : null, overlay);
                if (isCurrentPlayer && this.selectedActiveSpecialtyIndex === idx) card.classList.add('selected');
                activeCont.appendChild(card);
            });

            // 未稼働特産品
            const inactiveCont = board.querySelector('.inactive-specialties');
            player.inactiveSpecialties.forEach((sId, idx) => {
                const s = Specialties[sId];
                const isCurrentPlayer = player.id === game.currentPlayerIndex;
                const card = this.createCardElement(s.name, s.resource, s.icon, `specialty inactive ${Resources[s.resource].type}`, isCurrentPlayer ? (el) => {
                    // setup phase may have changed it to array, reset to number for normal phase
                    if (Array.isArray(this.selectedInactiveSpecialtyIndex)) {
                        this.selectedInactiveSpecialtyIndex = -1;
                    }
                    if (this.selectedInactiveSpecialtyIndex === idx) {
                        this.selectedInactiveSpecialtyIndex = -1;
                        el.classList.remove('selected');
                    } else {
                        Array.from(inactiveCont.children).forEach(c => c.classList.remove('selected'));
                        this.selectedInactiveSpecialtyIndex = idx;
                        el.classList.add('selected');
                    }
                } : null);

                if (isCurrentPlayer && this.selectedInactiveSpecialtyIndex === idx) card.classList.add('selected');
                inactiveCont.appendChild(card);
            });

            // 手札
            const handCont = board.querySelector('.hand-cards');
            player.hand.forEach((resId, idx) => {
                const r = Resources[resId];
                const isCurrentPlayer = player.id === game.currentPlayerIndex;
                const card = this.createCardElement(r.name, r.type === 'base' ? '基本資源' : '交易品', r.icon, `resource ${r.type}`, isCurrentPlayer ? (el) => {
                    const selectedIdx = this.selectedHandIndices.indexOf(idx);
                    if (selectedIdx > -1) {
                        this.selectedHandIndices.splice(selectedIdx, 1);
                        el.classList.remove('selected');
                    } else {
                        this.selectedHandIndices.push(idx);
                        el.classList.add('selected');
                    }
                } : null);

                if (isCurrentPlayer && this.selectedHandIndices.includes(idx)) {
                    card.classList.add('selected');
                }

                // 他プレイヤーの手札は裏向き(あるいは非表示)にするのが本来ですが、
                // ホットシートで1画面共有のため全て公開情報として表示します。
                handCont.appendChild(card);
            });

            // 獲得済み
            const demandsCont = board.querySelector('.achieved-demands');
            demandsCont.innerHTML = '';
            const isCurrentPlayer = player.id === game.currentPlayerIndex;
            player.achievedDemands.forEach(id => {
                const d = Demands.find(x => x.id === id);
                if (!d) return;
                const row = document.createElement('div');
                row.style.cssText = 'font-size:0.8rem; margin-bottom:3px; display:flex; align-items:center; gap:6px;';
                row.innerHTML = `<span>📜 ${d.name} (${d.points}点)</span>`;

                // 効果ボタン
                if (isCurrentPlayer && d.effect === 'free_processing_plant' && game.turnState?.freeProcessingPlant) {
                    const btn = document.createElement('button');
                    btn.textContent = '使用する';
                    btn.className = 'btn action-btn';
                    btn.style.cssText = 'font-size:0.7rem; padding:2px 8px; background:#8b5a2b;';
                    btn.id = 'btn-use-free-plant';
                    btn.addEventListener('click', () => this.showFreePlantOverlay(game));
                    row.appendChild(btn);
                }
                if (isCurrentPlayer && d.effect === 'discounted_exchange' && game.turnState?.discountedExchange) {
                    const btn = document.createElement('button');
                    btn.textContent = '使用する';
                    btn.className = 'btn action-btn';
                    btn.style.cssText = 'font-size:0.7rem; padding:2px 8px; background:#5a7a2b;';
                    btn.id = 'btn-use-discounted-exchange';
                    btn.addEventListener('click', () => this.startDiscountedExchangeMode(game));
                    row.appendChild(btn);
                }
                demandsCont.appendChild(row);
            });

            const rolesCont = board.querySelector('.achieved-roles');
            rolesCont.innerHTML = player.achievedRoles.map(id => {
                const r = FixedRoles.find(x => x.id === id);
                return `<div style="font-size:0.8rem; margin-bottom:2px;">🏅 ${r.name} (${r.points}点)</div>`;
            }).join('');

            container.appendChild(board);
        });
    }

    showRolesModal(isAchieveMode) {
        const overlay = document.getElementById('modal-overlay');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');
        const btnConfirm = document.getElementById('btn-modal-confirm');

        title.textContent = isAchieveMode ? '固定役の達成' : '固定役表';

        let html = '<table class="role-table"><tr>';
        if (isAchieveMode) html += '<th>選択</th>';
        html += '<th>役名</th><th>条件</th><th>得点</th></tr>';

        const cp = this.gameRef.getCurrentPlayer();

        FixedRoles.forEach(r => {
            const isAchieved = cp.achievedRoles.includes(r.id);
            html += `<tr style="${isAchieved ? 'opacity:0.5' : ''}">`;

            if (isAchieveMode) {
                html += `<td><input type="radio" name="role-select" value="${r.id}" ${isAchieved ? 'disabled' : ''}></td>`;
            }

            html += `<td>${r.name}${isAchieved ? ' (達成済)' : ''}</td><td>${r.reqText}</td><td>${r.points}点</td></tr>`;
        });
        html += '</table>';

        if (isAchieveMode) {
            html += '<p class="mt-2" style="color:var(--accent-red)">※達成にはメイン画面で手札リソースを選択した状態で実行してください。</p>';
        }

        body.innerHTML = html;

        if (isAchieveMode) {
            btnConfirm.classList.remove('hidden');
        } else {
            btnConfirm.classList.add('hidden');
        }

        overlay.classList.remove('hidden');
    }

    closeModal() {
        document.getElementById('modal-overlay').classList.add('hidden');
    }

    showAlert(msg) {
        alert(msg);
    }

    hideEffectOverlays() {
        ['gain-resource-overlay', 'market-replace-overlay', 'stockpile-exchange-overlay', 'free-plant-overlay'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
    }

    // 効果: 食料市 — 基本資源選択オーバーレイを表示
    renderGainResourcePhase(game) {
        const overlay = document.getElementById('gain-resource-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');

        const container = document.getElementById('gain-resource-cards');
        container.innerHTML = '';
        this._gainResourceSelected = null;

        Object.values(Resources).filter(r => r.type === ResourceTypes.BASE).forEach(r => {
            const card = this.createCardElement(r.name, '基本資源', r.icon, `resource base`, (el) => {
                Array.from(container.children).forEach(c => c.classList.remove('selected'));
                this._gainResourceSelected = r.id;
                el.classList.add('selected');
            });
            container.appendChild(card);
        });
    }

    // 効果: 造船材調達 — マーケット選択オーバーレイを表示
    renderMarketReplacePhase(game) {
        const overlay = document.getElementById('market-replace-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');

        const container = document.getElementById('market-replace-cards');
        container.innerHTML = '';
        this._marketReplaceSelected = [];

        game.marketCards.forEach((resId, index) => {
            if (!resId) return;
            const res = Resources[resId];
            const card = this.createCardElement(res.name, res.type === 'base' ? '基本資源' : '交易品', res.icon, `resource ${res.type}`, (el) => {
                const idx = this._marketReplaceSelected.indexOf(index);
                if (idx > -1) {
                    this._marketReplaceSelected.splice(idx, 1);
                    el.classList.remove('selected');
                } else if (this._marketReplaceSelected.length < 2) {
                    this._marketReplaceSelected.push(index);
                    el.classList.add('selected');
                }
                const countEl = document.getElementById('market-replace-count');
                if (countEl) countEl.textContent = `選択中: ${this._marketReplaceSelected.length} 枚`;
            });
            container.appendChild(card);
        });
    }

    // 効果: 国家備蓄 — 手札を最大2枚交換し、同数の基本資源を得る
    renderStockpileExchangePhase(game) {
        const overlay = document.getElementById('stockpile-exchange-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');

        const player = game.getCurrentPlayer();
        this._stockpileDiscardSelected = [];
        this._stockpileGainCounts = {};

        const handContainer = document.getElementById('stockpile-hand-cards');
        const gainContainer = document.getElementById('stockpile-gain-cards');
        const countEl = document.getElementById('stockpile-count');
        if (!handContainer || !gainContainer || !countEl) return;

        const updateCount = () => {
            const discardCount = this._stockpileDiscardSelected.length;
            const gainCount = Object.values(this._stockpileGainCounts).reduce((sum, n) => sum + n, 0);
            countEl.textContent = `破棄: ${discardCount}枚 / 獲得: ${gainCount}枚`;
        };

        handContainer.innerHTML = '';
        player.hand.forEach((resId, idx) => {
            const r = Resources[resId];
            const card = this.createCardElement(r.name, r.type === 'base' ? '基本資源' : '交易品', r.icon, `resource ${r.type}`, (el) => {
                const selectedIdx = this._stockpileDiscardSelected.indexOf(idx);
                if (selectedIdx > -1) {
                    this._stockpileDiscardSelected.splice(selectedIdx, 1);
                    el.classList.remove('selected');
                } else if (this._stockpileDiscardSelected.length < 2) {
                    this._stockpileDiscardSelected.push(idx);
                    el.classList.add('selected');
                }
                updateCount();
            });
            handContainer.appendChild(card);
        });

        gainContainer.innerHTML = '';
        Object.values(Resources).filter(r => r.type === ResourceTypes.BASE).forEach(r => {
            const card = this.createCardElement(r.name, '基本資源', r.icon, 'resource base', (el) => {
                const discardCount = this._stockpileDiscardSelected.length;
                const gainCount = Object.values(this._stockpileGainCounts).reduce((sum, n) => sum + n, 0);
                const current = this._stockpileGainCounts[r.id] || 0;

                if (current > 0 && gainCount >= discardCount) {
                    this._stockpileGainCounts[r.id] = current - 1;
                } else if (gainCount < discardCount) {
                    this._stockpileGainCounts[r.id] = current + 1;
                } else {
                    return;
                }

                const next = this._stockpileGainCounts[r.id] || 0;
                const overlay = el.querySelector('.card-overlay');
                if (next > 0) {
                    el.classList.add('selected');
                    if (overlay) {
                        overlay.textContent = `x${next}`;
                        overlay.style.display = 'flex';
                    }
                } else {
                    el.classList.remove('selected');
                    if (overlay) {
                        overlay.textContent = '';
                        overlay.style.display = 'none';
                    }
                }
                updateCount();
            });
            const badge = document.createElement('div');
            badge.className = 'card-overlay';
            badge.style.display = 'none';
            card.appendChild(badge);
            gainContainer.appendChild(card);
        });

        updateCount();
    }

    // 効果: 工房街整備 — 加工所建設オーバーレイを表示
    showFreePlantOverlay(game) {
        const overlay = document.getElementById('free-plant-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');

        const player = game.getCurrentPlayer();
        this._freePlantSpecialty = null;
        this._freePlantHandIndex = -1;

        // 稼働中の基本特産品
        const specCont = document.getElementById('free-plant-specialties');
        specCont.innerHTML = '';
        player.activeSpecialties.forEach((sId) => {
            const s = Specialties[sId];
            if (Resources[s.resource].type !== ResourceTypes.BASE) return;
            if (player.processingPlants && player.processingPlants.includes(s.resource)) return;
            const card = this.createCardElement(s.name, s.resource, s.icon, `specialty base`, (el) => {
                Array.from(specCont.children).forEach(c => c.classList.remove('selected'));
                this._freePlantSpecialty = sId;
                el.classList.add('selected');
            });
            specCont.appendChild(card);
        });

        // 手札の資源カード
        const handCont = document.getElementById('free-plant-hand');
        handCont.innerHTML = '';
        player.hand.forEach((resId, idx) => {
            const r = Resources[resId];
            if (r.type !== ResourceTypes.BASE) return;
            const card = this.createCardElement(r.name, '基本資源', r.icon, `resource base`, (el) => {
                Array.from(handCont.children).forEach(c => c.classList.remove('selected'));
                this._freePlantHandIndex = idx;
                el.classList.add('selected');
            });
            handCont.appendChild(card);
        });
    }

    // 効果: 大商館納品 — 割引交換モード開始（選択状態を割引モードとしてマーク）
    startDiscountedExchangeMode(game) {
        this._discountedExchangeMode = true;
        alert('割引交換モード：手札から資源を選択し、マーケットの資源を選んで「マーケット交換」ボタンを押してください。\n(基本1→基本1 / 基本2→交易1 / 交易1→基本1 / 交易1→交易1)');
    }
}
