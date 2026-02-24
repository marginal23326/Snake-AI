/**
 *
 * Options:
 *   --pop=N           Population size              (default 30)
 *   --gens=N          Generations                  (default 25)
 *   --elite=N         Elitism count                (default 4)
 *   --games=N         Games per opponent           (default 5)
 *   --depth=N         AI search depth for training (default 6)
 *   --width=N         Board width                  (default 16)
 *   --height=N        Board height                 (default 9)
 *   --maxTurns=N      Max turns per game           (default 500)
 *   --mutRate=F       Mutation probability          (default 0.25)
 *   --mutStr=F        Mutation strength             (default 0.15)
 *   --tourney=N       Tournament selection size     (default 3)
 *   --save=FILE       Output JSON file             (default src/ai/data/ga_results.json)
 *   --opponent=TARGET Add an HTTP opponent URL or roster name (repeatable)
 *   --onlyHttp=1      Use only HTTP opponents      (skip built-ins)
 *   --httpGames=N     Games per HTTP opponent      (default --games)
 *   --selfPlay=1      Include self-play champions  (default config)
 *   --selfGames=N     Total games vs self pool/gen (default config)
 *   --selfEvery=N     Snapshot champion every N gen(default config)
 *   --selfRecent=N    # of recent champs in pool   (default config)
 *   --selfHof=N       # of HOF champs in pool      (default config)
 *   --selfMaxPool=N   Hard cap for self pool size  (default config)
 *   --stagedEval=1    Quick pass + top-k full pass (default config)
 *   --quickGames=N    Quick games per non-HTTP opp (default config)
 *   --quickHttpGames=N Quick games per HTTP opp     (default config)
 *   --quickSelfGames=N Quick total self games/gen   (default config)
 *   --quickTurnRatio=F Quick maxTurns ratio         (default config)
 *   --refineTopFrac=F Full-pass top fraction        (default config)
 *   --validationGames=N Final validation base games (default config)
 *   --progress=N      0=minimal, 1=stage detail, 2=per-match trace
 *   --progressEvery=N For progress=2, print every N matches
 *   --verify=1        Verify candidates with regression suite (default config)
 *   --verifyDepths=L  Comma depth list for verification (default config)
 *   --verifyMaxAttempts=N Max retries replacing failed candidates (default config)
 *   --list-opponents  Print shared opponent roster and exit
 *   --httpApi=MODE    HTTP payload mode: auto|standard|world|legacy (default auto)
 *   --legacyHttp=1    Force legacy payload transform for HTTP opponents
 *   --resume=FILE     Load progress from a checkpoint file
 *   --checkpoint=FILE File to save periodic progress (default src/ai/data/ga_checkpoint.json)
 */

const { getSmartMoveDebug } = require('../brain');
const Config = require('../config');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { loadScenarios, runRegressionSuite } = require('../test/regression_suite');
const {
    STANDARD_FOOD_SETTINGS,
    placeInitialStandardFood,
    applyStandardFoodSpawning
} = require('../standard_food');
const {
    normalizeApiType,
    normalizeMoveName,
    moveNameToVector,
    buildMovePayload
} = require('./http_api');
const {
    DEFAULT_OPPONENT_ROSTER,
    findRosterOpponent,
    isHttpUrl,
    formatOpponentRoster
} = require('./opponent_roster');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DEFAULT_SAVE_FILE = path.join(DATA_DIR, 'ga_results.json');
const DEFAULT_CHECKPOINT_FILE = path.join(DATA_DIR, 'ga_checkpoint.json');
const DEFAULT_BEST_FILE = path.join(DATA_DIR, 'checkpoint_best.json');

//  GENE DEFINITIONS
//  Each gene maps to one tunable parameter in Config.

const GENES = [
    { name: 'TRAP_DANGER',          path: ['SCORES','TRAP_DANGER'],            min: -700000000, max: -150000000, isInt: true  },
    { name: 'STRATEGIC_SQUEEZE',    path: ['SCORES','STRATEGIC_SQUEEZE'],      min: -50000000,  max: -500000,    isInt: true  },
    { name: 'ENEMY_TRAPPED',        path: ['SCORES','ENEMY_TRAPPED'],          min: 50000000,   max: 500000000,  isInt: true  },
    { name: 'HEAD_ON_COLLISION',    path: ['SCORES','HEAD_ON_COLLISION'],      min: -400000000, max: -100000000, isInt: true  },
    { name: 'TIGHT_SPOT',           path: ['SCORES','TIGHT_SPOT'],             min: -100000,    max: -10000,     isInt: false },
    { name: 'LENGTH',               path: ['SCORES','LENGTH'],                 min: 0,          max: 10000,      isInt: false },
    { name: 'EAT_REWARD',           path: ['SCORES','EAT_REWARD'],             min: 100,        max: 10000,      isInt: false },
    { name: 'TERRITORY_CONTROL',    path: ['SCORES','TERRITORY_CONTROL'],      min: 10,         max: 5000,       isInt: false },
    { name: 'KILL_PRESSURE',        path: ['SCORES','KILL_PRESSURE'],          min: 50000,      max: 500000,     isInt: false },
    { name: 'FOOD_INTENSITY',       path: ['SCORES','FOOD','INTENSITY'],       min: 100,        max: 4000,       isInt: false },
    { name: 'FOOD_THRESHOLD',       path: ['SCORES','FOOD','THRESHOLD'],       min: 3,          max: 20,         isInt: false },
    { name: 'FOOD_EXPONENT',        path: ['SCORES','FOOD','EXPONENT'],        min: 1,          max: 3,          isInt: false },
    { name: 'AGGRESSION',           path: ['SCORES','AGGRESSION'],             min: 100,        max: 10000,      isInt: false },
];

//  CHROMOSOME  ↔  CONFIG

/** Read current Config values into a chromosome array. */
function readConfig() {
    return GENES.map(g => {
        let obj = Config;
        for (const k of g.path) obj = obj[k];
        return obj;
    });
}

/** Write a chromosome array into the live Config object. */
function writeConfig(chromo) {
    for (let i = 0; i < GENES.length; i++) {
        let obj = Config;
        const p = GENES[i].path;
        for (let j = 0; j < p.length - 1; j++) obj = obj[p[j]];
        obj[p[p.length - 1]] = GENES[i].isInt ? Math.round(chromo[i]) : chromo[i];
    }
}

/** Create a random chromosome within gene bounds. */
function randomChromo() {
    return GENES.map(g => {
        const v = g.min + Math.random() * (g.max - g.min);
        return g.isInt ? Math.round(v) : v;
    });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

//  SEEDED PRNG   (Lehmer / Park-Miller)

class RNG {
    constructor(seed) {
        this.s = seed % 2147483647;
        if (this.s <= 0) this.s += 2147483646;
    }
    next() {
        this.s = (this.s * 16807) % 2147483647;
        return (this.s - 1) / 2147483646;
    }
    int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo)); }
}

class Arena {
    constructor(W, H, seed) {
        this.W = W;
        this.H = H;
        this.rng = new RNG(seed || (1 + Math.floor(Math.random() * 999999)));
        this.foodSettings = {
            initialFood: STANDARD_FOOD_SETTINGS.initialFood,
            minimumFood: STANDARD_FOOD_SETTINGS.minimumFood,
            foodSpawnChance: STANDARD_FOOD_SETTINGS.foodSpawnChance,
        };
    }

