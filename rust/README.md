# Snake AI

## Workspace

- `crates/snake-domain`: shared game/domain model, simulation engine, food rules, deterministic RNG.
- `crates/snake-ai`: search/evaluation engine and move decision API.
- `crates/snake-io`: scenario v2 schema + loading/saving.
- `crates/snake-api`: standard + legacy payload parsing/building.
- `crates/snake-app`: single executable with GUI and CLI subcommands.

## Scenario Schema

Scenarios are stored in:

- `data/scenarios_v2/*.json`

Each file uses `schema_version: 2` and an explicit expectation:

- `{"kind":"exact","direction":"left"}`
- `{"kind":"avoid","directions":["up","left"]}`

## Run

From `rust/`:

```bash
cargo run -p snake-app -- gui
cargo run -p snake-app -- server --port=9000
cargo run -p snake-app -- arena --games=20 --opponent=local
cargo run -p snake-app -- test --depths=6
cargo run -p snake-app -- trainer --gens=25 --pop=30
```

## Tests


Regression test is in:

- `crates/snake-io/tests/scenario_regression.rs`
