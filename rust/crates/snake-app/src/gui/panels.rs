use std::time::Instant;

use eframe::egui::{self, Color32, RichText};
use snake_api::ApiFlavor;
use snake_domain::Direction;

use crate::services::{
    ArenaOptions, ArenaSummary, RegressionOptions, TrainerOptions, parse_arena_find_modes, parse_depths, run_arena_with_progress,
    run_regression_suite, run_trainer,
};

use super::state::{EditMode, SnakeGuiApp, Tab, WorkerMessage};

impl SnakeGuiApp {
    pub(super) fn draw_top_panel(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("top").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.heading(RichText::new("Snake Lab Rust").size(20.0).color(Color32::from_rgb(210, 235, 255)));
                ui.label("Native GUI, shared core services");
                if self.worker_running {
                    ui.separator();
                    ui.colored_label(Color32::from_rgb(248, 211, 71), format!("Running: {}", self.worker_label));
                }
            });
            ui.separator();
            ui.horizontal(|ui| {
                for (tab, label) in [
                    (Tab::Playground, "Playground"),
                    (Tab::Regression, "Regression"),
                    (Tab::Arena, "Arena"),
                    (Tab::Trainer, "Trainer"),
                    (Tab::Server, "Server"),
                ] {
                    let selected = self.tab == tab;
                    if ui.selectable_label(selected, label).clicked() {
                        self.tab = tab;
                    }
                }
            });
        });
    }

    pub(super) fn draw_logs_panel(&mut self, ctx: &egui::Context) {
        egui::SidePanel::right("logs")
            .resizable(true)
            .default_width(320.0)
            .min_width(260.0)
            .show(ctx, |ui| {
                ui.heading("Logs");
                ui.separator();
                if self.worker_running {
                    ui.label(format!("Task: {}", self.worker_label));
                } else {
                    ui.label("Task: idle");
                }
                ui.separator();
                ui.add(
                    egui::TextEdit::multiline(&mut self.logs)
                        .desired_rows(32)
                        .font(egui::TextStyle::Monospace),
                );
            });
    }

    pub(super) fn draw_central_panel(&mut self, ctx: &egui::Context) {
        egui::CentralPanel::default().show(ctx, |ui| match self.tab {
            Tab::Playground => self.show_playground_tab(ui),
            Tab::Regression => self.show_regression_tab(ui),
            Tab::Arena => self.show_arena_tab(ui),
            Tab::Trainer => self.show_trainer_tab(ui),
            Tab::Server => self.show_server_tab(ui),
        });
    }

    fn show_playground_tab(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.label("Scenario JSON:");
            ui.text_edit_singleline(&mut self.scenario_load_path);
            if ui.button("Load").clicked() {
                self.load_scenario_from_path();
            }
            if let Some(err) = &self.load_error {
                ui.colored_label(Color32::RED, err);
            }
        });
        ui.separator();

        let s1 = self.sim_state.board.snakes.iter().find(|s| s.id.0 == "s1");
        let s2 = self.sim_state.board.snakes.iter().find(|s| s.id.0 == "s2");
        ui.horizontal(|ui| {
            ui.label(
                RichText::new(format!(
                    "P1 HP {} Len {}",
                    s1.map(|s| s.health).unwrap_or(0),
                    s1.map(|s| s.body.len()).unwrap_or(0)
                ))
                .color(Color32::from_rgb(79, 202, 255)),
            );
            ui.separator();
            ui.label(
                RichText::new(format!(
                    "AI HP {} Len {}",
                    s2.map(|s| s.health).unwrap_or(0),
                    s2.map(|s| s.body.len()).unwrap_or(0)
                ))
                .color(Color32::from_rgb(255, 108, 150)),
            );
            ui.separator();
            ui.label(format!("Turn {}", self.sim_state.turn));
            ui.separator();
            ui.label(format!("Depth {}", self.playground_depth));
            ui.separator();
            ui.label(format!("Last Move {:.2}ms", self.last_move_ms));
            ui.separator();
            ui.label(format!("Buffer {}", self.player_input_queue.len()));
        });
        ui.separator();

        ui.horizontal(|ui| {
            if ui.button("Evaluate AI").clicked() {
                self.evaluate_ai();
            }
            if ui.button("Step (Space)").clicked() {
                self.step_playground();
            }
            if ui.button(if self.auto_run { "Stop Auto" } else { "Auto Run" }).clicked() {
                self.auto_run = !self.auto_run;
                if self.auto_run {
                    self.last_auto_tick = Instant::now();
                }
            }
            if ui.button("Reset").clicked() {
                self.reset_playground();
            }
            ui.separator();
            ui.label("AI depth");
            ui.add(egui::DragValue::new(&mut self.playground_depth).range(1..=64));
            ui.separator();
            egui::ComboBox::from_id_salt("player_dir")
                .selected_text(self.player_dir.as_upper())
                .show_ui(ui, |ui| {
                    for dir in Direction::ALL {
                        if ui.selectable_label(self.player_dir == dir, dir.as_upper()).clicked() {
                            if self.auto_run {
                                self.queue_player_input(dir);
                            } else {
                                self.set_player_dir(dir);
                            }
                        }
                    }
                });
            ui.label("Player direction");
        });

        ui.horizontal(|ui| {
            let mode_btn = |ui: &mut egui::Ui, label: &str, mode: EditMode, current: EditMode| ui.selectable_label(current == mode, label);
            if mode_btn(ui, "Paint P1", EditMode::PaintP1, self.edit_mode).clicked() {
                self.edit_mode = EditMode::PaintP1;
            }
            if mode_btn(ui, "Paint AI", EditMode::PaintAi, self.edit_mode).clicked() {
                self.edit_mode = EditMode::PaintAi;
            }
            if mode_btn(ui, "Place Food", EditMode::Food, self.edit_mode).clicked() {
                self.edit_mode = EditMode::Food;
            }
            if mode_btn(ui, "Erase", EditMode::Erase, self.edit_mode).clicked() {
                self.edit_mode = EditMode::Erase;
            }
        });

        if !self.pv_line.is_empty() {
            let max_turns = self.pv_line.len() / 2;
            
            ui.separator();
            ui.horizontal(|ui| {
                ui.label(format!("Projected Turns (max {}):", max_turns));
                
                if ui.button("<<").clicked() { self.pv_index = 0; }
                if ui.button("<").clicked() { self.pv_index = self.pv_index.saturating_sub(1); }
                
                ui.add(egui::DragValue::new(&mut self.pv_index).range(0..=max_turns));
                
                if ui.button(">").clicked() { self.pv_index = (self.pv_index + 1).min(max_turns); }
                if ui.button(">>").clicked() { self.pv_index = max_turns; }
            });

            let mut moves_str = String::new();
            for (i, chunk) in self.pv_line.chunks(2).take(6).enumerate() {
                if chunk.len() == 2 {
                    if i > 0 { moves_str.push_str(" | "); }
                    moves_str.push_str(&format!("{} vs {}", chunk[0].as_upper(), chunk[1].as_upper()));
                }
            }
            if self.pv_line.len() / 2 > 6 {
                moves_str.push_str(" ...");
            }
            ui.label(format!("PV: {}", moves_str));
        }

        ui.separator();
        self.draw_playground_board(ui);
    }

    fn show_regression_tab(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.label("Scenario dir:");
            ui.text_edit_singleline(&mut self.scenario_dir);
        });
        ui.horizontal(|ui| {
            ui.label("Depths:");
            ui.text_edit_singleline(&mut self.depths);
        });
        let run_btn = ui.add_enabled(!self.worker_running, egui::Button::new("Run Regression"));
        if run_btn.clicked() {
            let depths = parse_depths(&self.depths);
            let cfg = self.cfg.clone();
            let scenario_dir = self.scenario_dir.clone();
            self.start_worker("regression", move |tx| {
                let result = run_regression_suite(
                    cfg,
                    RegressionOptions {
                        scenario_dir: scenario_dir.into(),
                        depths,
                        quiet: true,
                        quiet_fail_only: true,
                    },
                )
                .map_err(|e| e.to_string());
                let _ = tx.send(WorkerMessage::Regression(result));
            });
        }
    }

    fn show_arena_tab(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.label("Games");
            ui.add(egui::DragValue::new(&mut self.arena_games).range(1..=1000));
            ui.label("Seed");
            ui.add(egui::DragValue::new(&mut self.arena_seed));
        });
        ui.horizontal(|ui| {
            ui.label("Opponent");
            ui.text_edit_singleline(&mut self.arena_opponent);
            ui.checkbox(&mut self.arena_self_play, "Self play");
        });
        ui.horizontal(|ui| {
            ui.label("Find");
            ui.text_edit_singleline(&mut self.arena_find_modes);
            ui.checkbox(&mut self.arena_only_loss, "Only loss");
            ui.checkbox(&mut self.arena_resume, "Resume");
        });
        ui.horizontal(|ui| {
            ui.label("Snapshot file");
            ui.text_edit_singleline(&mut self.arena_snapshot_file);
            ui.label("Ticks");
            ui.add(egui::DragValue::new(&mut self.arena_snapshot_ticks).range(1..=500));
        });
        ui.separator();
        if let Some(progress) = &self.arena_progress {
            ui.colored_label(
                Color32::from_rgb(248, 211, 71),
                format!(
                    "Running {}/{} | local={} opponent={} draws={} | win {:.2}% | avg turns {:.2}",
                    progress.completed_games,
                    progress.total_games,
                    progress.wins_local,
                    progress.wins_opponent,
                    progress.draws,
                    progress.local_win_rate,
                    progress.avg_turns
                ),
            );
            ui.label(format!(
                "Last game seed={} turns={} winner={} elapsed={}ms",
                progress.last_seed, progress.last_turns, progress.last_winner, progress.elapsed_ms
            ));
            ui.separator();
        } else if self.worker_running && self.worker_label == "arena" {
            ui.colored_label(Color32::from_rgb(248, 211, 71), "Arena run starting...");
            ui.separator();
        }

        let run_btn = ui.add_enabled(!self.worker_running, egui::Button::new("Run Arena"));
        if run_btn.clicked() {
            let cfg = self.cfg.clone();
            self.arena_progress = None;
            self.arena_summary = None;
            let find_tokens = if self.arena_find_modes.trim().is_empty() {
                Vec::new()
            } else {
                vec![self.arena_find_modes.clone()]
            };
            let (find_modes, invalid_find_modes) = parse_arena_find_modes(&find_tokens);
            let opts = ArenaOptions {
                games: self.arena_games,
                seed: self.arena_seed,
                width: 16,
                height: 9,
                max_turns: 2000,
                opponent: self.arena_opponent.clone(),
                self_play: self.arena_self_play,
                api_flavor: ApiFlavor::Auto,
                request_timeout_ms: 700,
                find_modes,
                invalid_find_modes,
                only_loss: self.arena_only_loss,
                resume: self.arena_resume,
                snapshot_file: self.arena_snapshot_file.clone().into(),
                snapshot_ticks: self.arena_snapshot_ticks.max(1),
            };
            self.start_worker("arena", move |tx| {
                let tx_progress = tx.clone();
                let result = Self::run_async_job(run_arena_with_progress(cfg, opts, move |progress| {
                    let _ = tx_progress.send(WorkerMessage::ArenaProgress(progress));
                }));
                let _ = tx.send(WorkerMessage::Arena(result));
            });
        }

        if let Some(summary) = &self.arena_summary {
            ui.separator();
            let snapshot = summary.clone();
            egui::ScrollArea::vertical()
                .id_salt("arena_summary_scroll")
                .show(ui, |ui| self.draw_arena_summary(ui, &snapshot));
        }
    }

    fn show_trainer_tab(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.label("Pop");
            ui.add(egui::DragValue::new(&mut self.trainer_pop).range(2..=300));
            ui.label("Gens");
            ui.add(egui::DragValue::new(&mut self.trainer_gens).range(1..=1000));
            ui.label("Games");
            ui.add(egui::DragValue::new(&mut self.trainer_games).range(1..=100));
        });
        ui.horizontal(|ui| {
            ui.label("Seed");
            ui.add(egui::DragValue::new(&mut self.trainer_seed));
        });
        let run_btn = ui.add_enabled(!self.worker_running, egui::Button::new("Run Trainer"));
        if run_btn.clicked() {
            let cfg = self.cfg.clone();
            let opts = TrainerOptions::for_gui(
                self.trainer_pop,
                self.trainer_gens,
                self.trainer_games,
                self.trainer_seed,
                self.cfg.max_depth,
            );
            self.start_worker("trainer", move |tx| {
                let result = Self::run_async_job(run_trainer(cfg, opts));
                let _ = tx.send(WorkerMessage::Trainer(result));
            });
        }
    }

    fn show_server_tab(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.label("Bind");
            ui.text_edit_singleline(&mut self.server_addr);
        });
        ui.horizontal(|ui| {
            let running = self.server_handle.is_some();
            if !running {
                if ui.button("Start server").clicked() {
                    self.start_server();
                }
            } else if ui.button("Stop server").clicked() {
                self.stop_server();
            }
            ui.label(if running { "Running" } else { "Stopped" });
        });
    }

    fn draw_arena_summary(&self, ui: &mut egui::Ui, summary: &ArenaSummary) {
        ui.heading("Arena Summary");
        ui.label(format!(
            "Results: local={} opponent={} draws={} total={}",
            summary.wins_local, summary.wins_opponent, summary.draws, summary.total_games
        ));
        ui.label(format!(
            "Rates: local={:.2}% opponent={:.2}% draw={:.2}%",
            summary.local_win_rate, summary.opponent_win_rate, summary.draw_rate
        ));
        ui.label(format!(
            "Averages: turns={:.2} local_len={:.2} opponent_len={:.2} duration={}ms",
            summary.avg_turns, summary.avg_local_length, summary.avg_opponent_length, summary.duration_ms
        ));
        if let Some(shortest) = &summary.shortest_turn_game {
            ui.label(format!("Shortest game: {} turns (seed {})", shortest.turns, shortest.seed));
        }
        if let Some(longest) = &summary.longest_turn_game {
            ui.label(format!("Longest game: {} turns (seed {})", longest.turns, longest.seed));
        }

        ui.separator();
        ui.label("Death Analysis");
        egui::Grid::new("arena_death_grid").num_columns(5).striped(true).show(ui, |ui| {
            ui.label("");
            ui.label("Starvation");
            ui.label("Wall");
            ui.label("Body");
            ui.label("Head");
            ui.end_row();

            ui.label("Local");
            ui.label(summary.death_stats.local.starvation.to_string());
            ui.label(summary.death_stats.local.wall.to_string());
            ui.label(summary.death_stats.local.body.to_string());
            ui.label(summary.death_stats.local.head.to_string());
            ui.end_row();

            ui.label("Opponent");
            ui.label(summary.death_stats.opponent.starvation.to_string());
            ui.label(summary.death_stats.opponent.wall.to_string());
            ui.label(summary.death_stats.opponent.body.to_string());
            ui.label(summary.death_stats.opponent.head.to_string());
            ui.end_row();
        });

        ui.separator();
        ui.label("Turn Distribution");
        egui::Grid::new("arena_turn_dist").num_columns(3).striped(true).show(ui, |ui| {
            ui.label("Turns");
            ui.label("Count");
            ui.label("%");
            ui.end_row();
            for bin in &summary.turn_distribution {
                ui.label(&bin.label);
                ui.label(bin.count.to_string());
                ui.label(format!("{:.2}", bin.percent));
                ui.end_row();
            }
        });

        ui.separator();
        ui.label("Length Distribution");
        egui::Grid::new("arena_len_dist").num_columns(5).striped(true).show(ui, |ui| {
            ui.label("Length");
            ui.label("Local");
            ui.label("Local %");
            ui.label("Opponent");
            ui.label("Opponent %");
            ui.end_row();
            for (local, opponent) in summary
                .local_length_distribution
                .iter()
                .zip(summary.opponent_length_distribution.iter())
            {
                ui.label(&local.label);
                ui.label(local.count.to_string());
                ui.label(format!("{:.2}", local.percent));
                ui.label(opponent.count.to_string());
                ui.label(format!("{:.2}", opponent.percent));
                ui.end_row();
            }
        });

        if !summary.find_results.is_empty() {
            ui.separator();
            ui.label("Find Results");
            for found in &summary.find_results {
                ui.label(format!("{}: {} (winner: {})", found.mode_title, found.metric_label, found.winner));
                ui.label(format!("Reproduce: {}", found.reproduce_hint));
                if let Some(resume) = &found.resume_hint {
                    ui.label(format!("Resume: {}", resume));
                }
            }
        }
    }
}