    /** Place snakes and initial food. */
    _reset() {
        // Two starting configurations — RNG picks one
        const posA = [
            [{x:1, y:1},           {x:1, y:0},           {x:0, y:0}],
            [{x:this.W-2,y:this.H-2},{x:this.W-2,y:this.H-1},{x:this.W-1,y:this.H-1}]
        ];
        const posB = [
            [{x:1, y:this.H-2},   {x:0, y:this.H-2},   {x:0, y:this.H-1}],
            [{x:this.W-2, y:1},   {x:this.W-1, y:1},   {x:this.W-1, y:0}]
        ];
        const layout = this.rng.next() > 0.5 ? posA : posB;

        // Randomly swap who starts where
        const swap = this.rng.next() > 0.5;
        this.sn = [
            { body: (swap ? layout[1] : layout[0]).map(p => ({...p})), hp: 100, alive: true },
            { body: (swap ? layout[0] : layout[1]).map(p => ({...p})), hp: 100, alive: true },
        ];

        this.food = [];
        const randInt = (n) => this.rng.int(0, n);
        placeInitialStandardFood(
            randInt,
            this.W,
            this.H,
            this.sn,
            this.food,
            this.foodSettings
        );
        this.turn = 0;
    }

    _spawnFoodByRules() {
        const randInt = (n) => this.rng.int(0, n);
        const liveSnakes = this.sn.filter(s => s.alive);
        applyStandardFoodSpawning(
            randInt,
            this.W,
            this.H,
            liveSnakes,
            this.food,
            this.foodSettings
        );
    }

    /**
     * Run a complete game. fn0/fn1 are move functions: (me, enemy, food, width, height) → {x, y}
     * They can be sync or async (both are awaited). Returns { winner: 0|1|-1, turns, len:[l0,l1] }
     */
    async play(fn0, fn1, maxT) {
        this._reset();
        const fns = [fn0, fn1];

        while (this.turn < maxT && this.sn[0].alive && this.sn[1].alive) {

            // 1. Collect moves
            const mv = [{x:0,y:1}, {x:0,y:1}];
            for (let i = 0; i < 2; i++) {
                if (!this.sn[i].alive) continue;
                const me = {
                    body:   this.sn[i].body.map(p => ({...p})),
                    health: this.sn[i].hp
                };
                const en = {
                    body:   this.sn[1-i].body.map(p => ({...p})),
                    health: this.sn[1-i].hp
                };
                const fd = this.food.map(f => ({...f}));
                try {
                    const m = await fns[i](me, en, fd, this.W, this.H, this.turn);
                    if (m && typeof m.x === 'number' && typeof m.y === 'number') mv[i] = m;
                } catch (_) { /* default UP */ }
            }

            // 2. Move heads, decrement health ──
            for (let i = 0; i < 2; i++) {
                if (!this.sn[i].alive) continue;
                const h = this.sn[i].body[0];
                this.sn[i].body.unshift({ x: h.x + mv[i].x, y: h.y + mv[i].y });
                this.sn[i].hp--;
            }

            // 3. Eat food
            const ate = [false, false];
            const eaten = new Set();
            for (let i = 0; i < 2; i++) {
                if (!this.sn[i].alive) continue;
                const h = this.sn[i].body[0];
                const fi = this.food.findIndex(f => f.x === h.x && f.y === h.y);
                if (fi >= 0) {
                    ate[i] = true;
                    eaten.add(fi);
                    this.sn[i].hp = 100;
                }
            }
            // Remove eaten food (reverse order to keep indices valid)
            for (const idx of [...eaten].sort((a, b) => b - a)) {
                this.food.splice(idx, 1);
            }

            // 4. Remove tails of snakes that didn't eat 
            for (let i = 0; i < 2; i++) {
                if (this.sn[i].alive && !ate[i]) this.sn[i].body.pop();
            }

            // 5. Check deaths
            for (let i = 0; i < 2; i++) {
                if (!this.sn[i].alive) continue;
                const h = this.sn[i].body[0];

                // Wall collision
                if (h.x < 0 || h.x >= this.W || h.y < 0 || h.y >= this.H) {
                    this.sn[i].alive = false; continue;
                }
                // Starvation
                if (this.sn[i].hp <= 0) {
                    this.sn[i].alive = false; continue;
                }
                // Self collision
                let dead = false;
                for (let j = 1; j < this.sn[i].body.length; j++) {
                    if (h.x === this.sn[i].body[j].x && h.y === this.sn[i].body[j].y) {
                        dead = true; break;
                    }
                }
                if (dead) { this.sn[i].alive = false; continue; }

                // Enemy body collision (not enemy head)
                const o = this.sn[1 - i];
                if (o.alive) {
                    for (let j = 1; j < o.body.length; j++) {
                        if (h.x === o.body[j].x && h.y === o.body[j].y) {
                            dead = true; break;
                        }
                    }
                    if (dead) { this.sn[i].alive = false; continue; }
                }
            }

            // Head-to-head collision
            if (this.sn[0].alive && this.sn[1].alive) {
                const a = this.sn[0].body[0], b = this.sn[1].body[0];
                if (a.x === b.x && a.y === b.y) {
                    const la = this.sn[0].body.length;
                    const lb = this.sn[1].body.length;
                    if (la <= lb) this.sn[0].alive = false;
                    if (lb <= la) this.sn[1].alive = false;
                }
            }

            // 6. Respawn food
            this._spawnFoodByRules();

            this.turn++;
        }

        // Determine winner
        const a0 = this.sn[0].alive, a1 = this.sn[1].alive;
        let winner = -1;
        if (a0 && !a1)       winner = 0;
        else if (!a0 && a1)  winner = 1;
        else if (a0 && a1) {
            // Both alive at turn limit — longer snake wins
            const l0 = this.sn[0].body.length, l1 = this.sn[1].body.length;
            winner = l0 > l1 ? 0 : l1 > l0 ? 1 : -1;
        }

        return {
            winner,
            turns: this.turn,
            len: [this.sn[0].body.length, this.sn[1].body.length]
        };
    }
}

//  BUILT-IN OPPONENTS

/** Return directions that don't immediately die. */
function _safe(me, enemy, W, H) {
    const hd = me.body[0];
    const occ = new Set();
    // Mark all body cells except the tail tip (it will move away)
    for (const s of [me, enemy]) {
        for (let i = 0; i < s.body.length - 1; i++) {
            occ.add(s.body[i].x + ',' + s.body[i].y);
        }
    }
    return [
        {x: 0, y: 1},   // UP
        {x: 0, y:-1},   // DOWN
        {x:-1, y: 0},   // LEFT
        {x: 1, y: 0},   // RIGHT
    ].filter(d => {
        const nx = hd.x + d.x, ny = hd.y + d.y;
        return nx >= 0 && nx < W && ny >= 0 && ny < H && !occ.has(nx + ',' + ny);
    });
}

/** Greedy: beelines for nearest food among safe moves. */
function greedyBot(me, enemy, food, W, H) {
    const dirs = _safe(me, enemy, W, H);
    if (!dirs.length) return {x:0, y:1};
    if (!food.length) return dirs[0];
    const hd = me.body[0];
    let best = food[0], bestD = Infinity;
    for (const f of food) {
        const d = Math.abs(hd.x - f.x) + Math.abs(hd.y - f.y);
        if (d < bestD) { bestD = d; best = f; }
    }
    dirs.sort((a, b) =>
        (Math.abs(hd.x+a.x - best.x) + Math.abs(hd.y+a.y - best.y)) -
        (Math.abs(hd.x+b.x - best.x) + Math.abs(hd.y+b.y - best.y))
    );
    return dirs[0];
}

