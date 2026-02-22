const axios = require('axios');
const { getSmartMoveDebug } = require('../brain');
const {
    STANDARD_FOOD_SETTINGS,
    placeInitialStandardFood,
    applyStandardFoodSpawning
} = require('../standard_food');

// --- CONFIGURATION & ARGS ---
const args = process.argv.slice(2);

const SELF_PLAY = args.includes('--self');

// MODES
const VISUAL_MODE = args.includes('--visual') || args.includes('-v');
const DEBUG_MODE = args.includes('--debug'); 
const ONLY_LOSS = args.includes('--only-loss');

const FIND_ARG = args.find(a => a.startsWith('--find='));
const FIND_MODE = FIND_ARG ? FIND_ARG.split('=')[1].toLowerCase() : null;

// SETTINGS
const GAMES_ARG = args.find(a => a.startsWith('--games'));
const SEED_ARG = args.find(a => a.startsWith('--seed'));

const OPPONENT_ARG = args.find(a => a.startsWith('--opponent='));
const OPPONENT_NAME = OPPONENT_ARG ? OPPONENT_ARG.split('=')[1] : "snakebot";

const TOTAL_GAMES = (VISUAL_MODE || DEBUG_MODE && !FIND_MODE) ? 1 : 
    (GAMES_ARG ? parseInt(GAMES_ARG.split('=')[1] || args[args.indexOf('--games') + 1]) : 100);

const CONFIG = {
    width: 16,
    height: 9,
    delay: 50,
    initialFood: STANDARD_FOOD_SETTINGS.initialFood,
    minimumFood: STANDARD_FOOD_SETTINGS.minimumFood,
    foodSpawnChance: STANDARD_FOOD_SETTINGS.foodSpawnChance,
};
const SNAPSHOT_TICKS = 10; 

// COLORS
const RESET = "\x1b[0m";
const BLUE = "\x1b[34m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";

const BOT_ROSTER = [
    { name: "JS-Bot",         url: "http://localhost:9000", color: BLUE, type: "modern" },
    { name: "snakebot",       url: "http://localhost:8000", color: GREEN, type: "legacy" },
    { name: "shapeshifter",   url: "http://localhost:8080", color: GREEN, type: "standard" },
    { name: "snek-two",       url: "http://localhost:7000", color: RED,   type: "legacy" }
];

let PLAYER_1 = { ...BOT_ROSTER[0], name: "old-local", type: "local", url: null };

let PLAYER_2;
if (SELF_PLAY) {
    PLAYER_1 = { ...PLAYER_1, type: "local", url: null };
    PLAYER_2 = { ...PLAYER_1, name: `${PLAYER_1.name}-red`, url: null, type: "local" };
} else {
    const OPPONENT_ARG = args.find(a => a.startsWith('--opponent='));
    const OPPONENT_NAME = OPPONENT_ARG ? OPPONENT_ARG.split('=')[1] : "snakebot";
    PLAYER_2 = BOT_ROSTER.find(b => b.name === OPPONENT_NAME) || BOT_ROSTER[1];
}

let stats = { [PLAYER_1.name]: 0, [PLAYER_2.name]: 0, draws: 0 };

let deathStats = {
    [PLAYER_1.name]: { Starvation: 0, Wall: 0, Body: 0, Head: 0 },
    [PLAYER_2.name]: { Starvation: 0, Wall: 0, Body: 0, Head: 0 }
};

// --- RNG (MATCHING INDEX.HTML) ---
let currentSeed = SEED_ARG ? parseInt(SEED_ARG.split('=')[1]) : Math.floor(Math.random() * 2000000000);
const INITIAL_SEED = currentSeed; // Store initial to print later if needed

function seededRandom() {
    currentSeed = (currentSeed * 1664525 + 1013904223) % 4294967296;
    return currentSeed / 4294967296;
}

// --- HELPERS ---

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

function invertY(y, height) { return height - 1 - y; }

