const fs = require('fs');
const path = require('path');
const Config = require('../config');
const { getSmartMoveDebug } = require('../brain');
const { convertRequestToState } = require('../adapter');

const DEFAULT_SCENARIO_DIR = path.resolve(__dirname, '../../../public/scenarios');

function loadScenarios(scenarioDir = DEFAULT_SCENARIO_DIR) {
    let files = [];
    try {
        files = fs.readdirSync(scenarioDir).filter(f => f.endsWith('.json')).sort();
    } catch (err) {
        return { scenarios: [], error: err };
    }

    const scenarios = [];
    for (const file of files) {
        const rawData = JSON.parse(fs.readFileSync(path.join(scenarioDir, file), 'utf8'));
        scenarios.push({ file, rawData });
    }
    return { scenarios, error: null };
}

function evaluateScenariosAtCurrentDepth(scenarios, options = {}) {
    const logPerScenario = options.logPerScenario !== false;
    const logPasses = options.logPasses !== false;
    const logFailures = options.logFailures !== false;

    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const scenario of scenarios) {
        const file = scenario.file;
        const rawData = scenario.rawData;

        const expectedMove = rawData.expectedMove;
        let avoidList = rawData.avoidList || [];
        if (!avoidList.length && rawData.avoidMove) avoidList = [rawData.avoidMove];

        const state = convertRequestToState(rawData.rawRequest || rawData);
        const decision = getSmartMoveDebug(
            state.player,
            state.ai,
            state.food,
            state.cols,
            state.rows
        );

        const actualMove = decision.bestMove.name.toLowerCase();

        if (expectedMove && expectedMove !== 'unknown') {
            if (actualMove === expectedMove) {
                if (logPerScenario && logPasses) console.log(`PASS ${file}: AI chose ${actualMove}`);
                passed++;
            } else {
                if (logPerScenario && logFailures) {
                    console.log(`FAIL ${file} (Expected: ${expectedMove}, Got: ${actualMove})`);
                }
                failed++;
            }
        } else if (avoidList.length > 0) {
            if (avoidList.includes(actualMove)) {
                if (logPerScenario && logFailures) {
                    console.log(`FAIL ${file} (Avoid: [${avoidList.join(', ')}], Got: ${actualMove})`);
                }
                failed++;
            } else {
                if (logPerScenario && logPasses) {
                    console.log(`PASS ${file}: AI avoided [${avoidList.join(', ')}] (chose ${actualMove})`);
                }
                passed++;
            }
        } else {
            skipped++;
        }
    }

    return { passed, failed, skipped };
}

function parseDepths(value) {
    // helper to expand a numeric range inclusive with optional step
    function expandRange(a, b, step = 1) {
        const start = Math.max(1, Math.floor(Number(a)));
        const end = Math.max(1, Math.floor(Number(b)));
        if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
        const from = Math.min(start, end);
        const to = Math.max(start, end);
        const st = Math.max(1, Math.floor(Number(step)) || 1);
        const out = [];
        for (let v = from; v <= to; v += st) out.push(v);
        return out;
    }

    const results = new Set();

    // If already an array: flatten values (numbers or strings)
    if (Array.isArray(value)) {
        for (const v of value) {
            const parsed = parseDepths(v);
            parsed.forEach(d => results.add(d));
        }
        return Array.from(results).sort((a, b) => a - b);
    }

    // If a number
    if (Number.isFinite(value)) {
        const n = Math.max(1, Math.floor(Number(value)));
        return [n];
    }

    // If string: support tokens separated by commas.
    if (typeof value === 'string') {
        const tokens = value.split(',').map(t => t.trim()).filter(Boolean);
        for (const token of tokens) {
            // Range with optional step: "start-end:step" or "start-end/step"
            const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)(?:(?:\:|\/)(\d+))?$/);
            if (rangeMatch) {
                const [, a, b, step] = rangeMatch;
                expandRange(a, b, step).forEach(d => results.add(d));
                continue;
            }

            // Single number
            const num = Number(token);
            if (Number.isFinite(num)) {
                results.add(Math.max(1, Math.floor(num)));
                continue;
            }

            // ignore unrecognized token
        }

        return Array.from(results).sort((a, b) => a - b);
    }

    // fallback: return empty
    return [];
}

