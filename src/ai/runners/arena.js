const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getSmartMoveDebug } = require('../brain');
const {
    STANDARD_FOOD_SETTINGS,
    placeInitialStandardFood,
    applyStandardFoodSpawning
} = require('../standard_food');
const { buildMovePayload } = require('./http_api');
const { DEFAULT_OPPONENT_ROSTER, findRosterOpponent, formatOpponentRoster } = require('./opponent_roster');

// --- CONFIGURATION & ARGS ---
const args = process.argv.slice(2);

function hasFlag(names) {
    return args.some(a => names.includes(a));
}

function parseIntOrDefault(value, defaultValue, min = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= min ? parsed : defaultValue;
}

function getArgValues(names) {
    const values = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (names.includes(arg)) {
            const next = args[i + 1];
            if (next && !next.startsWith('-')) {
                values.push(next);
                i++;
            } else {
                values.push(null);
            }
            continue;
        }

        const matchedPrefix = names.find(name => arg.startsWith(`${name}=`));
        if (matchedPrefix) {
            values.push(arg.slice(matchedPrefix.length + 1));
        }
    }
    return values;
}

function getArgValue(names) {
    const values = getArgValues(names);
    return values.find(v => v !== null) ?? null;
}

const SELF_PLAY = hasFlag(['--self', '-p']);
const RESUME_MODE = hasFlag(['--resume', '--load-snapshot', '-r']);

// MODES
const VISUAL_MODE = hasFlag(['--visual', '-v']);
const DEBUG_MODE = hasFlag(['--debug', '-d']);
const ONLY_LOSS = hasFlag(['--only-loss', '--loss-only', '-l']);
const LIST_OPPONENTS = hasFlag(['--list-opponents', '--listOpponents', '-L']);

const FIND_VALUES = getArgValues(['--find', '-f']);
const FIND_MODE_ALIASES = {
    shortest: "shortest",
    longest: "longest",
    "shortest-turns": "shortest",
    "longest-turns": "longest",
    st: "shortest",
    lt: "longest",
    "shortest-snake": "shortest-snake",
    "longest-snake": "longest-snake",
    ss: "shortest-snake",
    ls: "longest-snake"
};
const VALID_FIND_MODES = new Set(["shortest", "longest", "shortest-snake", "longest-snake"]);
const FIND_MODES_RAW = FIND_VALUES
    .filter(v => v !== null)
    .flatMap(v => String(v).split(','))
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);

const FIND_MODES = [];
const INVALID_FIND_MODES = [];
for (const raw of FIND_MODES_RAW) {
    const normalized = FIND_MODE_ALIASES[raw] || raw;
    if (VALID_FIND_MODES.has(normalized)) {
        if (!FIND_MODES.includes(normalized)) FIND_MODES.push(normalized);
    } else {
        INVALID_FIND_MODES.push(raw);
    }
}
const HAS_FIND_MODE = FIND_MODES.length > 0;

// SETTINGS
const GAMES_VALUE = getArgValue(['--games', '-g']);
const SEED_VALUE = getArgValue(['--seed', '-s']);
const OPPONENT_VALUE = getArgValue(['--opponent', '-o']);
const RESUME_FILE_VALUE = getArgValue(['--resume-file', '--snapshot-file', '-R']);
const DELAY_VALUE = getArgValue(['--delay', '-D']);
const REQUEST_TIMEOUT_VALUE = getArgValue(['--request-timeout', '--req-timeout', '-t']);
const PAYLOAD_TIMEOUT_VALUE = getArgValue(['--payload-timeout', '--move-timeout', '-T']);
const SNAPSHOT_TICKS_VALUE = getArgValue(['--snapshot-ticks', '--snapshots', '-k']);
const parsedGames = parseIntOrDefault(GAMES_VALUE, 100, 1);
const parsedSeed = Number.parseInt(SEED_VALUE, 10);
const parsedDelay = parseIntOrDefault(DELAY_VALUE, 50, 0);
const parsedRequestTimeout = parseIntOrDefault(REQUEST_TIMEOUT_VALUE, 600, 1);
const parsedPayloadTimeout = parseIntOrDefault(PAYLOAD_TIMEOUT_VALUE, 40, 1);
const parsedSnapshotTicks = parseIntOrDefault(SNAPSHOT_TICKS_VALUE, 10, 1);

