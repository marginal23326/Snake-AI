use std::time::{Duration, Instant};

use anyhow::{Result, anyhow};
use eframe::egui::{self, Color32, Vec2};

use super::state::SnakeGuiApp;

impl eframe::App for SnakeGuiApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        const AUTO_TICK_INTERVAL: Duration = Duration::from_millis(220);

        self.poll_worker(ctx);
        self.process_playground_keys(ctx);

        if self.auto_run {
            if self.last_auto_tick.elapsed() >= AUTO_TICK_INTERVAL {
                self.step_playground();
                self.last_auto_tick = Instant::now();
            }
            let until_next_tick = AUTO_TICK_INTERVAL.saturating_sub(self.last_auto_tick.elapsed());
            ctx.request_repaint_after(until_next_tick);
        }

        self.draw_top_panel(ctx);
        self.draw_logs_panel(ctx);
        self.draw_central_panel(ctx);
    }
}

pub fn run_gui() -> Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size(Vec2::new(1200.0, 700.0))
            .with_min_inner_size(Vec2::new(900.0, 600.0))
            .with_title("Snake Lab Rust"),
        ..Default::default()
    };

    eframe::run_native(
        "Snake Lab Rust",
        options,
        Box::new(|cc| {
            cc.egui_ctx.style_mut(|style| {
                style.visuals = egui::Visuals::dark();
                style.visuals.override_text_color = Some(Color32::from_rgb(214, 227, 240));
                style.visuals.panel_fill = Color32::from_rgb(16, 20, 24);
                style.visuals.extreme_bg_color = Color32::from_rgb(9, 12, 15);
                style.visuals.widgets.active.bg_fill = Color32::from_rgb(36, 90, 128);
                style.visuals.widgets.hovered.bg_fill = Color32::from_rgb(34, 56, 72);
            });
            Ok(Box::new(SnakeGuiApp::new()))
        }),
    )
    .map_err(|e| anyhow!(e.to_string()))?;
    Ok(())
}
