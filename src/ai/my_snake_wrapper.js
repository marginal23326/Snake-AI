const express = require('express');
const bodyParser = require('body-parser');
const { getSmartMoveDebug } = require('./brain');
const Config = require('./config');

const app = express();
app.use(bodyParser.json());

// Helper to convert Legacy {data: []} objects back into simple arrays []
function clean(obj) {
    if (!obj) return obj;
    if (obj.data && Array.isArray(obj.data)) return obj.data.map(clean);
    return obj;
}

function cleanSnake(s) {
    if (!s) return s;
    return {
        ...s,
        body: clean(s.body)
    };
}

// ── Genetic-trainer endpoints ────────────────────────────────────

app.post('/configure', (req, res) => {
    Config.update(req.body);
    console.log('[configure] Config updated.');
    res.json({ status: 'ok', config: Config.snapshot() });
});

app.get('/config', (_req, res) => {
    res.json(Config.snapshot());
});

// ── Battlesnake Legacy endpoints ─────────────────────────────────

app.post('/move', (req, res) => {
    const data = req.body;

    const me = cleanSnake(data.you);

    const rawSnakes = data.snakes ? clean(data.snakes) : [];
    const snakes = rawSnakes.map(cleanSnake);

    const enemy = snakes.find(s => s.id !== me.id) || me;

    const foods = data.food ? clean(data.food) : [];

    const width  = data.width  || (data.board ? data.board.width  : 15);
    const height = data.height || (data.board ? data.board.height : 15);

    try {
        console.log(`Thinking (Turn ${data.turn})...`);
        const decision = getSmartMoveDebug(me, enemy, foods, width, height);
        console.log(`Decision: ${decision.bestMove.name}`);
        res.json({ move: decision.bestMove.name.toLowerCase() });
    } catch (e) {
        console.error("AI INTERNAL CRASH:", e);
        res.json({ move: "up" });
    }
});

app.post('/start', (_req, res) => res.json({}));
app.post('/end',   (_req, res) => res.json({}));

app.listen(9000, () => console.log("JS Bot listening on 9000 (Legacy-Compatible)"));