function formatPayload(state, you, botType) {
    const formatPoint = (p) => ({ x: p.x, y: p.y });

    if (botType === "standard") {
        return {
            game: { 
                id: "game-id", 
                ruleset: { name: "standard", version: "v1.2.3" }, 
                map: "standard",
                source: "arena.js",
                timeout: 400 
            },
            turn: state.turn,
            board: {
                height: state.board.height,
                width: state.board.width,
                food: state.board.food.map(formatPoint),
                hazards: [],
                snakes: state.board.snakes.map(s => ({
                    id: s.id, name: s.id, health: s.health,
                    body: s.body.map(formatPoint),
                    head: formatPoint(s.body[0]),
                    length: s.body.length, latency: "100", shout: ""
                }))
            },
            you: {
                id: you.id, name: you.id, health: you.health,
                body: you.body.map(formatPoint),
                head: formatPoint(you.body[0]),
                length: you.body.length, latency: "100", shout: ""
            }
        };
    }

    const isLegacy = (botType === "legacy");
    const transform = (y) => isLegacy ? invertY(y, state.board.height) : y;

    return {
        object: "world", id: "game-id",
        width: state.board.width, height: state.board.height,
        turn: state.turn,
        food: {
            object: "list",
            data: state.board.food.map(f => ({ object: "point", x: f.x, y: transform(f.y) }))
        },
        snakes: {
            object: "list",
            data: state.board.snakes.map(s => ({
                object: "snake", id: s.id, name: s.id, health: s.health,
                body: {
                    object: "list",
                    data: s.body.map(p => ({ object: "point", x: p.x, y: transform(p.y) }))
                }
            }))
        },
        you: {
            object: "snake", id: you.id, name: you.id, health: you.health,
            body: {
                object: "list",
                data: you.body.map(p => ({ object: "point", x: p.x, y: transform(p.y) }))
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
        seed: snapshot.seed,
        opponentMoves: subsequentMoves
    };

    console.log(`\n${YELLOW}=== JSON EXPORT (${reason}) ===${RESET}`);
    console.log(JSON.stringify(output, null, 2));
    console.log(`${YELLOW}====================================${RESET}\n`);
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

async function runMatch(gameSeed) {
    // Reset RNG to the specific seed for this match
    currentSeed = gameSeed;

    const pad = 2;
    let history = []; 
    let finalLengths = { s1: 3, s2: 3 }; // Initialize to starting length

    let state = {
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

    const randInt = (n) => Math.floor(seededRandom() * n);
    const foodSettings = {
        initialFood: CONFIG.initialFood,
        minimumFood: CONFIG.minimumFood,
        foodSpawnChance: CONFIG.foodSpawnChance,
    };

    placeInitialStandardFood(
        randInt,
        CONFIG.width,
        CONFIG.height,
        state.board.snakes,
        state.board.food,
        foodSettings
    );

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
                    const botType = config.type;
                    const payload = formatPayload(state, snake, botType);
                    const resp = await axios.post(`${config.url}/move`, payload, { timeout: 600 });
                    return { id: snake.id, dir: resp.data.move };
                }
            } catch (e) {
                return { id: snake.id, dir: 'up' };
            }
        });

        const moves = await Promise.all(moveRequests);

        // 2. Snapshot History
        if (DEBUG_MODE || FIND_MODE) {
            const opponentMove = moves.find(m => m.id === "s2")?.dir || "UP";
            history.push({
                board: JSON.parse(JSON.stringify(state.board)),
                seed: turnSeed,
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

        if (blueDied && DEBUG_MODE && !FIND_MODE) {
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

    if (VISUAL_MODE && !DEBUG_MODE && !FIND_MODE) {
        console.log(`\nGAME OVER! Result: ${winner ? winner : 'Draw'}`);
    }

    return { winner, turns: state.turn, history, blueDied, finalLengths };
}

// --- MAIN LOOP ---

async function main() {
    console.log(`\n${CYAN}=== ARENA ===${RESET}`);
    const baseSeed = SEED_ARG ? parseInt(SEED_ARG.split('=')[1]) : Math.floor(Math.random() * 2000000000);
    
    console.log(`Modes: ${VISUAL_MODE ? 'VISUAL' : 'HEADLESS'} | Debug: ${DEBUG_MODE}`);
    console.log(`Games: ${TOTAL_GAMES} | Initial Seed: ${baseSeed}`);
    console.log(`-------------------------------\n`);

    let targetGame = { 
        turns: FIND_MODE === 'shortest' ? Infinity : -1, 
        history: null, 
        seed: null, 
        winner: null 
    };

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
        
        const result = await runMatch(matchSeed);
        
        // Track standard Win/Loss
        if (result.winner === PLAYER_1.name) stats[PLAYER_1.name]++;
        else if (result.winner === PLAYER_2.name) stats[PLAYER_2.name]++;
        else stats.draws++;

        // Track Turn/Length Distribution
        turnDistribution[getTurnBin(result.turns)]++;
        lengthDistributionP1[getLengthBin(result.finalLengths.s1)]++;
        lengthDistributionP2[getLengthBin(result.finalLengths.s2)]++;

        if (FIND_MODE) {
            const validCandidate = !ONLY_LOSS || result.blueDied;
            if (validCandidate) {
                const isNewTarget = 
                    (FIND_MODE === 'longest' && result.turns > targetGame.turns) ||
                    (FIND_MODE === 'shortest' && result.turns < targetGame.turns);

                if (isNewTarget) {
                    targetGame = {
                        turns: result.turns,
                        history: result.history,
                        seed: matchSeed,
                        winner: result.winner || "Draw"
                    };
                }
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
    const formattedLengthTable = {};
    lengthBins.forEach(bin => {
        const p1Count = lengthDistributionP1[bin];
        const p2Count = lengthDistributionP2[bin];
        formattedLengthTable[bin] = {
            [`${PLAYER_1.name} Count`]: p1Count,
            [`${PLAYER_1.name} %`]: ((p1Count / TOTAL_GAMES) * 100).toFixed(2) + "%",
            [`${PLAYER_2.name} Count`]: p2Count,
            [`${PLAYER_2.name} %`]: ((p2Count / TOTAL_GAMES) * 100).toFixed(2) + "%"
        };
    });
    console.log(`\n${CYAN}Final Snake Length Distribution:${RESET}`);
    console.table(formattedLengthTable);

    if (FIND_MODE && targetGame.history) {
        const modeTitle = FIND_MODE.charAt(0).toUpperCase() + FIND_MODE.slice(1);
        console.log(`\n${CYAN}Found ${modeTitle} Game:${RESET} ${targetGame.turns} turns (Winner: ${targetGame.winner})`);
        console.log(`Reproduce this game: bun arena --visual --seed=${targetGame.seed}`);
        generateDeathJSON(targetGame.history, `${modeTitle} Game Snapshot`);
    }
}

main();