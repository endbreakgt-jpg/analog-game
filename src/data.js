import { shuffle } from './random.js';

export const ResourceTypes = {
    BASE: 'base',
    TRADE: 'trade'
};

export const Resources = {
    wood: { id: 'wood', name: '木材', type: ResourceTypes.BASE, icon: '🌲' },
    stone: { id: 'stone', name: '石材', type: ResourceTypes.BASE, icon: '⛰️' },
    iron: { id: 'iron', name: '鉄', type: ResourceTypes.BASE, icon: '⛏️' },
    wheat: { id: 'wheat', name: '小麦', type: ResourceTypes.BASE, icon: '🌾' },
    fish: { id: 'fish', name: '魚', type: ResourceTypes.BASE, icon: '🐟' },
    wool: { id: 'wool', name: '羊毛', type: ResourceTypes.BASE, icon: '🐑' },
    clay: { id: 'clay', name: '粘土', type: ResourceTypes.BASE, icon: '🏺' },
    sugar: { id: 'sugar', name: '砂糖', type: ResourceTypes.TRADE, icon: '🧊' },
    spice: { id: 'spice', name: '香辛料', type: ResourceTypes.TRADE, icon: '🌶️' },
    silk: { id: 'silk', name: '絹', type: ResourceTypes.TRADE, icon: '👘' },
    gem: { id: 'gem', name: '宝石', type: ResourceTypes.TRADE, icon: '💎' },
    ivory: { id: 'ivory', name: '象牙', type: ResourceTypes.TRADE, icon: '🐘' }
};

export const ProcessedMap = {
    wood: '製材',
    stone: '石工品',
    iron: '工具',
    wheat: '粉・酒',
    fish: '保存食',
    wool: '布',
    clay: '陶器'
};

export const Specialties = {
    forest: { id: 'forest', name: '森林', resource: 'wood', icon: '🌲' },
    quarry: { id: 'quarry', name: '採石場', resource: 'stone', icon: '⛰️' },
    ironMine: { id: 'ironMine', name: '鉄鉱山', resource: 'iron', icon: '⛏️' },
    wheatField: { id: 'wheatField', name: '麦畑', resource: 'wheat', icon: '🌾' },
    fishery: { id: 'fishery', name: '漁場', resource: 'fish', icon: '🎣' },
    sheepFarm: { id: 'sheepFarm', name: '羊牧場', resource: 'wool', icon: '🐑' },
    clayPit: { id: 'clayPit', name: '粘土層', resource: 'clay', icon: '🧱' },
    sugarPlantation: { id: 'sugarPlantation', name: '砂糖農園', resource: 'sugar', icon: '🌴' },
    spiceField: { id: 'spiceField', name: '香辛料畑', resource: 'spice', icon: '🌶️' },
    silkFarm: { id: 'silkFarm', name: '養蚕地', resource: 'silk', icon: '🐛' },
    gemMine: { id: 'gemMine', name: '宝石鉱山', resource: 'gem', icon: '💎' },
    ivoryTrade: { id: 'ivoryTrade', name: '象牙交易地', resource: 'ivory', icon: '🐘' }
};

export const FixedRoles = [
    { id: 'fr1', name: '基礎建設', reqText: '木材+石材 (木/石加工で+1点)', req: { wood: 1, stone: 1 }, points: 2, bonus: { targets: ['wood', 'stone'], points: 1 } },
    { id: 'fr2', name: '食料供給', reqText: '小麦+魚 (麦/魚加工で+1点)', req: { wheat: 1, fish: 1 }, points: 2, bonus: { targets: ['wheat', 'fish'], points: 1 } },
    { id: 'fr3', name: '鉄工業', reqText: '鉄+木材 (鉄加工で+1点)', req: { iron: 1, wood: 1 }, points: 3, bonus: { targets: ['iron'], points: 1 } },
    { id: 'fr4', name: '建材産業', reqText: '木材+石材+粘土 (いずれか加工で+1点)', req: { wood: 1, stone: 1, clay: 1 }, points: 4, bonus: { targets: ['wood', 'stone', 'clay'], points: 1 } },
    { id: 'fr5', name: '生活産業', reqText: '小麦+魚+羊毛 (いずれか加工で+1点)', req: { wheat: 1, fish: 1, wool: 1 }, points: 4, bonus: { targets: ['wheat', 'fish', 'wool'], points: 1 } },
    { id: 'fr6', name: '織物産業', reqText: '羊毛+絹 (羊毛加工で+1点)', req: { wool: 1, silk: 1 }, points: 4, bonus: { targets: ['wool'], points: 1 } },
    { id: 'fr7', name: '地場加工', reqText: '任意の加工品1+異なる基本1資源', req: { _anyProcessed: 1, _diffBase: 1 }, points: 3 },
    { id: 'fr8', name: '複合工房', reqText: '異なる加工品2', req: { _diffProcessed: 2 }, points: 5 },
    { id: 'fr9', name: '広域交易', reqText: '異なる交易品2', req: { _diffTrade: 2 }, points: 3 },
    { id: 'fr10', name: '王侯献上品', reqText: '異なる交易品3', req: { _diffTrade: 3 }, points: 6 }
];

