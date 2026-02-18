const fs = require('fs');
const path = require('path');
const Config = require('./src/ai/config');
const { getSmartMoveDebug } = require('./src/ai/brain');
const { convertRequestToState } = require('./src/ai/adapter');

const DEFAULT_SCENARIO_DIR = path.join(__dirname, 'public/scenarios');

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
    if (Array.isArray(value)) {
        return value
            .map(v => Number(v))
            .filter(Number.isFinite)
            .map(v => Math.max(1, Math.floor(v)));
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map(v => Number(v.trim()))
            .filter(Number.isFinite)
            .map(v => Math.max(1, Math.floor(v)));
    }

    if (Number.isFinite(value)) {
        return [Math.max(1, Math.floor(value))];
    }

    return [];
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

    try {
        for (const depth of depthList) {
            Config.MAX_DEPTH = depth;
            if (!quiet && depthList.length > 1) {
                console.log(`Depth ${depth}:`);
            }

            const perDepth = evaluateScenariosAtCurrentDepth(scenarios, {
                logPerScenario: quiet ? quietFailOnly : logPerScenario,
                logPasses: quiet ? false : logPasses,
                logFailures: quiet ? quietFailOnly : logFailures
            });
            byDepth.push({ depth, ...perDepth });

            passed += perDepth.passed;
            failed += perDepth.failed;
            skipped += perDepth.skipped;

            if (!quiet && depthList.length > 1) {
                console.log(
                    `Depth ${depth} results -> Passed: ${perDepth.passed}, Failed: ${perDepth.failed}, Skipped: ${perDepth.skipped}\n`
                );
            }
        }
    } finally {
        Config.MAX_DEPTH = origDepth;
    }

    if (!quiet && printSummary) {
        console.log(`--- RESULTS ---`);
        console.log(`Passed:  ${passed}`);
        console.log(`Failed:  ${failed}`);
        console.log(`Skipped: ${skipped}\n`);
    }

    return { passed, failed, skipped, byDepth, scenarios: scenarios.length, error: null };
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
