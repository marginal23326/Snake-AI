use std::time::Instant;

use eframe::egui::{self, Color32, Stroke, Vec2};
use snake_ai::{AgentState, decide_move_debug};
use snake_domain::{Direction, Point, SimConfig, SnakeId, simulate_turn};

use super::state::{EditMode, SnakeGuiApp, Tab};
use crate::services::build_playground_state;

impl SnakeGuiApp {
    pub(super) fn reset_playground(&mut self) {
        let (state, rng) = build_playground_state(self.sim_state.board.width, self.sim_state.board.height, 1);
        self.sim_state = state;
        self.sim_rng = rng;
        self.player_input_queue.clear();
        self.player_dir = Direction::Up;
        self.last_move_ms = 0.0;
        self.pv_line.clear();
        self.pv_index = 0;
    }

    fn is_opposite(a: Direction, b: Direction) -> bool {
        matches!(
            (a, b),
            (Direction::Up, Direction::Down)
                | (Direction::Down, Direction::Up)
                | (Direction::Left, Direction::Right)
                | (Direction::Right, Direction::Left)
        )
    }

    pub(super) fn set_player_dir(&mut self, dir: Direction) {
        let Some(player) = self.sim_state.board.snakes.iter().find(|s| s.id.0 == "s1").cloned() else {
            self.player_dir = dir;
            return;
        };

        if player.body.len() > 1 {
            let head = player.body[0];
            let neck = player.body[1];
            let blocked = (head.x + dir.vector().0 == neck.x) && (head.y + dir.vector().1 == neck.y);
            if blocked {
                return;
            }
        }
        self.player_input_queue.clear();
        self.player_dir = dir;
    }

    pub(super) fn queue_player_input(&mut self, dir: Direction) {
        let last = self.player_input_queue.back().copied().unwrap_or(self.player_dir);
        if dir == last || Self::is_opposite(dir, last) {
            return;
        }
        if self.player_input_queue.len() < 2 {
            self.player_input_queue.push_back(dir);
        }
    }

    pub(super) fn evaluate_ai(&mut self) {
        let s1 = self.sim_state.board.snakes.iter().find(|s| s.id.0 == "s1").cloned();
        let s2 = self.sim_state.board.snakes.iter().find(|s| s.id.0 == "s2").cloned();
        let (Some(s1), Some(s2)) = (s1, s2) else {
            return;
        };
        if !s1.alive || !s2.alive {
            return;
        }

        let mut playground_cfg = self.cfg.clone();
        playground_cfg.max_depth = self.playground_depth.max(1);
        let started = Instant::now();
        let ai_decision = decide_move_debug(
            AgentState {
                body: snake_ai::model::FastBody::from_vec(&s2.body),
                health: s2.health,
            },
            AgentState {
                body: snake_ai::model::FastBody::from_vec(&s1.body),
                health: s1.health,
            },
            self.sim_state.board.food.clone(),
            self.sim_state.board.width,
            self.sim_state.board.height,
            &playground_cfg,
        );
        self.last_move_ms = started.elapsed().as_secs_f64() * 1000.0;
        self.pv_line = ai_decision.pv;
        self.pv_index = 0;
    }

    pub(super) fn step_playground(&mut self) {
        self.pv_line.clear();
        self.pv_index = 0;

        let s1 = self.sim_state.board.snakes.iter().find(|s| s.id.0 == "s1").cloned();
        let s2 = self.sim_state.board.snakes.iter().find(|s| s.id.0 == "s2").cloned();
        let (Some(s1), Some(s2)) = (s1, s2) else {
            return;
        };
        if !s1.alive || !s2.alive {
            return;
        }

        if let Some(next) = self.player_input_queue.pop_front() {
            self.player_dir = next;
        }

        let mut playground_cfg = self.cfg.clone();
        playground_cfg.max_depth = self.playground_depth.max(1);
        let started = Instant::now();
        let ai_decision = decide_move_debug(
            AgentState {
                body: snake_ai::model::FastBody::from_vec(&s2.body),
                health: s2.health,
            },
            AgentState {
                body: snake_ai::model::FastBody::from_vec(&s1.body),
                health: s1.health,
            },
            self.sim_state.board.food.clone(),
            self.sim_state.board.width,
            self.sim_state.board.height,
            &playground_cfg,
        );
        self.last_move_ms = started.elapsed().as_secs_f64() * 1000.0;

        let intents = vec![
            (SnakeId("s1".to_owned()), self.player_dir),
            (SnakeId("s2".to_owned()), ai_decision.best_move),
        ];
        let summary = simulate_turn(&mut self.sim_state, &intents, &mut self.sim_rng, SimConfig::default());
        if !summary.dead.is_empty() {
            self.log_line(format!("Turn {} deaths: {:?}", summary.turn, summary.dead));
        }
    }