const TOTAL_GAMES = (RESUME_MODE || VISUAL_MODE || DEBUG_MODE && !HAS_FIND_MODE) ? 1 : 
    parsedGames;
const SNAPSHOT_FILE_PATH = path.resolve(RESUME_FILE_VALUE || path.join(__dirname, 'arena_snapshot.json'));

const CONFIG = {
    width: 16,
    height: 9,
    delay: parsedDelay,
    requestTimeout: parsedRequestTimeout,
    payloadTimeout: parsedPayloadTimeout,
    initialFood: STANDARD_FOOD_SETTINGS.initialFood,
    minimumFood: STANDARD_FOOD_SETTINGS.minimumFood,
    foodSpawnChance: STANDARD_FOOD_SETTINGS.foodSpawnChance,
};
const SNAPSHOT_TICKS = parsedSnapshotTicks; 

// COLORS
const RESET = "\x1b[0m";
const BLUE = "\x1b[34m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";

const BOT_COLOR_BY_NAME = {
    "local-old": BLUE,
    "shapeshifter": GREEN,
    "snek-two": RED
};

const BOT_ROSTER = DEFAULT_OPPONENT_ROSTER.map(bot => ({
    ...bot,
    color: BOT_COLOR_BY_NAME[bot.name] || CYAN
}));

let PLAYER_1 = { ...BOT_ROSTER[0], name: "local", type: "local", url: null };

let PLAYER_2;
if (SELF_PLAY) {
    PLAYER_1 = { ...PLAYER_1, type: "local", url: null };
    PLAYER_2 = { ...PLAYER_1, name: `${PLAYER_1.name}-red`, url: null, type: "local" };
} else {
    const OPPONENT_NAME = OPPONENT_VALUE || "local-old";
    const resolvedOpponent = findRosterOpponent(OPPONENT_NAME, BOT_ROSTER);
    PLAYER_2 = resolvedOpponent || BOT_ROSTER[0];
}

let stats = { [PLAYER_1.name]: 0, [PLAYER_2.name]: 0, draws: 0 };

let deathStats = {
    [PLAYER_1.name]: { Starvation: 0, Wall: 0, Body: 0, Head: 0 },
    [PLAYER_2.name]: { Starvation: 0, Wall: 0, Body: 0, Head: 0 }
};

// --- RNG (MATCHING INDEX.HTML) ---
let currentSeed = Number.isFinite(parsedSeed) ? parsedSeed : Math.floor(Math.random() * 2000000000);
const INITIAL_SEED = currentSeed; // Store initial to print later if needed

function seededRandom() {
    currentSeed = (currentSeed * 1664525 + 1013904223) % 4294967296;
    return currentSeed / 4294967296;
}

// --- HELPERS ---

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
function formatDisplayPath(fullPath) {
    const relative = path.relative(process.cwd(), fullPath);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        return relative;
    }

    const normalized = String(fullPath).replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length <= 4) return fullPath;
    return `.../${parts.slice(-4).join('/')}`;
}
function normalizeMove(move) {
    if (!move) return null;
    const value = String(move).trim().toLowerCase();
    return ["up", "down", "left", "right"].includes(value) ? value : null;
}

function sanitizePointArray(points) {
    if (!Array.isArray(points)) return [];
    return points
        .map(p => ({ x: Number.parseInt(p?.x, 10), y: Number.parseInt(p?.y, 10) }))
        .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function loadSnapshotFromFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    const localBody = sanitizePointArray(parsed.a);
    const opponentBody = sanitizePointArray(parsed.p);
    const foods = sanitizePointArray(parsed.foods);

    if (localBody.length === 0 || opponentBody.length === 0) {
        throw new Error("Snapshot is missing valid snake bodies.");
    }

    const cols = Number.parseInt(parsed.cols, 10);
    const rows = Number.parseInt(parsed.rows, 10);
    if (Number.isFinite(cols) && Number.isFinite(rows)) {
        if (cols !== CONFIG.width || rows !== CONFIG.height) {
            throw new Error(`Snapshot board ${cols}x${rows} does not match arena board ${CONFIG.width}x${CONFIG.height}.`);
        }
    }

    const localHealth = parseIntOrDefault(parsed.aHealth, 100, 0);
    const opponentHealth = parseIntOrDefault(parsed.pHealth, 100, 0);
    const seed = Number.parseInt(parsed.seed, 10);
    const turn = parseIntOrDefault(parsed.turn, 0, 0);
    const opponentMoves = Array.isArray(parsed.opponentMoves)
        ? parsed.opponentMoves.map(normalizeMove).filter(Boolean)
        : [];

    return {
        seed: Number.isFinite(seed) ? seed : null,
        turn,
        opponentMoves,
        state: {
            turn,
            board: {
                width: CONFIG.width,
                height: CONFIG.height,
                food: foods,
                snakes: [
                    { id: "s1", body: localBody, health: localHealth },
                    { id: "s2", body: opponentBody, health: opponentHealth }
                ]
            }
        }
    };
}

