mod gui;
mod server;
mod services;

use std::{
    io::{self, Write},
    net::SocketAddr,
    path::{Path, PathBuf},
    str::FromStr,
};

use anyhow::Result;
use clap::{ArgAction, Args, Parser, Subcommand};
use snake_ai::{AiConfig, RuntimeConfig};
use snake_api::normalize_api_type;
use tracing_subscriber::EnvFilter;

use crate::{
    gui::run_gui,
    server::run_server,
    services::{
        ArenaOptions, RegressionOptions, RegressionOutput, TrainerOptions, default_scenario_dir, format_arena_progress_line,
        format_arena_summary_report, format_opponent_roster, parse_arena_find_modes, parse_depths, run_arena_with_progress,
        run_regression_suite, run_trainer,
    },
};

#[derive(Debug, Parser)]
#[command(name = "snake-app", version, about = "Snake Lab Rust: GUI + CLI runners")]
struct Cli {
    #[command(flatten)]
    runtime: RuntimeCliArgs,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Clone, Args)]
struct RuntimeCliArgs {
    #[arg(
        long,
        global = true,
        default_value_t = RuntimeConfig::DEFAULT_THREADS,
        help = "AI search threads (0 = auto)"
    )]
    threads: usize,
    #[arg(
        long = "hash-mb",
        alias = "tt-mb",
        alias = "hashSize",
        global = true,
        default_value_t = RuntimeConfig::DEFAULT_HASH_MB,
        help = "Transposition table size in MiB (0 = auto)"
    )]
    hash_mb: usize,
}

#[derive(Debug, Subcommand)]
enum Command {
    Gui,
    Server {
        #[arg(long, default_value = "0.0.0.0")]
        host: String,
        #[arg(long, default_value_t = 9000)]
        port: u16,

        #[arg(long)]
        debug_perf: bool,
    },
    Test(TestCliArgs),
    Arena(ArenaCliArgs),
    Trainer(TrainerCliArgs),
}

#[derive(Debug, Args)]
struct TestCliArgs {
    #[arg(long)]
    scenario_dir: Option<PathBuf>,
    #[arg(long, default_value = RegressionOptions::DEFAULT_DEPTHS_RAW)]
    depths: String,
    #[arg(long, default_value_t = false)]
    quiet: bool,
    #[arg(long, default_value_t = false)]
    quiet_fail_only: bool,
    #[arg(long)]
    debug_perf: bool,
}

impl TestCliArgs {
    fn into_runtime(self, rust_root: &Path) -> RegressionOptions {
        let scenario_dir = self.scenario_dir.unwrap_or_else(|| default_scenario_dir(rust_root));

        // Map CLI flags to explicit Enum state
        let output = RegressionOutput::from_flags(self.quiet, self.quiet_fail_only);

        RegressionOptions {
            scenario_dir,
            depths: parse_depths(&self.depths),
            output,
        }
    }
}

#[derive(Debug, Args)]
struct ArenaCliArgs {
    #[arg(long, default_value_t = ArenaOptions::DEFAULT_GAMES)]
    games: usize,
    #[arg(long, default_value_t = ArenaOptions::DEFAULT_SEED)]
    seed: u32,
    #[arg(long, default_value_t = ArenaOptions::DEFAULT_WIDTH)]
    width: i32,
    #[arg(long, default_value_t = ArenaOptions::DEFAULT_HEIGHT)]
    height: i32,
    #[arg(long, default_value_t = ArenaOptions::DEFAULT_MAX_TURNS)]
    max_turns: u32,
    #[arg(long, default_value = ArenaOptions::DEFAULT_OPPONENT)]
    opponent: String,
    #[arg(long, default_value_t = ArenaOptions::DEFAULT_SELF_PLAY)]
    self_play: bool,
    #[arg(long, default_value = ArenaOptions::DEFAULT_API_RAW)]
    api: String,
    #[arg(
        long,
        default_value_t = ArenaOptions::DEFAULT_REQUEST_TIMEOUT_MS
    )]
    request_timeout: u64,
    #[arg(
        long,
        alias = "move-timeout",
        default_value_t = ArenaOptions::DEFAULT_PAYLOAD_TIMEOUT_MS
    )]
    payload_timeout: u32,
    #[arg(long = "find", short = 'f', action = ArgAction::Append)]
    find: Vec<String>,
    #[arg(
        long,
        alias = "loss-only",
        default_value_t = ArenaOptions::DEFAULT_ONLY_LOSS
    )]
    only_loss: bool,
    #[arg(
        long,
        short = 'r',
        alias = "load-snapshot",
        default_value_t = ArenaOptions::DEFAULT_RESUME
    )]
    resume: bool,
    #[arg(long = "snapshot-file", short = 'R', alias = "resume-file", alias = "snapshotFile")]
    snapshot_file: Option<PathBuf>,
    #[arg(
        long = "snapshot-ticks",
        default_value_t = ArenaOptions::DEFAULT_SNAPSHOT_TICKS
    )]
    snapshot_ticks: usize,
}