function formatMs(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function runRegressionSuite(options = {}) {
    const quiet = !!options.quiet;
    const quietFailOnly = !!options.quietFailOnly;
    const printHeader = options.printHeader !== false;
    const printSummary = options.printSummary !== false;
    const logPerScenario = options.logPerScenario !== false;
    const logPasses = options.logPasses !== false;
    const logFailures = options.logFailures !== false;

    const depthListRaw = parseDepths(options.depths);
    const depthList = depthListRaw.length ? depthListRaw : [Config.MAX_DEPTH];

    let scenarios = options.scenarios;
    if (!Array.isArray(scenarios)) {
        const loaded = loadScenarios(options.scenarioDir || DEFAULT_SCENARIO_DIR);
        if (loaded.error) {
            return {
                passed: 0,
                failed: 0,
                skipped: 0,
                byDepth: [],
                scenarios: 0,
                error: loaded.error
            };
        }
        scenarios = loaded.scenarios;
    }

    if (!quiet && printHeader) {
        console.log(`\nRUNNING AI REGRESSION SUITE (${scenarios.length} scenarios)`);
        console.log(`Depths: ${depthList.join(', ')}\n`);
    }

    const origDepth = Config.MAX_DEPTH;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const byDepth = [];

    const suiteStart = Date.now();

    try {
        for (const depth of depthList) {
            Config.MAX_DEPTH = depth;
            if (!quiet && depthList.length > 1) {
                console.log(`Depth ${depth}:`);
            }

            const depthStart = Date.now();
            const perDepth = evaluateScenariosAtCurrentDepth(scenarios, {
                logPerScenario: quiet ? quietFailOnly : logPerScenario,
                logPasses: quiet ? false : logPasses,
                logFailures: quiet ? quietFailOnly : logFailures
            });
            const depthMs = Date.now() - depthStart;

            byDepth.push({ depth, ...perDepth, durationMs: depthMs });

            passed += perDepth.passed;
            failed += perDepth.failed;
            skipped += perDepth.skipped;

            if (!quiet && depthList.length > 1) {
                console.log(
                    `Depth ${depth} results -> Passed: ${perDepth.passed}, Failed: ${perDepth.failed}, Skipped: ${perDepth.skipped} | ${formatMs(depthMs)}\n`
                );
            }
        }
    } finally {
        Config.MAX_DEPTH = origDepth;
    }

    const totalMs = Date.now() - suiteStart;

    if (!quiet && printSummary) {
        console.log(`--- RESULTS ---`);
        console.log(`Passed:  ${passed}`);
        console.log(`Failed:  ${failed}`);
        console.log(`Skipped: ${skipped}`);
        if (byDepth.length > 1) {
            byDepth.forEach(d => console.log(`  Depth ${d.depth}: ${formatMs(d.durationMs)}`));
        }
        console.log(`Total:   ${formatMs(totalMs)}\n`);
    }

    return { passed, failed, skipped, byDepth, scenarios: scenarios.length, durationMs: totalMs, error: null };
}

if (require.main === module) {
    const cli = {};
    process.argv.slice(2).forEach(arg => {
        const m = arg.match(/^--?(\w+)=(.+)$/);
        if (!m) return;
        cli[m[1]] = isNaN(+m[2]) ? m[2] : +m[2];
    });

    const result = runRegressionSuite({
        depths: cli.depths,
        quiet: !!cli.quiet,
        quietFailOnly: !!cli.quietFailOnly
    });

    if (result.error) {
        console.log('No scenarios directory found. Skipping tests.');
        process.exit(1);
    }

    process.exitCode = result.failed > 0 ? 1 : 0;
}

module.exports = {
    loadScenarios,
    runRegressionSuite
};