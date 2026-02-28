use std::{
    io::IsTerminal,
    path::{Path, PathBuf},
    time::Instant,
};

use anyhow::{Context, Result};
use serde::Serialize;
use snake_ai::{AiConfig, decide_move_debug};
use snake_io::{Expectation, load_scenarios_from_dir};

#[derive(Debug, Clone)]
pub struct RegressionOptions {
    pub scenario_dir: PathBuf,
    pub depths: Vec<usize>,
    pub quiet: bool,
    pub quiet_fail_only: bool,
}

impl RegressionOptions {
    pub const DEFAULT_DEPTHS_RAW: &'static str = "6";
    pub const DEFAULT_QUIET: bool = false;
    pub const DEFAULT_QUIET_FAIL_ONLY: bool = false;
}

#[derive(Debug, Clone, Serialize)]
pub struct DepthResult {
    pub depth: usize,
    pub passed: usize,
    pub failed: usize,
    pub skipped: usize,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
pub struct RegressionSummary {
    pub passed: usize,
    pub failed: usize,
    pub skipped: usize,
    pub scenarios: usize,
    pub by_depth: Vec<DepthResult>,
    pub duration_ms: u128,
}

pub fn run_regression_suite(mut cfg: AiConfig, options: RegressionOptions) -> Result<RegressionSummary> {
    let scenarios = load_scenarios_from_dir(&options.scenario_dir)
        .with_context(|| format!("failed to load scenarios from {}", options.scenario_dir.display()))?;
    let depths = if options.depths.is_empty() {
        vec![cfg.max_depth]
    } else {
        options.depths
    };

    let mut summary = RegressionSummary {
        passed: 0,
        failed: 0,
        skipped: 0,
        scenarios: scenarios.len(),
        by_depth: Vec::new(),
        duration_ms: 0,
    };
    let started = Instant::now();

    if !options.quiet {
        println!(
            "\nRUNNING RUST REGRESSION SUITE ({} scenarios)\nDepths: {}\n",
            scenarios.len(),
            depths.iter().map(|d| d.to_string()).collect::<Vec<_>>().join(", ")
        );
    }

    for depth in depths {
        if !options.quiet {
            println!("=== DEPTH {depth} ===");
        }
        cfg.max_depth = depth;
        let depth_started = Instant::now();
        let mut passed = 0usize;
        let mut failed = 0usize;
        let mut skipped = 0usize;

        for named in &scenarios {
            let scenario = &named.scenario;
            let Some((me, enemy, food, cols, rows)) = scenario.into_ai_inputs() else {
                skipped += 1;
                continue;
            };
            let decision = decide_move_debug(me, enemy, food, cols, rows, &cfg);
            let pass = scenario.expectation.passes(decision.best_move);
            let file_name = short_scenario_name(&named.file);
            if pass {
                passed += 1;
                if !options.quiet && !options.quiet_fail_only {
                    println!("PASS {file_name} -> {}", decision.best_move.as_lower());
                }
            } else {
                failed += 1;
                if !options.quiet || options.quiet_fail_only {
                    println!("DEBUG: Root Moves for {}:", file_name);
                    for child in &decision.root_children {
                        println!(
                            "  - {:?}: Score: {:.2}, Recursive: {:.2}, Penalty: {:.2}, Ate: {}",
                            child.mv.dir, child.modified_score, child.raw_recursion_score, child.collision_penalty, child.ate
                        );
                    }

                    let pv_str = decision.pv.iter().take(12).map(|d| d.as_upper()).collect::<Vec<_>>().join(" -> ");
                    println!("  PV: {}", pv_str);

                    println!(
                        "{} {file_name}: expected {}, got {}.",
                        colorize_red("FAIL"),
                        concise_expectation(&scenario.expectation),
                        decision.best_move.as_lower(),
                    );
                }
            }
        }

        summary.passed += passed;
        summary.failed += failed;
        summary.skipped += skipped;
        summary.by_depth.push(DepthResult {
            depth,
            passed,
            failed,
            skipped,
            duration_ms: depth_started.elapsed().as_millis(),
        });

        if !options.quiet {
            println!(
                "Depth {depth} summary: pass={passed} fail={failed} skipped={skipped} time={}ms\n",
                summary.by_depth.last().map(|r| r.duration_ms).unwrap_or(0)
            );
        }
    }

    summary.duration_ms = started.elapsed().as_millis();
    if !options.quiet {
        println!("--- RESULTS ---");
        println!("Passed:  {}", summary.passed);
        println!("Failed:  {}", summary.failed);
        println!("Skipped: {}", summary.skipped);
        println!("--- TIME BY DEPTH ---");
        for result in &summary.by_depth {
            println!("Depth {}: {}ms", result.depth, result.duration_ms);
        }
        println!("Total:   {}ms", summary.duration_ms);
    }
    Ok(summary)
}

fn short_scenario_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn concise_expectation(expectation: &Expectation) -> String {
    match expectation {
        Expectation::Exact { direction } => direction.as_lower().to_owned(),
        Expectation::Avoid { directions } => format!(
            "not {}",
            directions
                .iter()
                .map(|direction| direction.as_lower())
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

fn colorize_red(text: &str) -> String {
    if std::env::var_os("NO_COLOR").is_some() || !std::io::stdout().is_terminal() {
        text.to_owned()
    } else {
        format!("\x1b[31m{text}\x1b[0m")
    }
}