export const Demands = [
    // 基本需要 10枚
    {
        id: 'd_basic1',
        name: '王都建設',
        reqText: '通常: 木材+石材+鉄 / サブ: 木材+石材+任意交易品',
        req: { wood: 1, stone: 1, iron: 1 },
        points: 5,
        variants: [
            { id: 'normal', label: '通常', req: { wood: 1, stone: 1, iron: 1 }, points: 5 },
            { id: 'sub', label: 'サブ', req: { wood: 1, stone: 1, _anyTrade: 1 }, points: 4 }
        ]
    },
    {
        id: 'd_basic2',
        name: '城壁修復',
        reqText: '通常: 石材+粘土+鉄 / サブ: 石材+粘土+任意交易品',
        req: { stone: 1, clay: 1, iron: 1 },
        points: 5,
        variants: [
            { id: 'normal', label: '通常', req: { stone: 1, clay: 1, iron: 1 }, points: 5 },
            { id: 'sub', label: 'サブ', req: { stone: 1, clay: 1, _anyTrade: 1 }, points: 4 }
        ]
    },
    { id: 'd_basic3', name: '船団整備', reqText: '木材+鉄+魚 (効果:通常交換)', req: { wood: 1, iron: 1, fish: 1 }, points: 4, effect: 'normal_market_exchange' },
    {
        id: 'd_basic4',
        name: '冬支度',
        reqText: '通常: 木材+小麦+羊毛 / サブ: 小麦+羊毛+任意交易品',
        req: { wood: 1, wheat: 1, wool: 1 },
        points: 4,
        variants: [
            { id: 'normal', label: '通常', req: { wood: 1, wheat: 1, wool: 1 }, points: 4 },
            { id: 'sub', label: 'サブ', req: { wheat: 1, wool: 1, _anyTrade: 1 }, points: 3 }
        ]
    },
    {
        id: 'd_basic5',
        name: '兵站整備',
        reqText: '通常: 小麦+魚+鉄 / サブ: 小麦+魚+任意交易品',
        req: { wheat: 1, fish: 1, iron: 1 },
        points: 4,
        effect: 'bonus_ap_next_turn',
        variants: [
            { id: 'normal', label: '通常', req: { wheat: 1, fish: 1, iron: 1 }, points: 4 },
            { id: 'sub', label: 'サブ', req: { wheat: 1, fish: 1, _anyTrade: 1 }, points: 3 }
        ]
    },
    {
        id: 'd_basic6',
        name: '灌漑事業',
        reqText: '通常: 木材+石材+小麦 / サブ: 木材+小麦+任意交易品',
        req: { wood: 1, stone: 1, wheat: 1 },
        points: 5,
        variants: [
            { id: 'normal', label: '通常', req: { wood: 1, stone: 1, wheat: 1 }, points: 5 },
            { id: 'sub', label: 'サブ', req: { wood: 1, wheat: 1, _anyTrade: 1 }, points: 4 }
        ]
    },
    { id: 'd_basic7', name: '住宅整備', reqText: '木材+粘土+羊毛 (効果:手札1枚交換)', req: { wood: 1, clay: 1, wool: 1 }, points: 3, effect: 'hand_exchange_1' },
    {
        id: 'd_basic8',
        name: '工房街整備',
        reqText: '通常: 木材+粘土+鉄 / サブ: 木材+粘土+任意交易品',
        req: { wood: 1, clay: 1, iron: 1 },
        points: 4,
        effect: 'free_processing_plant',
        variants: [
            { id: 'normal', label: '通常', req: { wood: 1, clay: 1, iron: 1 }, points: 4 },
            { id: 'sub', label: 'サブ', req: { wood: 1, clay: 1, _anyTrade: 1 }, points: 3 }
        ]
    },
    { id: 'd_basic9', name: '食料市', reqText: '小麦+魚+任意の基本資源1', req: { wheat: 1, fish: 1, _anyBase: 1 }, points: 3, effect: 'gain_base_resource' },
    { id: 'd_basic10', name: '国家備蓄', reqText: '異なる基本資源4種', req: { _diffBase: 4 }, points: 5, effect: 'stockpile_exchange' },
    // 加工ボーナス需要 10枚
    { id: 'd_bonus1', name: '陶器輸出', reqText: '粘土+任意の交易品1 (粘土加工+2)', req: { clay: 1, _anyTrade: 1 }, points: 5, bonus: { targets: ['clay'], points: 2 } },
    { id: 'd_bonus2', name: '織物市', reqText: '羊毛+任意の交易品1 (羊毛加工+2)', req: { wool: 1, _anyTrade: 1 }, points: 5, bonus: { targets: ['wool'], points: 2 } },
    { id: 'd_bonus3', name: '工具供給', reqText: '鉄+木材 (鉄加工+2)', req: { iron: 1, wood: 1 }, points: 4, bonus: { targets: ['iron'], points: 2 } },
    { id: 'd_bonus4', name: '製材納入', reqText: '木材+石材 (木材加工+2)', req: { wood: 1, stone: 1 }, points: 4, bonus: { targets: ['wood'], points: 2 } },
    { id: 'd_bonus5', name: '保存食納入', reqText: '魚+小麦 (魚加工+2)', req: { fish: 1, wheat: 1 }, points: 4, bonus: { targets: ['fish'], points: 2 } },
    { id: 'd_bonus6', name: '製粉供給', reqText: '小麦+任意の基本資源1 (小麦加工+2)', req: { wheat: 1, _anyBase: 1 }, points: 4, bonus: { targets: ['wheat'], points: 2 } },
    { id: 'd_bonus7', name: '石工装飾', reqText: '石材+宝石 (石材加工+2)', req: { stone: 1, gem: 1 }, points: 5, bonus: { targets: ['stone'], points: 2 } },
    { id: 'd_bonus8', name: '造船材調達', reqText: '木材+羊毛+魚 (木材加工+1、効果:マーケット入れ替え+基本資源獲得)', req: { wood: 1, wool: 1, fish: 1 }, points: 4, bonus: { targets: ['wood'], points: 1 }, effect: 'market_replace_2' },
    { id: 'd_bonus9', name: '軍需補給', reqText: '鉄+小麦+魚 (鉄加工+2)', req: { iron: 1, wheat: 1, fish: 1 }, points: 6, bonus: { targets: ['iron'], points: 2 } },
    { id: 'd_bonus10', name: '都市食料流通', reqText: '小麦+魚+粘土 (小麦/魚加工+2)', req: { wheat: 1, fish: 1, clay: 1 }, points: 5, bonus: { targets: ['wheat', 'fish'], points: 2 } },
    // 高級需要 4枚
    { id: 'd_lux1', name: '宮廷調度品', reqText: '任意の加工品1+宝石+絹', req: { _anyProcessed: 1, gem: 1, silk: 1 }, points: 8 },
    { id: 'd_lux2', name: '大商館納品', reqText: '任意の加工品1+香辛料+砂糖 (効果:割引交換)', req: { _anyProcessed: 1, spice: 1, sugar: 1 }, points: 7, effect: 'discounted_exchange' },
    { id: 'd_lux3', name: '軍需契約', reqText: '任意の加工品1+鉄+小麦+魚', req: { _anyProcessed: 1, iron: 1, wheat: 1, fish: 1 }, points: 8 },
    { id: 'd_lux4', name: '献上品競売', reqText: '異なる交易品3種', req: { _diffTrade: 3 }, points: 7 }
];

export const createMarketDeck = (random = Math.random) => {
    let deck = [];
    Object.values(Resources).filter(r => r.type === ResourceTypes.BASE).forEach(r => {
        deck.push(r.id, r.id);
    });
    Object.values(Resources).filter(r => r.type === ResourceTypes.TRADE).forEach(r => {
        deck.push(r.id);
    });
    return shuffle(deck, random); // シャッフル
};

export const createDemandDeck = (random = Math.random) => {
    return shuffle(Demands.map(d => d.id), random); // シャッフル
};

export const getDemandVariants = (demand) => {
    if (Array.isArray(demand.variants) && demand.variants.length > 0) {
        return demand.variants;
    }

    return [{
        id: 'normal',
        label: '通常',
        req: demand.req,
        points: demand.points,
        reqText: demand.reqText
    }];
};

export const createSpecialtyDeck = (random = Math.random) => {
    let deck = [];
    // 12種 × 各3枚 = 36枚
    Object.values(Specialties).forEach(s => {
        deck.push(s.id, s.id, s.id);
    });
    return shuffle(deck, random);
};