impl ArenaCliArgs {
    fn into_runtime(self, rust_root: &Path) -> ArenaOptions {
        let (find_modes, invalid_find_modes) = parse_arena_find_modes(&self.find);
        ArenaOptions {
            games: self.games,
            seed: self.seed,
            width: self.width,
            height: self.height,
            max_turns: self.max_turns,
            opponent: self.opponent,
            self_play: self.self_play,
            api_flavor: normalize_api_type(Some(self.api.as_str())),
            request_timeout_ms: self.request_timeout,
            payload_timeout_ms: self.payload_timeout,
            find_modes,
            invalid_find_modes,
            only_loss: self.only_loss,
            resume: self.resume,
            snapshot_file: self
                .snapshot_file
                .unwrap_or_else(|| rust_root.join("data").join("arena_snapshot.json")),
            snapshot_ticks: self.snapshot_ticks.max(1),
        }
    }
}

#[derive(Debug, Args)]
struct TrainerCliArgs {
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_POP)]
    pop: usize,
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_GENS)]
    gens: usize,
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_ELITE)]
    elite: usize,
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_GAMES)]
    games: usize,
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_DEPTH)]
    depth: usize,
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_WIDTH)]
    width: i32,
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_HEIGHT)]
    height: i32,
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_MAX_TURNS)]
    max_turns: u32,
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_MUT_RATE)]
    mut_rate: f64,
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_MUT_STRENGTH)]
    mut_strength: f64,
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_TOURNEY)]
    tourney: usize,
    #[arg(long)]
    save: Option<PathBuf>,
    #[arg(long, short = 'o', action = ArgAction::Append)]
    opponent: Vec<String>,
    #[arg(
        long = "onlyHttp",
        alias = "only-http",
        default_value_t = TrainerOptions::DEFAULT_ONLY_HTTP_FLAG
    )]
    only_http: u8,
    #[arg(
        long = "httpGames",
        alias = "http-games",
        default_value_t = TrainerOptions::DEFAULT_HTTP_GAMES_OVERRIDE
    )]
    http_games: usize,
    #[arg(
        long = "selfPlay",
        alias = "self-play",
        default_value_t = TrainerOptions::DEFAULT_SELF_PLAY_FLAG
    )]
    self_play: u8,
    #[arg(
        long = "selfGames",
        alias = "self-games",
        default_value_t = TrainerOptions::DEFAULT_SELF_GAMES
    )]
    self_games: usize,
    #[arg(
        long = "selfEvery",
        alias = "self-every",
        default_value_t = TrainerOptions::DEFAULT_SELF_EVERY
    )]
    self_every: usize,
    #[arg(
        long = "selfRecent",
        alias = "self-recent",
        default_value_t = TrainerOptions::DEFAULT_SELF_RECENT
    )]
    self_recent: usize,
    #[arg(
        long = "selfHof",
        alias = "self-hof",
        default_value_t = TrainerOptions::DEFAULT_SELF_HOF
    )]
    self_hof: usize,
    #[arg(
        long = "selfMaxPool",
        alias = "self-max-pool",
        default_value_t = TrainerOptions::DEFAULT_SELF_MAX_POOL
    )]
    self_max_pool: usize,
    #[arg(
        long = "stagedEval",
        alias = "staged-eval",
        default_value_t = TrainerOptions::DEFAULT_STAGED_EVAL_FLAG
    )]
    staged_eval: u8,
    #[arg(
        long = "quickGames",
        alias = "quick-games",
        default_value_t = TrainerOptions::DEFAULT_QUICK_GAMES
    )]
    quick_games: usize,
    #[arg(
        long = "quickHttpGames",
        alias = "quick-http-games",
        default_value_t = TrainerOptions::DEFAULT_QUICK_HTTP_GAMES
    )]
    quick_http_games: usize,
    #[arg(
        long = "quickSelfGames",
        alias = "quick-self-games",
        default_value_t = TrainerOptions::DEFAULT_QUICK_SELF_GAMES
    )]
    quick_self_games: usize,
    #[arg(
        long = "quickTurnRatio",
        alias = "quick-turn-ratio",
        default_value_t = TrainerOptions::DEFAULT_QUICK_TURN_RATIO
    )]
    quick_turn_ratio: f64,
    #[arg(
        long = "refineTopFrac",
        alias = "refine-top-frac",
        default_value_t = TrainerOptions::DEFAULT_REFINE_TOP_FRAC
    )]
    refine_top_frac: f64,
    #[arg(
        long = "validationGames",
        alias = "validation-games",
        default_value_t = TrainerOptions::DEFAULT_VALIDATION_GAMES
    )]
    validation_games: usize,
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_PROGRESS)]
    progress: usize,
    #[arg(
        long = "progressEvery",
        alias = "progress-every",
        default_value_t = TrainerOptions::DEFAULT_PROGRESS_EVERY
    )]
    progress_every: usize,
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_SEED)]
    seed: u64,
    #[arg(long, default_value_t = TrainerOptions::DEFAULT_VERIFY_FLAG)]
    verify: u8,
    #[arg(
        long = "verifyDepths",
        alias = "verify-depths",
        default_value = TrainerOptions::DEFAULT_VERIFY_DEPTHS_RAW
    )]
    verify_depths: String,
    #[arg(
        long = "verifyMaxAttempts",
        alias = "verify-max-attempts",
        default_value_t = TrainerOptions::DEFAULT_VERIFY_MAX_ATTEMPTS
    )]
    verify_max_attempts: usize,
    #[arg(long = "list-opponents", alias = "listOpponents", short = 'L', action = ArgAction::SetTrue)]
    list_opponents: bool,
    #[arg(
        long = "httpApi",
        alias = "http-api",
        default_value = TrainerOptions::DEFAULT_HTTP_API_RAW
    )]
    http_api: String,
    #[arg(
        long = "legacyHttp",
        alias = "legacy-http",
        default_value_t = TrainerOptions::DEFAULT_LEGACY_HTTP_FLAG
    )]
    legacy_http: u8,
    #[arg(long)]
    resume: Option<PathBuf>,
    #[arg(long)]
    checkpoint: Option<PathBuf>,
}