/** Aggressive: chases the enemy's head when bigger, otherwise greedy. */
function aggressiveBot(me, enemy, food, W, H) {
    const dirs = _safe(me, enemy, W, H);
    if (!dirs.length) return {x:0, y:1};
    const hd = me.body[0];
    if (me.body.length > enemy.body.length) {
        const eh = enemy.body[0];
        dirs.sort((a, b) =>
            (Math.abs(hd.x+a.x - eh.x) + Math.abs(hd.y+a.y - eh.y)) -
            (Math.abs(hd.x+b.x - eh.x) + Math.abs(hd.y+b.y - eh.y))
        );
        return dirs[0];
    }
    return greedyBot(me, enemy, food, W, H);
}

/** Random: picks a random safe direction. */
// function randomBot(me, enemy, food, W, H) {
//     const dirs = _safe(me, enemy, W, H);
//     return dirs.length ? dirs[Math.floor(Math.random() * dirs.length)] : {x:0, y:1};
// }

//  HTTP OPPONENT (optional, for external snake servers)

function _httpPost(url, body, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const data = JSON.stringify(body);
        const req = http.request({
            hostname: u.hostname,
            port:     u.port || 80,
            path:     `${u.pathname}${u.search || ''}`,
            method:   'POST',
            headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, res => {
            let b = '';
            res.on('data', c => b += c);
            res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
        req.write(data);
        req.end();
    });
}

function looksLegacyHttpUrl(url, legacyPorts) {
    try {
        const u = new URL(url);
        const p = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
        return legacyPorts.includes(p);
    } catch (_) {
        return false;
    }
}

/**
 * Creates an async move-function that queries an HTTP snake server.
 * Supports world/legacy/standard payloads with optional auto-detection.
 */
function httpBot(baseUrl, options = {}) {
    const configuredApiType = options.apiType === 'auto'
        ? 'auto'
        : normalizeApiType(options.apiType);
    const timeoutMs = Math.max(200, Number(options.requestTimeoutMs) || 2000);
    const legacyHint = !!options.legacyHint;
    const moveUrl = `${String(baseUrl).replace(/\/+$/, '')}/move`;
    const autoOrder = legacyHint
        ? ['legacy', 'world', 'standard']
        : ['standard', 'world', 'legacy'];
    let detectedApiType = null;

    return async function(me, enemy, food, W, H, turn = 0) {
        const meSnake = {
            id: "http-bot",
            name: "Opponent",
            health: me.health,
            body: me.body.map(p => ({ x: p.x, y: p.y }))
        };
        const enemySnake = {
            id: "trainer",
            name: "local-old",
            health: enemy.health,
            body: enemy.body.map(p => ({ x: p.x, y: p.y }))
        };
        const state = {
            turn: Number.isFinite(turn) ? turn : 0,
            board: {
                width: W,
                height: H,
                food: food.map(f => ({ x: f.x, y: f.y })),
                snakes: [meSnake, enemySnake]
            }
        };
        const attemptApiTypes = detectedApiType
            ? [detectedApiType]
            : (configuredApiType === 'auto' ? autoOrder : [configuredApiType]);

        for (const apiType of attemptApiTypes) {
            const payload = buildMovePayload(state, meSnake, {
                apiType,
                gameId: "training-game",
                source: "genetic_trainer.js",
                timeout: 50
            });
            try {
                const resp = await _httpPost(moveUrl, payload, timeoutMs);
                const moveName = normalizeMoveName(resp?.move);
                if (!moveName) continue;
                if (configuredApiType === 'auto' && !detectedApiType) {
                    detectedApiType = apiType;
                }
                return moveNameToVector(moveName);
            } catch (_) {
                // Try the next API mode when auto-detecting.
            }
        }

        return moveNameToVector("up");
    };
}

//  AI PLAYER WRAPPER

function aiPlayer(me, enemy, food, W, H) {
    return getSmartMoveDebug(me, enemy, food, W, H).bestMove;
}

function makeConfigAiBot(chromo) {
    const frozen = [...chromo];
    return function(me, enemy, food, W, H) {
        writeConfig(frozen);
        return aiPlayer(me, enemy, food, W, H);
    };
}

function withDefault(value, fallback) {
    return value !== undefined ? value : fallback;
}

function clampInt(value, min, max) {
    return Math.max(min, Math.min(max, Math.round(value)));
}

function parseHttpApiMode(value, fallback = 'auto') {
    const mode = String(value ?? fallback).trim().toLowerCase();
    return ['auto', 'standard', 'world', 'legacy'].includes(mode) ? mode : fallback;
}

function resolveOpponentTarget(target, { httpApiMode, legacyPorts }) {
    const raw = String(target || '').trim();
    if (!raw) return null;

    const rosterMatch = findRosterOpponent(raw);
    if (rosterMatch) {
        const inferredApiType = normalizeApiType(rosterMatch.type);
        const apiType = httpApiMode === 'auto' ? inferredApiType : httpApiMode;
        return {
            name: rosterMatch.name,
            url: rosterMatch.url,
            apiType,
            legacyHint: inferredApiType === 'legacy'
        };
    }

    if (!isHttpUrl(raw)) {
        const knownNames = DEFAULT_OPPONENT_ROSTER.map(bot => bot.name).join(', ');
        throw new Error(`Unknown opponent "${raw}". Use a URL or one of: ${knownNames}`);
    }

    return {
        name: raw,
        url: raw,
        apiType: httpApiMode,
        legacyHint: looksLegacyHttpUrl(raw, legacyPorts)
    };
}

function parseDepthList(value, fallback) {
    const source = value !== undefined ? value : fallback;
    let parsed = [];

    if (Array.isArray(source)) {
        parsed = source;
    } else if (typeof source === 'string') {
        parsed = source.split(',');
    } else if (Number.isFinite(source)) {
        parsed = [source];
    }

    const normalized = parsed
        .map(v => Number(v))
        .filter(Number.isFinite)
        .map(v => Math.max(1, Math.floor(v)));

    const unique = [];
    for (const depth of normalized) {
        if (!unique.includes(depth)) unique.push(depth);
    }
    return unique;
}

function chromoKey(chromo) {
    return chromo
        .map((v, i) => {
            if (GENES[i].isInt) return String(Math.round(v));
            return Number(v).toFixed(6);
        })
        .join('|');
}

function createVerificationState(settings) {
    return {
        enabled: !!settings.enabled,
        depths: settings.depths,
        maxAttempts: settings.maxAttempts,
        scenarios: settings.scenarios || [],
        cache: new Map(),
        checked: 0,
        rejected: 0,
        cacheHits: 0
    };
}

function verifyChromosome(chromo, verifyState) {
    if (!verifyState || !verifyState.enabled) return true;

    const key = chromoKey(chromo);
    if (verifyState.cache.has(key)) {
        verifyState.cacheHits++;
        return verifyState.cache.get(key);
    }

    writeConfig(chromo);
    const result = runRegressionSuite({
        scenarios: verifyState.scenarios,
        depths: verifyState.depths,
        quiet: true,
        printHeader: false,
        printSummary: false,
        logPerScenario: false
    });

    const ok = !result.error && result.failed === 0;
    verifyState.cache.set(key, ok);
    verifyState.checked++;
    if (!ok) verifyState.rejected++;
    return ok;
}

function ensureVerifiedCandidate(initialChromo, candidateFactory, verifyState, contextLabel) {
    if (!verifyState || !verifyState.enabled) return [...initialChromo];

    let candidate = [...initialChromo];
    for (let attempt = 1; attempt <= verifyState.maxAttempts; attempt++) {
        if (verifyChromosome(candidate, verifyState)) return candidate;
        candidate = candidateFactory();
    }

    throw new Error(
        `Candidate verification exceeded ${verifyState.maxAttempts} retries (${contextLabel}).`
    );
}

function pickSpaced(entries, count) {
    if (count <= 0 || entries.length === 0) return [];
    if (entries.length <= count) return entries.slice();

    const out = [];
    const step = (entries.length - 1) / (count - 1);
    for (let i = 0; i < count; i++) {
        out.push(entries[Math.round(i * step)]);
    }
    return out;
}

function buildSelfPlayOpponents(champions, hallOfFame, settings) {
    if (!settings.enabled || champions.length === 0) return [];

    const byGen = new Map();
    const recent = champions.slice(-settings.recentCount);
    for (const ch of recent) byGen.set(ch.gen, ch);

    const spaced = pickSpaced(hallOfFame, settings.hofCount);
    for (const ch of spaced) byGen.set(ch.gen, ch);

    let selected = Array.from(byGen.values()).sort((a, b) => a.gen - b.gen);
    if (selected.length > settings.maxPool) {
        selected = selected.slice(selected.length - settings.maxPool);
    }

    return selected.map(ch => ({
        name: `Self-Gen${ch.gen}`,
        kind: 'self',
        move: makeConfigAiBot(ch.chromo)
    }));
}

function buildMatchups(baseOpponents, selfOpponents, selfGames) {
    const matchups = [];

    for (const opp of baseOpponents) {
        const games = Math.max(0, Math.floor(opp.games || 0));
        for (let i = 0; i < games; i++) matchups.push(opp);
    }

    if (selfOpponents.length > 0) {
        const n = Math.max(0, Math.floor(selfGames));
        for (let i = 0; i < n; i++) {
            matchups.push(selfOpponents[i % selfOpponents.length]);
        }
    }

    return matchups;
}

function buildQuickBaseOpponents(baseOpponents, quickGames, quickHttpGames) {
    return baseOpponents.map(opp => {
        const quick = opp.kind === 'http'
            ? Math.min(opp.games, quickHttpGames)
            : Math.min(opp.games, quickGames);
        return { ...opp, games: Math.max(0, Math.floor(quick)) };
    });
}

function summarizeMatchups(matchups) {
    const out = { total: matchups.length, http: 0, self: 0, builtin: 0, other: 0 };
    for (const m of matchups) {
        if (m.kind === 'http') out.http++;
        else if (m.kind === 'self') out.self++;
        else if (m.kind === 'builtin') out.builtin++;
        else out.other++;
    }
    return out;
}

function formatMatchupSummary(summary) {
    const base = `total=${summary.total} [http=${summary.http}, self=${summary.self}, builtin=${summary.builtin}`;
    return summary.other > 0 ? `${base}, other=${summary.other}]` : `${base}]`;
}

function makeStatsCounter() {
    return { games: 0, wins: 0, draws: 0, losses: 0 };
}

function updateStatsCounter(counter, winner) {
    counter.games++;
    if (winner === 0) counter.wins++;
    else if (winner === -1) counter.draws++;
    else counter.losses++;
}

function formatWdl(counter) {
    return `${counter.wins}/${counter.draws}/${counter.losses}`;
}

function formatKindBreakdown(byKind) {
    const ordered = ['http', 'self', 'builtin', 'other'];
    const shown = new Set();
    const parts = [];

    for (const kind of ordered) {
        const counter = byKind[kind];
        if (!counter || counter.games <= 0) continue;
        parts.push(`${kind} ${formatWdl(counter)}`);
        shown.add(kind);
    }

    for (const kind of Object.keys(byKind)) {
        if (shown.has(kind)) continue;
        const counter = byKind[kind];
        if (!counter || counter.games <= 0) continue;
        parts.push(`${kind} ${formatWdl(counter)}`);
    }

    return parts.length ? parts.join(' | ') : 'n/a';
}

//  GENETIC OPERATORS

/** Uniform crossover. */
function crossover(a, b) {
    return a.map((_, i) => Math.random() < 0.5 ? a[i] : b[i]);
}

/** Gaussian-ish mutation within gene bounds. */
function mutate(chromo, rate, strength) {
    return chromo.map((v, i) => {
        if (Math.random() >= rate) return v;
        const range = GENES[i].max - GENES[i].min;
        let nv = v + (Math.random() * 2 - 1) * strength * range;
        nv = clamp(nv, GENES[i].min, GENES[i].max);
        return GENES[i].isInt ? Math.round(nv) : nv;
    });
}

/** Tournament selection: pick k random individuals, return the fittest. */
function tournamentSelect(pop, fits, k) {
    let bestIdx = Math.floor(Math.random() * pop.length);
    for (let i = 1; i < k; i++) {
        const idx = Math.floor(Math.random() * pop.length);
        if (fits[idx] > fits[bestIdx]) bestIdx = idx;
    }
    return pop[bestIdx];
}

//  FITNESS EVALUATION

/**
 * Evaluate one chromosome across a precomputed matchup list.
 * Uses deterministic seeds so that every individual in the same
 * generation faces identical board layouts.
 */
async function evaluate(chromo, matchups, BW, BH, maxT, seeds, onMatchDone) {
    let wins = 0, draws = 0, losses = 0;
    let totalTurns = 0, totalLen = 0;
    let seedIdx = 0;
    const traineeSelfBot = makeConfigAiBot(chromo);
    const byKind = {};
    const byOpponent = {};

    for (let i = 0; i < matchups.length; i++) {
        const matchup = matchups[i];
        const arena = new Arena(BW, BH, seeds[seedIdx++]);
        let result;

        if (matchup.kind === 'self') {
            result = await arena.play(traineeSelfBot, matchup.move, maxT);
        } else {
            writeConfig(chromo);
            result = await arena.play(aiPlayer, matchup.move, maxT);
        }

        if      (result.winner === 0)  wins++;
        else if (result.winner === -1) draws++;
        else                           losses++;

        const kindKey = matchup.kind || 'other';
        const oppKey = `${kindKey}:${matchup.name || 'unknown'}`;
        if (!byKind[kindKey]) byKind[kindKey] = makeStatsCounter();
        if (!byOpponent[oppKey]) byOpponent[oppKey] = makeStatsCounter();
        updateStatsCounter(byKind[kindKey], result.winner);
        updateStatsCounter(byOpponent[oppKey], result.winner);

        totalTurns += result.turns;
        totalLen   += result.len[0];

        if (onMatchDone) {
            onMatchDone({
                index: i + 1,
                total: matchups.length,
                matchup,
                result,
                wins,
                draws,
                losses
            });
        }
    }

    const n = Math.max(1, matchups.length);

    // Primary: win rate.  Secondary: survival.  Tertiary: length.
    const score =
        (wins * 3 + draws) / n * 100 +
        (totalTurns / (maxT * n)) * 10 +
        (totalLen / n) * 0.5;

    return {
        score,
        wins,
        draws,
        losses,
        avgT: totalTurns / n,
        avgL: totalLen / n,
        breakdown: {
            byKind,
            byOpponent
        }
    };
}

//  DISPLAY HELPERS

function printChromo(c) {
    for (let i = 0; i < GENES.length; i++) {
        const v = GENES[i].isInt ? Math.round(c[i]) : Math.round(c[i] * 100) / 100;
        console.log(`    ${GENES[i].name.padEnd(25)} ${v}`);
    }
}

function configBlock(c) {
    const v = {};
    for (let i = 0; i < GENES.length; i++) {
        v[GENES[i].name] = GENES[i].isInt ? Math.round(c[i]) : Math.round(c[i] * 1000) / 1000;
    }
    return `    const Config = {
        DIRS: DIRS,
        MAX_DEPTH: 8,

        SCORES: {
            WIN:  1000000000,
            LOSS: -1000000000,
            DRAW: -100000000,

            TRAP_DANGER:       ${v.TRAP_DANGER},
            STRATEGIC_SQUEEZE: ${v.STRATEGIC_SQUEEZE},
            ENEMY_TRAPPED:     ${v.ENEMY_TRAPPED},

            HEAD_ON_COLLISION: ${v.HEAD_ON_COLLISION},
            TIGHT_SPOT:        ${v.TIGHT_SPOT},

            LENGTH:            ${v.LENGTH},
            EAT_REWARD:        ${v.EAT_REWARD},

            TERRITORY_CONTROL: ${v.TERRITORY_CONTROL},
            KILL_PRESSURE:     ${v.KILL_PRESSURE},

            FOOD: {
                INTENSITY: ${v.FOOD_INTENSITY},
                THRESHOLD: ${v.FOOD_THRESHOLD},
                EXPONENT:  ${v.FOOD_EXPONENT},
            },

            AGGRESSION: ${v.AGGRESSION},
        },
    };`;
}

//  MAIN TRAINING LOOP

async function train(opts) {
    const LIST_OPPONENTS = !!withDefault(opts.listOpponents, 0);
    if (LIST_OPPONENTS) {
        console.log(formatOpponentRoster());
        return;
    }

    fs.mkdirSync(DATA_DIR, { recursive: true });

    const GA = Config.GA || {};
    const POP    = Math.max(2, Math.floor(withDefault(opts.pop, 30)));
    const GENS   = Math.max(1, Math.floor(withDefault(opts.gens, 25)));
    const ELITE  = Math.max(1, Math.floor(withDefault(opts.elite, 4)));
    const GPO    = Math.max(1, Math.floor(withDefault(opts.games, 5)));
    const MR     = withDefault(opts.mutRate, 0.25);
    const MS     = withDefault(opts.mutStr, 0.15);
    const TK     = Math.max(2, Math.floor(withDefault(opts.tourney, 3)));
    const BW     = Math.max(3, Math.floor(withDefault(opts.width, 16)));
    const BH     = Math.max(3, Math.floor(withDefault(opts.height, 9)));
    const MT     = Math.max(20, Math.floor(withDefault(opts.maxTurns, 500)));
    const DEPTH  = Math.max(1, Math.floor(withDefault(opts.depth, 6)));
    const SAVE   = opts.save !== undefined ? opts.save : DEFAULT_SAVE_FILE;
    const RESUME_FILE = opts.resume;
    const CHECKPOINT_FILE = opts.checkpoint || DEFAULT_CHECKPOINT_FILE;

    const H_TARGETS = opts.opponents || [];
    const ONLY_HTTP = !!withDefault(opts.onlyHttp, 0);
    const FORCE_LEGACY_HTTP = !!withDefault(opts.legacyHttp, 0);
    const LEGACY_HTTP_PORTS = Array.isArray(GA.HTTP_LEGACY_PORTS)
        ? GA.HTTP_LEGACY_PORTS.map(n => Number(n)).filter(Number.isFinite)
        : [7000, 8000];
    const HTTP_API_MODE = FORCE_LEGACY_HTTP
        ? 'legacy'
        : parseHttpApiMode(withDefault(opts.httpApi, withDefault(GA.HTTP_API, 'auto')));

    const rawHttpGames = Math.floor(withDefault(opts.httpGames, withDefault(GA.HTTP_GAMES, 0)));
    const HTTP_GPO = rawHttpGames > 0 ? rawHttpGames : GPO;

    const selfSettings = {
        enabled:      !!withDefault(opts.selfPlay, withDefault(GA.SELF_PLAY_ENABLED, true)),
        snapshotEvery: Math.max(1, Math.floor(withDefault(opts.selfEvery, withDefault(GA.SELF_PLAY_SNAPSHOT_INTERVAL, 5)))),
        recentCount:  Math.max(0, Math.floor(withDefault(opts.selfRecent, withDefault(GA.SELF_PLAY_RECENT_COUNT, 5)))),
        hofCount:     Math.max(0, Math.floor(withDefault(opts.selfHof, withDefault(GA.SELF_PLAY_HOF_COUNT, 4)))),
        maxPool:      Math.max(0, Math.floor(withDefault(opts.selfMaxPool, withDefault(GA.SELF_PLAY_MAX_POOL, 8))))
    };
    const SELF_GAMES = Math.max(0, Math.floor(withDefault(opts.selfGames, withDefault(GA.SELF_PLAY_GAMES, 4))));

    const STAGED = !!withDefault(opts.stagedEval, withDefault(GA.STAGED_EVAL_ENABLED, true));
    const QUICK_GAMES = Math.max(0, Math.floor(withDefault(opts.quickGames, withDefault(GA.STAGED_QUICK_GAMES, Math.min(4, GPO)))));
    const QUICK_HTTP_GAMES = Math.max(0, Math.floor(withDefault(opts.quickHttpGames, withDefault(GA.STAGED_QUICK_HTTP_GAMES, Math.min(2, HTTP_GPO)))));
    const QUICK_SELF_GAMES = Math.max(0, Math.floor(withDefault(opts.quickSelfGames, withDefault(GA.STAGED_QUICK_SELF_GAMES, Math.min(2, SELF_GAMES)))));
    const QUICK_TURN_RATIO = clamp(withDefault(opts.quickTurnRatio, withDefault(GA.STAGED_QUICK_MAX_TURNS_RATIO, 0.55)), 0.10, 1.00);
    const REFINE_TOP_FRAC = clamp(withDefault(opts.refineTopFrac, withDefault(GA.STAGED_REFINE_TOP_FRACTION, 0.35)), 0.05, 1.00);
    const VALIDATION_GAMES = Math.max(1, Math.floor(withDefault(opts.validationGames, withDefault(GA.VALIDATION_GAMES, 10))));
    const PROGRESS_LEVEL = clampInt(
        Math.floor(withDefault(opts.progress, withDefault(GA.PROGRESS_LEVEL, 1))),
        0,
        2
    );
    const PROGRESS_MATCH_EVERY = Math.max(
        1,
        Math.floor(withDefault(opts.progressEvery, withDefault(GA.PROGRESS_MATCH_EVERY, 1)))
    );
    const VERIFY_ENABLED = !!withDefault(opts.verify, withDefault(GA.VERIFY_CANDIDATES, true));
    const VERIFY_DEPTHS = parseDepthList(
        opts.verifyDepths,
        withDefault(GA.VERIFY_DEPTHS, [1, 2, 3, 4])
    );
    const VERIFY_MAX_ATTEMPTS = Math.max(
        1,
        Math.floor(withDefault(opts.verifyMaxAttempts, withDefault(GA.VERIFY_MAX_ATTEMPTS, 200)))
    );

    let verificationScenarios = [];
    if (VERIFY_ENABLED) {
        if (!VERIFY_DEPTHS.length) {
            throw new Error('Candidate verification enabled but no valid verify depths were provided.');
        }
        const loaded = loadScenarios();
        if (loaded.error) {
            throw new Error(`Candidate verification could not load scenarios: ${loaded.error.message}`);
        }
        verificationScenarios = loaded.scenarios;
        if (!verificationScenarios.length) {
            throw new Error('Candidate verification requires at least one scenario in public/scenarios.');
        }
    }

    const baseOpponents = [];
    if (!ONLY_HTTP) {
        baseOpponents.push(
            { name: 'Greedy', kind: 'builtin', move: greedyBot, games: GPO },
            { name: 'Aggressive', kind: 'builtin', move: aggressiveBot, games: GPO }
        );
    }
    for (const target of H_TARGETS) {
        const resolved = resolveOpponentTarget(target, {
            httpApiMode: HTTP_API_MODE,
            legacyPorts: LEGACY_HTTP_PORTS
        });
        if (!resolved) continue;
        const apiLabel = resolved.apiType === 'auto'
            ? (resolved.legacyHint ? ' (auto)' : '')
            : ` (${resolved.apiType})`;
        baseOpponents.push({
            name: `${resolved.name}${apiLabel}`,
            kind: 'http',
            move: httpBot(resolved.url, { apiType: resolved.apiType, legacyHint: resolved.legacyHint }),
            games: HTTP_GPO
        });
    }
    if (!baseOpponents.length) {
        throw new Error('No opponents configured. Use --opponent=<url|name> or disable --onlyHttp.');
    }

    const oppNames = baseOpponents.map(o => `${o.name} x${o.games}`);

    const bar = '═'.repeat(62);
    console.log('\n' + bar);
    console.log('  🧬  GENETIC ALGORITHM — Snake AI Parameter Tuner');
    console.log(bar);
    console.log(`  Population  : ${POP}       Generations : ${GENS}      Elitism : ${ELITE}`);
    console.log(`  Base games  : nonHTTP=${GPO}  HTTP=${HTTP_GPO}  self=${SELF_GAMES}`);
    console.log(`  Board       : ${BW}×${BH}      Max turns : ${MT}      Depth: ${DEPTH}`);
    console.log(`  Mutation    : rate=${MR}  str=${MS}     Tournament: ${TK}`);
    console.log(`  HTTP API    : mode=${HTTP_API_MODE}  legacyPorts=${LEGACY_HTTP_PORTS.join(',')}`);
    console.log(`  Opponents   : ${oppNames.join(', ')}`);
    console.log(`  Self-play   : ${selfSettings.enabled ? `on (recent=${selfSettings.recentCount}, hof=${selfSettings.hofCount}, every=${selfSettings.snapshotEvery})` : 'off'}`);
    console.log(`  Staged eval : ${STAGED ? `on (quick=${QUICK_GAMES}/${QUICK_HTTP_GAMES}/${QUICK_SELF_GAMES}, ratio=${QUICK_TURN_RATIO}, top=${REFINE_TOP_FRAC})` : 'off'}`);
    console.log(
        `  Verify gate : ${VERIFY_ENABLED ? `on (depths=${VERIFY_DEPTHS.join(',')}, scenarios=${verificationScenarios.length}, maxRetries=${VERIFY_MAX_ATTEMPTS})` : 'off'}`
    );
    console.log(`  Progress    : level=${PROGRESS_LEVEL}${PROGRESS_LEVEL >= 2 ? ` (match every ${PROGRESS_MATCH_EVERY})` : ''}`);
    if (RESUME_FILE) {
        console.log(`  Resume      : Loading from ${RESUME_FILE}`);
    }
    console.log(`  Checkpoint  : Saving to ${CHECKPOINT_FILE}`);
    console.log(bar + '\n');

    const origDepth = Config.MAX_DEPTH;
    Config.MAX_DEPTH = DEPTH;

    try {
        let pop = [];
        let bestEver  = null;
        let bestScore = -Infinity;
        let bestStats = null;
        let history = [];
        let champions = [];
        let hallOfFame = [];
        let startGen = 0;
        const verifyState = createVerificationState({
            enabled: VERIFY_ENABLED,
            depths: VERIFY_DEPTHS,
            maxAttempts: VERIFY_MAX_ATTEMPTS,
            scenarios: verificationScenarios
        });

        if (RESUME_FILE) {
            try {
                const data = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8'));
                if (data.pop && Array.isArray(data.pop)) {
                    pop = data.pop;
                    bestEver = data.bestEver || null;
                    bestScore = data.bestScore !== undefined ? data.bestScore : -Infinity;
                    bestStats = data.bestStats || null;
                    history = data.history || [];
                    champions = data.champions || [];
                    hallOfFame = data.hallOfFame || [];
                    startGen = data.gen || 0;
                    console.log(`  ✅ Successfully loaded checkpoint. Resuming at Gen ${startGen + 1}...`);
                } else {
                    throw new Error('Invalid checkpoint format: missing population.');
                }
            } catch (e) {
                console.error(`  ❌ Failed to load resume file: ${e.message}`);
                process.exit(1);
            }
        } else {
            pop = [readConfig()];
            while (pop.length < POP) pop.push(randomChromo());
        }

        // Ensure population size matches config even after resume
        while (pop.length < POP) pop.push(randomChromo());
        if (pop.length > POP) pop = pop.slice(0, POP);
        if (verifyState.enabled) {
            const verified = [];
            for (let i = 0; i < pop.length; i++) {
                const seed = pop[i];
                const candidate = ensureVerifiedCandidate(
                    seed,
                    randomChromo,
                    verifyState,
                    `initial population slot ${i + 1}`
                );
                verified.push(candidate);
            }
            pop = verified;
            console.log(
                `  Verify init : checked=${verifyState.checked} rejected=${verifyState.rejected} cacheHits=${verifyState.cacheHits}`
            );
        }

        for (let gen = startGen; gen < GENS; gen++) {
            const t0 = Date.now();
            const verifyBefore = verifyState.enabled ? {
                checked: verifyState.checked,
                rejected: verifyState.rejected,
                cacheHits: verifyState.cacheHits
            } : null;
            const selfOpponents = buildSelfPlayOpponents(champions, hallOfFame, selfSettings);
            const fullMatchups = buildMatchups(baseOpponents, selfOpponents, SELF_GAMES);
            if (!fullMatchups.length) {
                throw new Error('Generated empty matchup set. Increase --games or --selfGames.');
            }

            const quickBase = buildQuickBaseOpponents(baseOpponents, QUICK_GAMES, QUICK_HTTP_GAMES);
            let quickMatchups = buildMatchups(quickBase, selfOpponents, QUICK_SELF_GAMES);
            if (!quickMatchups.length) quickMatchups = fullMatchups;
            const quickSummary = summarizeMatchups(quickMatchups);
            const fullSummary = summarizeMatchups(fullMatchups);

            const useStaged = STAGED &&
                (quickMatchups.length < fullMatchups.length || QUICK_TURN_RATIO < 0.999 || REFINE_TOP_FRAC < 0.999);
            const quickTurns = Math.max(50, Math.floor(MT * QUICK_TURN_RATIO));

            if (PROGRESS_LEVEL >= 1) {
                console.log(
                    `  Gen ${gen + 1}/${GENS} setup: quick ${formatMatchupSummary(quickSummary)} ` +
                    `at maxTurns=${quickTurns}; full ${formatMatchupSummary(fullSummary)} at maxTurns=${MT}`
                );
            }

            const quickSeeds = Array.from({ length: quickMatchups.length }, () =>
                1 + Math.floor(Math.random() * 999999)
            );
            const fullSeeds = Array.from({ length: fullMatchups.length }, () =>
                1 + Math.floor(Math.random() * 999999)
            );

            const results = new Array(POP);
            const scores = new Array(POP).fill(-Infinity);
            const fullEvaluated = new Set();

            if (useStaged) {
                for (let i = 0; i < POP; i++) {
                    const prefix =
                        `  Gen ${String(gen + 1).padStart(3)}/${GENS} ` +
                        `quick ${String(i + 1).padStart(3)}/${POP}`;
                    if (PROGRESS_LEVEL >= 2) {
                        console.log(
                            `${prefix} start ${formatMatchupSummary(quickSummary)}`
                        );
                    } else {
                        process.stdout.write(
                            `\r${prefix} ${formatMatchupSummary(quickSummary)} …`
                        );
                    }

                    const res = await evaluate(
                        pop[i],
                        quickMatchups,
                        BW,
                        BH,
                        quickTurns,
                        quickSeeds,
                        PROGRESS_LEVEL >= 2 ? (info) => {
                            if (info.index % PROGRESS_MATCH_EVERY !== 0 && info.index !== info.total) return;
                            console.log(
                                `${prefix} game ${String(info.index).padStart(2)}/${info.total} ` +
                                `${info.matchup.kind}:${info.matchup.name} turns=${info.result.turns} ` +
                                `W/D/L=${info.wins}/${info.draws}/${info.losses}`
                            );
                        } : null
                    );
                    results[i] = res;
                    scores[i] = res.score;
                    if (PROGRESS_LEVEL >= 1) {
                        console.log(
                            `${prefix} done W/D/L=${res.wins}/${res.draws}/${res.losses} ` +
                            `avgT=${res.avgT.toFixed(0)} avgL=${res.avgL.toFixed(1)} score=${res.score.toFixed(1)}`
                        );
                    }
                }

                const refineCount = clampInt(Math.ceil(POP * REFINE_TOP_FRAC), Math.max(ELITE, 1), POP);
                const order = Array.from({ length: POP }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
                const refineIndices = order.slice(0, refineCount);

                for (let i = 0; i < refineIndices.length; i++) {
                    const idx = refineIndices[i];
                    const prefix =
                        `  Gen ${String(gen + 1).padStart(3)}/${GENS} ` +
                        `full ${String(i + 1).padStart(3)}/${refineIndices.length} idx=${String(idx + 1).padStart(2)}`;

                    if (PROGRESS_LEVEL >= 1) {
                        console.log(`${prefix} start ${formatMatchupSummary(fullSummary)}`);
                    } else {
                        process.stdout.write(`\r${prefix} …`);
                    }

                    const res = await evaluate(
                        pop[idx],
                        fullMatchups,
                        BW,
                        BH,
                        MT,
                        fullSeeds,
                        PROGRESS_LEVEL >= 2 ? (info) => {
                            if (info.index % PROGRESS_MATCH_EVERY !== 0 && info.index !== info.total) return;
                            console.log(
                                `${prefix} game ${String(info.index).padStart(2)}/${info.total} ` +
                                `${info.matchup.kind}:${info.matchup.name} turns=${info.result.turns} ` +
                                `W/D/L=${info.wins}/${info.draws}/${info.losses}`
                            );
                        } : null
                    );
                    results[idx] = res;
                    scores[idx] = res.score;
                    fullEvaluated.add(idx);
                    if (PROGRESS_LEVEL >= 1) {
                        console.log(
                            `${prefix} done W/D/L=${res.wins}/${res.draws}/${res.losses} ` +
                            `avgT=${res.avgT.toFixed(0)} avgL=${res.avgL.toFixed(1)} score=${res.score.toFixed(1)}`
                        );
                    }

                    if (res.score > bestScore) {
                        bestScore = res.score;
                        bestEver  = [...pop[idx]];
                        bestStats = { ...res };
                    }
                }
            } else {
                for (let i = 0; i < POP; i++) {
                    const prefix =
                        `  Gen ${String(gen + 1).padStart(3)}/${GENS} ` +
                        `evaluating ${String(i + 1).padStart(3)}/${POP}`;
                    if (PROGRESS_LEVEL >= 1) {
                        console.log(`${prefix} start ${formatMatchupSummary(fullSummary)}`);
                    } else {
                        process.stdout.write(`\r${prefix} …`);
                    }

                    const res = await evaluate(
                        pop[i],
                        fullMatchups,
                        BW,
                        BH,
                        MT,
                        fullSeeds,
                        PROGRESS_LEVEL >= 2 ? (info) => {
                            if (info.index % PROGRESS_MATCH_EVERY !== 0 && info.index !== info.total) return;
                            console.log(
                                `${prefix} game ${String(info.index).padStart(2)}/${info.total} ` +
                                `${info.matchup.kind}:${info.matchup.name} turns=${info.result.turns} ` +
                                `W/D/L=${info.wins}/${info.draws}/${info.losses}`
                            );
                        } : null
                    );
                    results[i] = res;
                    scores[i] = res.score;
                    fullEvaluated.add(i);
                    if (PROGRESS_LEVEL >= 1) {
                        console.log(
                            `${prefix} done W/D/L=${res.wins}/${res.draws}/${res.losses} ` +
                            `avgT=${res.avgT.toFixed(0)} avgL=${res.avgL.toFixed(1)} score=${res.score.toFixed(1)}`
                        );
                    }

                    if (res.score > bestScore) {
                        bestScore = res.score;
                        bestEver  = [...pop[i]];
                        bestStats = { ...res };
                    }
                }
            }

            const avg  = scores.reduce((a, b) => a + b, 0) / POP;
            let mx;
            let mxI;
            if (useStaged && fullEvaluated.size > 0) {
                mxI = Array.from(fullEvaluated).reduce((best, idx) =>
                    scores[idx] > scores[best] ? idx : best
                );
                mx = scores[mxI];
            } else {
                mx = Math.max(...scores);
                mxI = scores.indexOf(mx);
            }
            const secs = ((Date.now() - t0) / 1000).toFixed(1);

            let champIdx = mxI;
            if (fullEvaluated.size > 0) {
                for (const idx of fullEvaluated) {
                    if (scores[idx] > scores[champIdx]) champIdx = idx;
                }
            }

            if (!bestEver) {
                bestEver = [...pop[champIdx]];
                bestScore = scores[champIdx];
                bestStats = { ...results[champIdx] };
            }

            const champEntry = {
                gen: gen + 1,
                chromo: [...pop[champIdx]],
                score: scores[champIdx]
            };
            champions.push(champEntry);
            if ((gen + 1) % selfSettings.snapshotEvery === 0) {
                hallOfFame.push(champEntry);
            }

            console.log(
                `\r  Gen ${String(gen + 1).padStart(3)}/${GENS}` +
                `  best ${mx.toFixed(1).padStart(8)}` +
                `  avg ${avg.toFixed(1).padStart(8)}` +
                `  W/D/L ${results[mxI].wins}/${results[mxI].draws}/${results[mxI].losses}` +
                `  best-ever ${bestScore.toFixed(1)}` +
                `  (${secs}s)` +
                `  [matches q/f ${quickMatchups.length}/${fullMatchups.length}]`
            );
            if (results[mxI] && results[mxI].breakdown) {
                console.log(`               split ${formatKindBreakdown(results[mxI].breakdown.byKind)}`);
            }

            // Save best individual info
            const bestInfo = {
                bestChromosome: {},
                fitness: bestScore,
                gen: gen + 1
            };
            for (let i = 0; i < GENES.length; i++) {
                bestInfo.bestChromosome[GENES[i].name] =
                    GENES[i].isInt ? Math.round(bestEver[i]) : bestEver[i];
            }
            fs.writeFileSync(DEFAULT_BEST_FILE, JSON.stringify(bestInfo, null, 2));

            history.push({
                gen: gen + 1,
                best: mx,
                avg,
                bestEver: bestScore,
                staged: useStaged,
                quickMatchups: quickMatchups.length,
                fullMatchups: fullMatchups.length,
                selfPoolSize: selfOpponents.length
            });

            const sorted = pop
                .map((c, i) => ({ c, s: scores[i] }))
                .sort((a, b) => b.s - a.s);

            const next = [];
            for (let i = 0; i < ELITE && i < sorted.length; i++) {
                const elite = [...sorted[i].c];
                next.push(
                    ensureVerifiedCandidate(
                        elite,
                        randomChromo,
                        verifyState,
                        `gen ${gen + 1} elite slot ${i + 1}`
                    )
                );
            }
            while (next.length < POP) {
                const makeChild = () => {
                    const p1 = tournamentSelect(pop, scores, TK);
                    const p2 = tournamentSelect(pop, scores, TK);
                    return mutate(crossover(p1, p2), MR, MS);
                };
                const child = makeChild();
                next.push(
                    ensureVerifiedCandidate(
                        child,
                        makeChild,
                        verifyState,
                        `gen ${gen + 1} child slot ${next.length + 1}`
                    )
                );
            }
            pop = next;
            if (verifyState.enabled && verifyBefore) {
                console.log(
                    `               verify checked=${verifyState.checked - verifyBefore.checked} ` +
                    `rejected=${verifyState.rejected - verifyBefore.rejected} ` +
                    `cacheHits=${verifyState.cacheHits - verifyBefore.cacheHits}`
                );
            }

            // Full State Checkpoint (Atomic Save)
            const checkpointData = {
                gen: gen + 1, // Save index for next generation
                pop: pop,
                bestEver: bestEver,
                bestScore: bestScore,
                bestStats: bestStats,
                history: history,
                champions: champions,
                hallOfFame: hallOfFame
            };
            try {
                const tmpPath = `${CHECKPOINT_FILE}.tmp`;
                fs.writeFileSync(tmpPath, JSON.stringify(checkpointData));
                fs.renameSync(tmpPath, CHECKPOINT_FILE);
            } catch (err) {
                console.error(`  ⚠️ Warning: Could not save checkpoint: ${err.message}`);
            }
        }

        const finalSelfOpponents = buildSelfPlayOpponents(champions, hallOfFame, selfSettings);
        const validationBase = baseOpponents.map(opp => ({ ...opp, games: VALIDATION_GAMES }));
        const validationSelfGames = Math.min(SELF_GAMES, VALIDATION_GAMES);
        const validationMatchups = buildMatchups(validationBase, finalSelfOpponents, validationSelfGames);

        console.log(`\n  Running final validation (${validationMatchups.length} games total) …`);
        const valSeeds = Array.from({ length: validationMatchups.length }, () =>
            1 + Math.floor(Math.random() * 999999)
        );
        const valResult = await evaluate(bestEver, validationMatchups, BW, BH, MT, valSeeds);
        console.log(
            `  Validation: W/D/L ${valResult.wins}/${valResult.draws}/${valResult.losses}` +
            `  fitness=${valResult.score.toFixed(2)}  avgLen=${valResult.avgL.toFixed(1)}  avgTurns=${valResult.avgT.toFixed(0)}`
        );
        if (valResult.breakdown) {
            console.log(`  Validation split: ${formatKindBreakdown(valResult.breakdown.byKind)}`);
        }

        console.log('\n' + bar);
        console.log('  🏆  TRAINING COMPLETE');
        console.log(bar);
        console.log(`  Best training fitness : ${bestScore.toFixed(2)}`);
        console.log(`  Training W/D/L       : ${bestStats.wins} / ${bestStats.draws} / ${bestStats.losses}`);
        if (bestStats.breakdown) {
            console.log(`  Training split       : ${formatKindBreakdown(bestStats.breakdown.byKind)}`);
        }
        console.log(`  Avg length           : ${bestStats.avgL.toFixed(1)}    Avg turns : ${bestStats.avgT.toFixed(0)}`);
        console.log('\n  Optimised values:\n');
        printChromo(bestEver);
        console.log('\n  ── Copy-paste into config.js ──\n');
        console.log(configBlock(bestEver));

        if (SAVE) {
            const output = {
                bestChromosome: {},
                bestFitness: bestScore,
                bestStats,
                validation: valResult,
                history,
                settings: {
                    POP, GENS, ELITE, GPO, HTTP_GPO, SELF_GAMES,
                    MR, MS, TK, BW, BH, MT, DEPTH,
                    httpApiMode: HTTP_API_MODE,
                    legacyHttp: FORCE_LEGACY_HTTP,
                    legacyHttpPorts: LEGACY_HTTP_PORTS,
                    stagedEval: {
                        enabled: STAGED,
                        quickGames: QUICK_GAMES,
                        quickHttpGames: QUICK_HTTP_GAMES,
                        quickSelfGames: QUICK_SELF_GAMES,
                        quickTurnRatio: QUICK_TURN_RATIO,
                        refineTopFrac: REFINE_TOP_FRAC
                    },
                    progress: {
                        level: PROGRESS_LEVEL,
                        every: PROGRESS_MATCH_EVERY
                    },
                    verification: {
                        enabled: VERIFY_ENABLED,
                        depths: VERIFY_DEPTHS,
                        maxAttempts: VERIFY_MAX_ATTEMPTS,
                        scenarios: verificationScenarios.length
                    },
                    selfPlay: selfSettings,
                    opponents: oppNames
                }
            };
            for (let i = 0; i < GENES.length; i++) {
                output.bestChromosome[GENES[i].name] =
                    GENES[i].isInt ? Math.round(bestEver[i]) : Math.round(bestEver[i] * 100) / 100;
            }
            fs.writeFileSync(SAVE, JSON.stringify(output, null, 2));
            console.log(`\n  Results saved → ${SAVE}\n`);
        }
    } finally {
        Config.MAX_DEPTH = origDepth;
    }
}

//  CLI ARGUMENT PARSING

const cliOpts = {};
const httpOpponents = [];
const cliArgs = process.argv.slice(2);

for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--list-opponents' || arg === '--listOpponents' || arg === '-L') {
        cliOpts.listOpponents = 1;
        continue;
    }

    const listOppEq = arg.match(/^--list-opponents=(.+)$/);
    if (listOppEq) {
        const rawValue = String(listOppEq[1]).trim().toLowerCase();
        cliOpts.listOpponents = ['0', 'false', 'no', 'off'].includes(rawValue) ? 0 : 1;
        continue;
    }

    if (arg === '--opponent' || arg === '-o') {
        const next = cliArgs[i + 1];
        if (next && !next.startsWith('-')) {
            httpOpponents.push(next);
            i++;
        }
        continue;
    }

    const opponentEq = arg.match(/^--?opponent=(.+)$/);
    if (opponentEq) {
        httpOpponents.push(opponentEq[1]);
        continue;
    }

    const m = arg.match(/^--?(\w+)=(.+)$/);
    if (!m) continue;
    cliOpts[m[1]] = isNaN(+m[2]) ? m[2] : +m[2];
}
cliOpts.opponents = httpOpponents;

train(cliOpts).catch(err => {
    console.error('\n  FATAL:', err);
    process.exit(1);
});