function drawBoard(state) {
    let header = `\nTurn: ${state.turn} | ${BLUE}JS HP: ${state.board.snakes[0]?.health || 0}${RESET} | ${RED}Enemy HP: ${state.board.snakes[1]?.health || 0}${RESET}\n`;
    let rows = [];
    for (let y = state.board.height - 1; y >= 0; y--) {
        let row = "";
        for (let x = 0; x < state.board.width; x++) {
            let char = ". ";
            if (state.board.food.some(f => f.x === x && f.y === y)) char = YELLOW + "O " + RESET;
            state.board.snakes.forEach((s) => {
                s.body.forEach((p, bIdx) => {
                    if (p.x === x && p.y === y) {
                        const isHead = bIdx === 0;
                        const col = s.id === "s1" ? BLUE : RED;
                        char = col + (isHead ? "■ " : "□ ") + RESET;
                    }
                });
            });
            row += char;
        }
        rows.push(row);
    }
    console.clear();
    console.log(header + rows.join("\n"));
}

function generateDeathJSON(history, reason = "Unknown") {
    const index = Math.max(0, history.length - SNAPSHOT_TICKS);
    const snapshot = history[index];
    if (!snapshot) return;
    const subsequentMoves = history.slice(index).map(h => h.opponentMove).filter(m => m !== null);

    const s1 = snapshot.board.snakes.find(s => s.id === "s1"); // Blue (My Bot)
    const s2 = snapshot.board.snakes.find(s => s.id === "s2"); // Red (Enemy)

    const output = {
        p: s2 ? s2.body : [],
        a: s1 ? s1.body : [],
        foods: snapshot.board.food,
        pHealth: s2 ? s2.health : 0,
        aHealth: s1 ? s1.health : 0,
        cols: CONFIG.width,
        rows: CONFIG.height,
        turn: snapshot.turn || 0,
        seed: snapshot.seed,
        opponentMoves: subsequentMoves
    };

    console.log(`\n${YELLOW}=== JSON EXPORT (${reason}) ===${RESET}`);
    console.log(JSON.stringify(output, null, 2));
    console.log(`${YELLOW}====================================${RESET}\n`);

    try {
        fs.writeFileSync(SNAPSHOT_FILE_PATH, JSON.stringify(output, null, 2), 'utf8');
        console.log(`${CYAN}Snapshot saved:${RESET} ${formatDisplayPath(SNAPSHOT_FILE_PATH)}`);
        console.log(`Resume from it: bun arena --visual --resume`);
    } catch (error) {
        console.log(`${RED}Failed to save snapshot:${RESET} ${error.message}`);
    }
}

// --- BUCKETING HELPERS FOR STATS ---

const turnBins = [
    "0-100", "101-200", "201-300", "301-400", "401-500", 
    "501-600", "601-700", "701-800", "801-900", "901-1000", 
    "1000+"
];

function getTurnBin(turns) {
    if (turns <= 100)  return "0-100";
    if (turns <= 200)  return "101-200";
    if (turns <= 300)  return "201-300";
    if (turns <= 400)  return "301-400";
    if (turns <= 500)  return "401-500";
    if (turns <= 600)  return "501-600";
    if (turns <= 700)  return "601-700";
    if (turns <= 800)  return "701-800";
    if (turns <= 900)  return "801-900";
    if (turns <= 1000) return "901-1000";
    return "1000+";
}

const lengthBins = [
    "0-5", "6-10", "11-15", "16-20", "21-25", "26-30", 
    "31-35", "36-40", "41-45", "46-50", "51-55", "56-60", 
    "61-65", "66-70", "70+"
];

