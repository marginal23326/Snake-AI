const { DIRS } = require('./brain');

function convertRequestToState(reqBody) {
    const board = reqBody.board;
    const you = reqBody.you;
    
    // Handle case where opponent might not exist (solo play or dead)
    const opponentSnake = board.snakes.find(s => s.id !== you.id);
    const opponent = opponentSnake || { body: [], head: {}, health: 0 };

    // 1. Build Player Object (Me)
    const playerObj = {
        body: you.body.map(p => ({ x: p.x, y: p.y })),
        dir: calcDir(you.head, you.body[1]),
        health: you.health,
        score: you.length // Use length as score proxy
    };
    
    // 2. Build AI Object (Enemy)
    // Note: If enemy is dead/empty, body is empty array
    const aiObj = {
        body: opponent.body.map(p => ({ x: p.x, y: p.y })),
        dir: opponent.body.length > 1 ? calcDir(opponent.head, opponent.body[1]) : DIRS.UP,
        health: opponent.health || 0,
        score: opponent.length || 0
    };

    // 3. Build Food Array (Pass ALL food, let brain decide)
    const foodArray = board.food.map(f => ({ x: f.x, y: f.y }));

    // 4. Return structure
    return {
        player: playerObj, // This is 'me' in brain.js
        ai: aiObj,         // This is 'enemy' in brain.js
        food: foodArray,
        cols: board.width,
        rows: board.height
    };
}

function calcDir(head, neck) {
    if (!neck) return DIRS.UP; // Default if just head
    if (head.x < neck.x) return DIRS.LEFT;
    if (head.x > neck.x) return DIRS.RIGHT;
    if (head.y < neck.y) return DIRS.DOWN;
    return DIRS.UP;
}

module.exports = { convertRequestToState };