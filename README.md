# Folder Layout

- `src/ai/*.js`: Core AI modules used by browser + server logic.
- `src/ai/runners/`: Runnable scripts and services.
  - `arena.js`
  - `genetic_trainer.js`
  - `my_snake_wrapper.js`
- `src/ai/data/`: Training outputs and checkpoints.
  - `ga_results.json`
  - `ga_checkpoint.json`
  - `checkpoint_best.json`
- `src/ai/test/`: AI regression test.
  - `regression_suite.js`

## Run Commands

- `bun arena` runs `src/ai/runners/arena.js`
- `bun trainer` runs `src/ai/runners/genetic_trainer.js`
- `bun server` runs `src/ai/runners/my_snake_wrapper.js`
- `bun run test` runs `src/ai/test/regression_suite.js`

All args are forwarded, for example:
- `bun arena --visual --games=20`
- `bun trainer --gens=50 --pop=40`
- `bun server --port=9000`
- `bun run test --depths=1,2,3,4 --quiet=1 --quietFailOnly=1`