function getLengthBin(len) {
    if (len <= 5)  return "0-5";
    if (len <= 10) return "6-10";
    if (len <= 15) return "11-15";
    if (len <= 20) return "16-20";
    if (len <= 25) return "21-25";
    if (len <= 30) return "26-30";
    if (len <= 35) return "31-35";
    if (len <= 40) return "36-40";
    if (len <= 45) return "41-45";
    if (len <= 50) return "46-50";
    if (len <= 55) return "51-55";
    if (len <= 60) return "56-60";
    if (len <= 65) return "61-65";
    if (len <= 70) return "66-70";
    return "70+";
}


// --- GAME ENGINE ---

async function runMatch(gameSeed, resumeSnapshot = null) {
    // Reset RNG to the specific seed for this match
    currentSeed = gameSeed;

    const pad = 2;
    let history = []; 
    let finalLengths = { s1: 3, s2: 3 }; // Initialize to starting length

    let state;
    const scriptedOpponentMoves = resumeSnapshot?.opponentMoves ? [...resumeSnapshot.opponentMoves] : [];

    if (resumeSnapshot?.state) {
        state = JSON.parse(JSON.stringify(resumeSnapshot.state));
        state.board.width = CONFIG.width;
        state.board.height = CONFIG.height;
        state.board.food = sanitizePointArray(state.board.food);
        state.board.snakes = state.board.snakes.map(s => ({
            ...s,
            body: sanitizePointArray(s.body)
        }));
    } else {
        state = {
            turn: 0,
            board: {
                width: CONFIG.width, height: CONFIG.height,
                food: [],
                snakes: [
                    { id: "s1", body: [{ x: pad, y: pad }, { x: pad, y: pad-1 }, { x: pad, y: pad-2 }], health: 100 },
                    { 
                        id: "s2", 
                        body: [
                            { x: CONFIG.width - pad - 1, y: CONFIG.height - pad - 1 }, 
                            { x: CONFIG.width - pad - 1, y: CONFIG.height - pad }, 
                            { x: CONFIG.width - pad - 1, y: CONFIG.height - pad + 1 }
                        ], 
                        health: 100 
                    }
                ]
            }
        };
    }
    finalLengths.s1 = state.board.snakes.find(s => s.id === "s1")?.body?.length || finalLengths.s1;
    finalLengths.s2 = state.board.snakes.find(s => s.id === "s2")?.body?.length || finalLengths.s2;

    const randInt = (n) => Math.floor(seededRandom() * n);
    const foodSettings = {
        initialFood: CONFIG.initialFood,
        minimumFood: CONFIG.minimumFood,
        foodSpawnChance: CONFIG.foodSpawnChance,
    };

    if (!resumeSnapshot?.state) {
        placeInitialStandardFood(
            randInt,
            CONFIG.width,
            CONFIG.height,
            state.board.snakes,
            state.board.food,
            foodSettings
        );
    }

    let gameOver = false;
    let winner = null;
    let blueDied = false;

    // Timeout safety
    while (!gameOver && state.turn < 2000) {
        if (VISUAL_MODE) {
            drawBoard(state);
            await sleep(CONFIG.delay);
        }

        // Capture seed at start of turn (before food respawn)
        let turnSeed = currentSeed; 
        
        // 1. Get Moves
        let moveRequests = state.board.snakes.map(async (snake) => {
            const config = snake.id === "s1" ? PLAYER_1 : PLAYER_2;
            try {
                if (snake.id === "s2" && scriptedOpponentMoves.length > 0) {
                    const scriptedMove = normalizeMove(scriptedOpponentMoves.shift());
                    if (scriptedMove) {
                        return { id: snake.id, dir: scriptedMove };
                    }
                }

                if (config.type === 'local') {
                    const opponent = state.board.snakes.find(s => s.id !== snake.id) || snake;

                    const meLocal = {
                        id: snake.id,
                        body: snake.body.map(p => ({ x: p.x, y: p.y })),
                        health: snake.health
                    };
                    const enemyLocal = {
                        id: opponent.id,
                        body: opponent.body.map(p => ({ x: p.x, y: p.y })),
                        health: opponent.health
                    };

                    const decision = getSmartMoveDebug(meLocal, enemyLocal, state.board.food, CONFIG.width, CONFIG.height);

                    const dir = decision && decision.bestMove && decision.bestMove.name
                        ? decision.bestMove.name.toLowerCase()
                        : 'up';

                    return { id: snake.id, dir };
                } else {
                    const payload = buildMovePayload(state, snake, {
                        apiType: config.type,
                        gameId: "game-id",
                        source: "arena.js",
                        timeout: CONFIG.payloadTimeout
                    });
                    const resp = await axios.post(`${config.url}/move`, payload, { timeout: CONFIG.requestTimeout });
                    return { id: snake.id, dir: resp.data.move };
                }
            } catch (e) {
                return { id: snake.id, dir: 'up' };
            }
        });

        const moves = await Promise.all(moveRequests);

        // 2. Snapshot History
        if (DEBUG_MODE || HAS_FIND_MODE) {
            const opponentMove = moves.find(m => m.id === "s2")?.dir || "UP";
            history.push({
                board: JSON.parse(JSON.stringify(state.board)),
                seed: turnSeed,
                turn: state.turn,
                opponentMove: opponentMove.toUpperCase()
            });
            if (history.length > 50) history.shift();
        }

        state.turn++;

        // 3. Apply Moves
        let orderedSnakes = [...state.board.snakes].sort((a, b) => (a.id === "s2" ? -1 : 1));

        orderedSnakes.forEach(s => {
            let m = moves.find(move => move.id === s.id);
            if (!m) return;

            let head = { ...s.body[0] };
            if (m.dir === 'up') head.y++;
            if (m.dir === 'down') head.y--;
            if (m.dir === 'left') head.x--;
            if (m.dir === 'right') head.x++;

            s.body.unshift(head);
            
            let fIdx = state.board.food.findIndex(f => f.x === head.x && f.y === head.y);
            if (fIdx !== -1) {
                s.health = 100;
                state.board.food.splice(fIdx, 1);
            } else {
                s.body.pop();
                s.health--;
            }
        });

        // Capture snake lengths for stats right before any deaths are applied
        state.board.snakes.forEach(s => {
            finalLengths[s.id] = s.body.length;
        });

        // 4. Resolve Deaths
        let newSurvivors = [];
        
        for (const s of state.board.snakes) {
            let h = s.body[0];
            let dead = false;
            let reason = "";

            // A. Wall
            if(h.x < 0 || h.x >= CONFIG.width || h.y < 0 || h.y >= CONFIG.height) {
                dead = true;
                reason = "Wall";
            }
            // B. Starvation
            else if(s.health <= 0) {
                dead = true;
                reason = "Starvation";
            }
            // C. Collisions
            else {
                const bodyHit = state.board.snakes.some(other => 
                    other.body.some((part, idx) => {
                        if (other.id === s.id && idx === 0) return false; 
                        return part.x === h.x && part.y === h.y;
                    })
                );
                if(bodyHit) {
                    dead = true;
                    reason = "Body";
                } else {
                    const headHit = state.board.snakes.some(other => {
                        if (other.id === s.id) return false;
                        if (other.body[0].x === h.x && other.body[0].y === h.y) {
                            return s.body.length <= other.body.length; 
                        }
                        return false;
                    });
                    if(headHit) {
                        dead = true;
                        reason = "Head";
                    }
                }
            }

            if(dead) {
                const pName = s.id === "s1" ? PLAYER_1.name : PLAYER_2.name;
                if(deathStats[pName] && reason) {
                    deathStats[pName][reason]++;
                }
            } else {
                newSurvivors.push(s);
            }
        }

        if (!newSurvivors.find(s => s.id === "s1") && state.board.snakes.find(s => s.id === "s1")) blueDied = true;
        state.board.snakes = newSurvivors;

        applyStandardFoodSpawning(
            randInt,
            CONFIG.width,
            CONFIG.height,
            state.board.snakes,
            state.board.food,
            foodSettings
        );

        if (blueDied && DEBUG_MODE && !HAS_FIND_MODE) {
            if (!ONLY_LOSS || blueDied) {
                generateDeathJSON(history, "Debug Mode Death");
                process.exit(0);
            }
        }

        if (state.board.snakes.length < 2) {
            gameOver = true;
            if (state.board.snakes.length === 1) {
                winner = state.board.snakes[0].id === "s1" ? PLAYER_1.name : PLAYER_2.name;
            } else {
                winner = "draw";
            }
        }
    }

    if (VISUAL_MODE && !DEBUG_MODE && !HAS_FIND_MODE) {
        console.log(`\nGAME OVER! Result: ${winner ? winner : 'Draw'}`);
    }

    return { winner, turns: state.turn, history, blueDied, finalLengths };
}

