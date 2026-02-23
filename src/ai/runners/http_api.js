function invertY(y, height) {
    return height - 1 - y;
}

function normalizeApiType(apiType) {
    const value = String(apiType || "world").trim().toLowerCase();
    if (value === "standard") return "standard";
    if (value === "legacy") return "legacy";
    return "world";
}

function normalizeMoveName(move) {
    if (typeof move !== "string") return null;
    const value = move.trim().toLowerCase();
    return ["up", "down", "left", "right"].includes(value) ? value : null;
}

const DIRECTION_VECTORS = Object.freeze({
    up: Object.freeze({ x: 0, y: 1 }),
    down: Object.freeze({ x: 0, y: -1 }),
    left: Object.freeze({ x: -1, y: 0 }),
    right: Object.freeze({ x: 1, y: 0 })
});

function moveNameToVector(moveName, fallbackMove = "up") {
    const move = normalizeMoveName(moveName) || normalizeMoveName(fallbackMove) || "up";
    const vector = DIRECTION_VECTORS[move];
    return { x: vector.x, y: vector.y };
}

function toPoint(point) {
    return { x: point.x, y: point.y };
}

function getSnakeHealth(snake) {
    if (Number.isFinite(snake?.health)) return snake.health;
    if (Number.isFinite(snake?.hp)) return snake.hp;
    return 100;
}

function formatSnakeForStandard(snake) {
    const body = Array.isArray(snake.body) ? snake.body.map(toPoint) : [];
    const head = body[0] || { x: 0, y: 0 };
    return {
        id: snake.id,
        name: snake.name || snake.id,
        health: getSnakeHealth(snake),
        body,
        head,
        length: body.length,
        latency: "100",
        shout: ""
    };
}

function buildStandardPayload(state, you, options = {}) {
    const board = state.board || {};
    const snakes = Array.isArray(board.snakes) ? board.snakes : [];
    const food = Array.isArray(board.food) ? board.food : [];
    const gameId = options.gameId || "game-id";

    const game = {
        id: gameId,
        ruleset: {
            name: "standard",
            version: options.rulesetVersion || "v1.2.3"
        },
        map: options.mapName || "standard"
    };
    if (options.source) game.source = options.source;
    if (Number.isFinite(options.timeout)) game.timeout = options.timeout;

    return {
        game,
        turn: Number.isFinite(state.turn) ? state.turn : 0,
        board: {
            height: board.height,
            width: board.width,
            food: food.map(toPoint),
            hazards: [],
            snakes: snakes.map(formatSnakeForStandard)
        },
        you: formatSnakeForStandard(you)
    };
}

function buildWorldPayload(state, you, options = {}) {
    const board = state.board || {};
    const snakes = Array.isArray(board.snakes) ? board.snakes : [];
    const food = Array.isArray(board.food) ? board.food : [];
    const useLegacyCoords = normalizeApiType(options.apiType) === "legacy";
    const transformY = (y) => useLegacyCoords ? invertY(y, board.height) : y;

    return {
        object: "world",
        id: options.gameId || "game-id",
        width: board.width,
        height: board.height,
        turn: Number.isFinite(state.turn) ? state.turn : 0,
        food: {
            object: "list",
            data: food.map(f => ({ object: "point", x: f.x, y: transformY(f.y) }))
        },
        snakes: {
            object: "list",
            data: snakes.map(s => ({
                object: "snake",
                id: s.id,
                name: s.name || s.id,
                health: getSnakeHealth(s),
                body: {
                    object: "list",
                    data: (Array.isArray(s.body) ? s.body : []).map(p => ({
                        object: "point",
                        x: p.x,
                        y: transformY(p.y)
                    }))
                }
            }))
        },
        you: {
            object: "snake",
            id: you.id,
            name: you.name || you.id,
            health: getSnakeHealth(you),
            body: {
                object: "list",
                data: (Array.isArray(you.body) ? you.body : []).map(p => ({
                    object: "point",
                    x: p.x,
                    y: transformY(p.y)
                }))
            }
        }
    };
}

function buildMovePayload(state, you, options = {}) {
    const apiType = normalizeApiType(options.apiType);
    if (apiType === "standard") return buildStandardPayload(state, you, options);
    return buildWorldPayload(state, you, { ...options, apiType });
}

module.exports = {
    invertY,
    normalizeApiType,
    normalizeMoveName,
    moveNameToVector,
    buildMovePayload
};