    pub(super) fn process_playground_keys(&mut self, ctx: &egui::Context) {
        if self.tab != Tab::Playground || ctx.wants_keyboard_input() {
            return;
        }

        let mut requested = None;
        let mut step_now = false;
        ctx.input(|i| {
            if i.key_pressed(egui::Key::Space) {
                step_now = true;
            } else if i.key_pressed(egui::Key::W) || i.key_pressed(egui::Key::ArrowUp) {
                requested = Some(Direction::Up);
            } else if i.key_pressed(egui::Key::S) || i.key_pressed(egui::Key::ArrowDown) {
                requested = Some(Direction::Down);
            } else if i.key_pressed(egui::Key::A) || i.key_pressed(egui::Key::ArrowLeft) {
                requested = Some(Direction::Left);
            } else if i.key_pressed(egui::Key::D) || i.key_pressed(egui::Key::ArrowRight) {
                requested = Some(Direction::Right);
            }
        });

        if step_now {
            self.step_playground();
            return;
        }

        if let Some(dir) = requested {
            if self.auto_run {
                self.queue_player_input(dir);
            } else {
                self.set_player_dir(dir);
            }
        }
    }

    pub(super) fn load_scenario_from_path(&mut self) {
        self.load_error = None;
        let path = std::path::Path::new(&self.scenario_load_path);
        let json_str = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                self.load_error = Some(format!("File error: {}", e));
                return;
            }
        };
        let v: serde_json::Value = match serde_json::from_str(&json_str) {
            Ok(v) => v,
            Err(e) => {
                self.load_error = Some(format!("JSON err: {}", e));
                return;
            }
        };

        if let Some(state) = Self::parse_scenario_to_state(&v) {
            self.sim_state = state;
            self.pv_line.clear();
            self.pv_index = 0;
            self.load_error = None;
            self.log_line(format!("Loaded scenario: {}", path.display()));
        } else {
            self.load_error = Some("Failed to parse scenario JSON".to_owned());
        }
    }

    fn parse_scenario_to_state(json: &serde_json::Value) -> Option<snake_domain::GameState> {
        let board = json.get("board")?;
        let width = board.get("width")?.as_i64()? as i32;
        let height = board.get("height")?.as_i64()? as i32;

        let mut food = Vec::new();
        if let Some(f_arr) = board.get("food").and_then(|v| v.as_array()) {
            for f in f_arr {
                let x = f.get("x")?.as_i64()? as i32;
                let y = f.get("y")?.as_i64()? as i32;
                food.push(Point { x, y });
            }
        }

        let mut snakes = Vec::new();
        if let Some(s_arr) = board.get("snakes").and_then(|v| v.as_array()) {
            for (i, s) in s_arr.iter().enumerate() {
                let original_id = s.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let is_ai = original_id == "ai-snake-for-test" || i == 0;
                let new_id = if is_ai { "s2" } else { "s1" };

                let health = s.get("health").and_then(|v| v.as_i64()).unwrap_or(100) as i32;
                let mut body = Vec::new();
                if let Some(b_arr) = s.get("body").and_then(|v| v.as_array()) {
                    for b in b_arr {
                        let x = b.get("x")?.as_i64()? as i32;
                        let y = b.get("y")?.as_i64()? as i32;
                        body.push(Point { x, y });
                    }
                }
                snakes.push(snake_domain::Snake::new(new_id, new_id, body, health));
            }
        }

        Some(snake_domain::GameState {
            turn: 0,
            seed: 0,
            board: snake_domain::Board {
                width,
                height,
                food,
                snakes,
            },
        })
    }

    pub(super) fn get_projected_state(&self) -> snake_domain::GameState {
        let mut state = self.sim_state.clone();
        let mut rng = self.sim_rng.clone();
        let s1_id = SnakeId("s1".to_owned());
        let s2_id = SnakeId("s2".to_owned());

        let max_turns = self.pv_line.len() / 2;
        let turns_to_simulate = self.pv_index.min(max_turns);

        let mut p_idx = 0;
        for _ in 0..turns_to_simulate {
            let m_s2 = self.pv_line.get(p_idx).copied().unwrap_or(Direction::Up);
            let m_s1 = self.pv_line.get(p_idx + 1).copied().unwrap_or(Direction::Up);
            p_idx += 2;

            let intents = vec![(s2_id.clone(), m_s2), (s1_id.clone(), m_s1)];
            let _ = simulate_turn(&mut state, &intents, &mut rng, SimConfig::default());
        }

        state
    }

    fn get_line_path(from: (i32, i32), to: (i32, i32)) -> Vec<(i32, i32)> {
        let mut path = vec![from];
        let (mut cx, mut cy) = from;
        while cx != to.0 || cy != to.1 {
            let dx = (to.0 - cx).signum();
            let dy = (to.1 - cy).signum();
            if dx != 0 {
                cx += dx;
            } else if dy != 0 {
                cy += dy;
            }
            path.push((cx, cy));
        }
        path
    }

    fn sync_snake_state_after_edit(&mut self) {
        for snake in &mut self.sim_state.board.snakes {
            snake.alive = !snake.body.is_empty();
            if snake.alive && snake.health <= 0 {
                snake.health = 100;
            }
            if !snake.alive {
                snake.health = 0;
            }
        }
    }

    fn apply_edit_cell(&mut self, x: i32, y: i32, is_new_stroke: bool) {
        match self.edit_mode {
            EditMode::Erase => {
                self.sim_state.board.food.retain(|f| f.x != x || f.y != y);
                for snake in &mut self.sim_state.board.snakes {
                    snake.body.retain(|p| p.x != x || p.y != y);
                }
            }
            EditMode::Food => {
                if !self.sim_state.board.food.iter().any(|f| f.x == x && f.y == y) {
                    self.sim_state.board.food.push(Point { x, y });
                }
            }
            EditMode::PaintP1 | EditMode::PaintAi => {
                let target_id = if self.edit_mode == EditMode::PaintP1 { "s1" } else { "s2" };
                if let Some(snake) = self.sim_state.board.snakes.iter_mut().find(|s| s.id.0 == target_id) {
                    if is_new_stroke {
                        snake.body.clear();
                    }
                    if let Some(idx) = snake.body.iter().position(|p| p.x == x && p.y == y) {
                        snake.body.truncate(idx);
                    }
                    snake.body.push(Point { x, y });
                    snake.health = 100;
                    snake.alive = true;
                }
            }
        }
        self.sync_snake_state_after_edit();
    }

    fn pos_to_cell(pos: egui::Pos2, rect: egui::Rect, width: i32, height: i32, cell_w: f32, cell_h: f32) -> Option<(i32, i32)> {
        let x = ((pos.x - rect.left()) / cell_w).floor() as i32;
        let y_top = ((pos.y - rect.top()) / cell_h).floor() as i32;
        let y = height - 1 - y_top;
        if x < 0 || y < 0 || x >= width || y >= height {
            return None;
        }
        Some((x, y))
    }

    fn handle_board_input(&mut self, response: &egui::Response, rect: egui::Rect, width: i32, height: i32, cell_w: f32, cell_h: f32) {
        if response.clicked() || response.drag_started() {
            self.is_drawing = true;
            self.last_draw_cell = None;
        }

        let pointer_down = response.dragged() || response.is_pointer_button_down_on();
        if !pointer_down {
            self.is_drawing = false;
            self.last_draw_cell = None;
            return;
        }
        if !self.is_drawing {
            return;
        }

        let Some(pos) = response.interact_pointer_pos() else {
            return;
        };
        let Some((x, y)) = Self::pos_to_cell(pos, rect, width, height, cell_w, cell_h) else {
            return;
        };

        let cells = if let Some(prev) = self.last_draw_cell {
            if prev == (x, y) {
                Vec::new()
            } else {
                Self::get_line_path(prev, (x, y))
            }
        } else {
            vec![(x, y)]
        };

        if cells.is_empty() {
            return;
        }
        let is_new_stroke = self.last_draw_cell.is_none();
        for (idx, (cx, cy)) in cells.into_iter().enumerate() {
            self.apply_edit_cell(cx, cy, is_new_stroke && idx == 0);
        }
        self.last_draw_cell = Some((x, y));
    }

    pub(super) fn draw_playground_board(&mut self, ui: &mut egui::Ui) {
        let display_state = if self.pv_index > 0 {
            self.get_projected_state()
        } else {
            self.sim_state.clone()
        };

        let (width, height, food, snakes) = {
            let b = &display_state.board;
            (b.width, b.height, b.food.clone(), b.snakes.clone())
        };

        let desired = Vec2::new(ui.available_width(), ui.available_height().max(280.0));
        let (rect, response) = ui.allocate_exact_size(desired, egui::Sense::click_and_drag());
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 8.0, Color32::from_rgb(10, 14, 18));

        let cell_w = rect.width() / width as f32;
        let cell_h = rect.height() / height as f32;

        for x in 0..=width {
            let px = rect.left() + x as f32 * cell_w;
            painter.line_segment(
                [egui::pos2(px, rect.top()), egui::pos2(px, rect.bottom())],
                Stroke::new(1.0, Color32::from_rgb(28, 34, 40)),
            );
        }
        for y in 0..=height {
            let py = rect.top() + y as f32 * cell_h;
            painter.line_segment(
                [egui::pos2(rect.left(), py), egui::pos2(rect.right(), py)],
                Stroke::new(1.0, Color32::from_rgb(28, 34, 40)),
            );
        }

        for f in &food {
            let cx = rect.left() + (f.x as f32 + 0.5) * cell_w;
            let cy = rect.bottom() - (f.y as f32 + 0.5) * cell_h;
            painter.circle_filled(egui::pos2(cx, cy), cell_w.min(cell_h) * 0.32, Color32::from_rgb(248, 211, 71));
        }

        for snake in &snakes {
            let (body_col, head_col) = if snake.id.0 == "s1" {
                (Color32::from_rgb(58, 191, 255), Color32::from_rgb(210, 244, 255))
            } else {
                (Color32::from_rgb(255, 74, 120), Color32::from_rgb(255, 222, 230))
            };

            for i in (1..snake.body.len()).rev() {
                let a = snake.body[i];
                let b = snake.body[i - 1];
                let ap = egui::pos2(
                    rect.left() + (a.x as f32 + 0.5) * cell_w,
                    rect.bottom() - (a.y as f32 + 0.5) * cell_h,
                );
                let bp = egui::pos2(
                    rect.left() + (b.x as f32 + 0.5) * cell_w,
                    rect.bottom() - (b.y as f32 + 0.5) * cell_h,
                );
                painter.line_segment([ap, bp], Stroke::new(cell_w.min(cell_h) * 0.26, body_col));
            }

            for (idx, p) in snake.body.iter().enumerate() {
                let x = rect.left() + p.x as f32 * cell_w + 1.0;
                let y = rect.bottom() - (p.y as f32 + 1.0) * cell_h + 1.0;
                let r = egui::Rect::from_min_size(egui::pos2(x, y), Vec2::new(cell_w - 2.0, cell_h - 2.0));
                painter.rect_filled(r, 5.0, if idx == 0 { head_col } else { body_col });
            }
        }

        self.handle_board_input(&response, rect, width, height, cell_w, cell_h);
    }
}