impl TrainerCliArgs {
    fn into_runtime(self, base_cfg: AiConfig, rust_root: &Path) -> (AiConfig, TrainerOptions) {
        let games = self.games;
        let http_games_raw = self.http_games;
        let options = TrainerOptions {
            pop: self.pop,
            gens: self.gens,
            elite: self.elite,
            games,
            depth: self.depth,
            width: self.width,
            height: self.height,
            max_turns: self.max_turns,
            mut_rate: self.mut_rate,
            mut_strength: self.mut_strength,
            tourney: self.tourney,
            seed: self.seed,
            save: self.save.or_else(|| Some(rust_root.join("data").join("ga_results.json"))),
            opponents: if self.opponent.is_empty() {
                vec![TrainerOptions::DEFAULT_OPPONENT.to_owned()]
            } else {
                self.opponent
            },
            only_http: boolish(self.only_http),
            http_games: if http_games_raw == 0 { games } else { http_games_raw },
            self_play: boolish(self.self_play),
            self_games: self.self_games,
            self_every: self.self_every,
            self_recent: self.self_recent,
            self_hof: self.self_hof,
            self_max_pool: self.self_max_pool,
            staged_eval: boolish(self.staged_eval),
            quick_games: self.quick_games,
            quick_http_games: self.quick_http_games,
            quick_self_games: self.quick_self_games,
            quick_turn_ratio: self.quick_turn_ratio,
            refine_top_frac: self.refine_top_frac,
            validation_games: self.validation_games,
            progress: self.progress,
            progress_every: self.progress_every,
            verify: boolish(self.verify),
            verify_depths: parse_depths(&self.verify_depths),
            verify_max_attempts: self.verify_max_attempts,
            http_api_mode: normalize_api_type(Some(self.http_api.as_str())),
            legacy_http: boolish(self.legacy_http),
            resume: self.resume,
            checkpoint: self.checkpoint,
        };

        let mut cfg = base_cfg;
        cfg.max_depth = options.depth.max(1);

        (cfg, options)
    }
}

fn rust_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn boolish(v: u8) -> bool {
    v != 0
}

fn apply_runtime_config(cfg: &mut AiConfig, runtime: &RuntimeCliArgs) {
    cfg.runtime.threads = runtime.threads;
    cfg.runtime.hash_mb = runtime.hash_mb;
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .with_target(false)
        .compact()
        .init();

    let cli = Cli::parse();
    let command = cli.command.unwrap_or(Command::Gui);
    let mut base_cfg = AiConfig::default();
    apply_runtime_config(&mut base_cfg, &cli.runtime);

    match command {
        Command::Gui => run_gui(base_cfg)?,
        Command::Server { host, port, debug_perf } => {
            base_cfg.debug_logging = debug_perf;

            let addr = SocketAddr::from_str(&format!("{host}:{port}"))?;
            let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
            rt.block_on(run_server(addr, base_cfg))?;
        }
        Command::Test(args) => {
            base_cfg.debug_logging = args.debug_perf;

            let rust_root = rust_root();
            let options = args.into_runtime(&rust_root);
            let summary = run_regression_suite(base_cfg, options)?;
            if summary.failed > 0 {
                std::process::exit(1);
            }
        }
        Command::Arena(args) => {
            let rust_root = rust_root();
            let options = args.into_runtime(&rust_root);
            let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
            let summary = rt.block_on(run_arena_with_progress(base_cfg, options, |progress| {
                print!("\r{}", format_arena_progress_line(&progress));
                let _ = io::stdout().flush();
            }))?;
            println!();
            println!("{}", format_arena_summary_report(&summary));
        }
        Command::Trainer(args) => {
            if args.list_opponents {
                println!("{}", format_opponent_roster());
                return Ok(());
            }

            let rust_root = rust_root();
            let (cfg, options) = args.into_runtime(base_cfg, &rust_root);
            let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
            let summary = rt.block_on(run_trainer(cfg, options))?;
            println!(
                "Trainer summary: best_fitness={:.3} generation={}",
                summary.best_fitness, summary.best_generation
            );
        }
    }

    Ok(())
}