// --- MAIN LOOP ---

async function main() {
    console.log(`\n${CYAN}=== ARENA ===${RESET}`);
    if (LIST_OPPONENTS) {
        console.log(formatOpponentRoster(BOT_ROSTER));
        return;
    }

    let loadedSnapshot = null;
    if (RESUME_MODE) {
        try {
            loadedSnapshot = loadSnapshotFromFile(SNAPSHOT_FILE_PATH);
        } catch (error) {
            console.log(`${RED}Failed to load snapshot:${RESET} ${error.message}`);
            process.exit(1);
        }
    }

    const baseSeed = Number.isFinite(parsedSeed)
        ? parsedSeed
        : (loadedSnapshot?.seed ?? Math.floor(Math.random() * 2000000000));
    
    console.log(`Modes: ${VISUAL_MODE ? 'VISUAL' : 'HEADLESS'} | Debug: ${DEBUG_MODE}`);
    console.log(`Games: ${TOTAL_GAMES} | Initial Seed: ${baseSeed}`);
    console.log(`Timing: delay=${CONFIG.delay}ms | reqTimeout=${CONFIG.requestTimeout}ms | payloadTimeout=${CONFIG.payloadTimeout}ms | snapshotTicks=${SNAPSHOT_TICKS}`);
    if (RESUME_MODE) {
        console.log(`Resume: ON | file=${formatDisplayPath(SNAPSHOT_FILE_PATH)}`);
    } else {
        console.log(`Resume: OFF | snapshot file=${formatDisplayPath(SNAPSHOT_FILE_PATH)}`);
    }
    if (INVALID_FIND_MODES.length > 0) {
        console.log(`${YELLOW}Ignoring unknown find mode(s):${RESET} ${INVALID_FIND_MODES.join(', ')}`);
    }
    if (HAS_FIND_MODE) {
        console.log(`Find Modes: ${FIND_MODES.join(', ')}`);
    }
    console.log(`-------------------------------\n`);

    const findModeConfigs = {
        shortest: { metricKey: 'turns', maximize: false, title: "Shortest Turns" },
        longest: { metricKey: 'turns', maximize: true, title: "Longest Turns" },
        "shortest-snake": { metricKey: 'localLength', maximize: false, title: `Shortest Local Snake (${PLAYER_1.name})` },
        "longest-snake": { metricKey: 'localLength', maximize: true, title: `Longest Local Snake (${PLAYER_1.name})` }
    };
    let targetGamesByMode = {};
    FIND_MODES.forEach(mode => {
        const config = findModeConfigs[mode];
        targetGamesByMode[mode] = {
            metric: config.maximize ? -Infinity : Infinity,
            turns: null,
            localLength: null,
            history: null,
            seed: null,
            winner: null
        };
    });

    // Stat Trackers for Tables
    let turnDistribution = {};
    let lengthDistributionP1 = {};
    let lengthDistributionP2 = {};

    // Initialize stat buckets to 0
    turnBins.forEach(b => turnDistribution[b] = 0);
    lengthBins.forEach(b => {
        lengthDistributionP1[b] = 0;
        lengthDistributionP2[b] = 0;
    });

    for (let i = 0; i < TOTAL_GAMES; i++) {
        let matchSeed = (baseSeed + i) % 4294967296; 
        const result = await runMatch(matchSeed, RESUME_MODE ? loadedSnapshot : null);
        
        // Track standard Win/Loss
        if (result.winner === PLAYER_1.name) stats[PLAYER_1.name]++;
        else if (result.winner === PLAYER_2.name) stats[PLAYER_2.name]++;
        else stats.draws++;

        // Track Turn/Length Distribution
        turnDistribution[getTurnBin(result.turns)]++;
        lengthDistributionP1[getLengthBin(result.finalLengths.s1)]++;
        lengthDistributionP2[getLengthBin(result.finalLengths.s2)]++;

        if (HAS_FIND_MODE) {
            const validCandidate = !ONLY_LOSS || result.blueDied;
            if (validCandidate) {
                FIND_MODES.forEach(mode => {
                    const modeConfig = findModeConfigs[mode];
                    const targetGame = targetGamesByMode[mode];
                    const candidateMetric = modeConfig.metricKey === 'localLength'
                        ? result.finalLengths.s1
                        : result.turns;
                    const isNewTarget = modeConfig.maximize
                        ? candidateMetric > targetGame.metric
                        : candidateMetric < targetGame.metric;

                    if (isNewTarget) {
                        targetGamesByMode[mode] = {
                            metric: candidateMetric,
                            turns: result.turns,
                            localLength: result.finalLengths.s1,
                            history: result.history,
                            seed: matchSeed,
                            winner: result.winner || "Draw"
                        };
                    }
                });
                }
        }

        if (!VISUAL_MODE) {
            process.stdout.write(`\r[${i + 1}/${TOTAL_GAMES}] ${PLAYER_1.name}: ${stats[PLAYER_1.name]} | ${PLAYER_2.name}: ${stats[PLAYER_2.name]} | Draws: ${stats.draws}`);
        }
    }

    console.log(`\n\n${GREEN}Final Results:${RESET}`, stats);
    
    console.log(`\n${RED}Death Analysis:${RESET}`);
    console.table(deathStats);

    // --- GENERATE TURN DISTRIBUTION TABLE ---
    const formattedTurnTable = {};
    turnBins.forEach(bin => {
        const count = turnDistribution[bin];
        formattedTurnTable[bin] = {
            "Count": count,
            "Percentage (%)": ((count / TOTAL_GAMES) * 100).toFixed(2) + "%"
        };
    });
    console.log(`\n${CYAN}Turn Duration Distribution:${RESET}`);
    console.table(formattedTurnTable);

    // --- GENERATE LENGTH DISTRIBUTION TABLE ---
    console.log(`\n${CYAN}Final Snake Length Distribution:${RESET}`);

    const safeTotalGames = Math.max(1, TOTAL_GAMES);
    const p1PercentByBin = {};
    const p2PercentByBin = {};
    lengthBins.forEach(bin => {
        p1PercentByBin[bin] = ((lengthDistributionP1[bin] / safeTotalGames) * 100).toFixed(2) + "%";
        p2PercentByBin[bin] = ((lengthDistributionP2[bin] / safeTotalGames) * 100).toFixed(2) + "%";
    });

    const colWidths = [
        Math.max("Len".length, ...lengthBins.map(b => b.length)),
        Math.max(PLAYER_1.name.length, "Count".length, ...lengthBins.map(b => String(lengthDistributionP1[b]).length)),
        Math.max("%".length, ...lengthBins.map(b => p1PercentByBin[b].length)),
        Math.max(PLAYER_2.name.length, "Count".length, ...lengthBins.map(b => String(lengthDistributionP2[b]).length)),
        Math.max("%".length, ...lengthBins.map(b => p2PercentByBin[b].length))
    ];

    const pad = (value, width) => String(value).padEnd(width, " ");
    const row = (values) => `| ${values.map((v, i) => pad(v, colWidths[i])).join(" | ")} |`;
    const divider = `+-${colWidths.map(w => "-".repeat(w)).join("-+-")}-+`;

    console.log(divider);
    console.log(row(["Len", PLAYER_1.name, "", PLAYER_2.name, ""]));
    console.log(row(["", "Count", "%", "Count", "%"]));
    console.log(divider);
    lengthBins.forEach(bin => {
        console.log(row([
            bin,
            String(lengthDistributionP1[bin]),
            p1PercentByBin[bin],
            String(lengthDistributionP2[bin]),
            p2PercentByBin[bin]
        ]));
    });
    console.log(divider);

    if (HAS_FIND_MODE) {
        FIND_MODES.forEach(mode => {
            const modeConfig = findModeConfigs[mode];
            const targetGame = targetGamesByMode[mode];
            if (!targetGame || !targetGame.history) return;

            const metricLabel = modeConfig.metricKey === 'localLength'
                ? `${targetGame.localLength} local length`
                : `${targetGame.turns} turns`;
            console.log(`\n${CYAN}Found ${modeConfig.title} Game:${RESET} ${metricLabel} (Winner: ${targetGame.winner})`);
            console.log(`Reproduce this game: bun arena --visual --seed=${targetGame.seed}`);
            console.log(`Continue from saved snapshot: bun arena --visual --resume`);
            generateDeathJSON(targetGame.history, `${modeConfig.title} Game Snapshot`);
        });
    }
}

main();
