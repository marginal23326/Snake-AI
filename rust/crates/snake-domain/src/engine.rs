use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::{
    Direction, FoodSettings, GameState, Point, RngSource, Snake, SnakeId,
    apply_standard_food_spawning,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SimConfig {
    pub max_health: i32,
    pub food: FoodSettings,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            max_health: 100,
            food: FoodSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeathEvent {
    pub snake_id: SnakeId,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnSummary {
    pub turn: u32,
    pub dead: Vec<DeathEvent>,
    pub alive_ids: Vec<SnakeId>,
}

pub fn simulate_turn<R: RngSource>(
    state: &mut GameState,
    intents: &[(SnakeId, Direction)],
    rng: &mut R,
    cfg: SimConfig,
) -> TurnSummary {
    let mut intent_map = HashMap::new();
    for (id, dir) in intents {
        intent_map.insert(id.0.clone(), *dir);
    }

    let width = state.board.width;
    let height = state.board.height;

    for snake in &mut state.board.snakes {
        if !snake.alive || snake.body.is_empty() {
            snake.alive = false;
            continue;
        }

        let dir = intent_map
            .get(&snake.id.0)
            .copied()
            .unwrap_or(Direction::Up);
        let head = snake.body[0].moved(dir);
        snake.body.insert(0, head);

        if let Some(food_idx) = state
            .board
            .food
            .iter()
            .position(|f| f.x == head.x && f.y == head.y)
        {
            state.board.food.remove(food_idx);
            snake.health = cfg.max_health;
        } else {
            snake.body.pop();
            snake.health -= 1;
        }
    }

    state.turn += 1;

    let mut dead = Vec::new();
    let snapshot = state.board.snakes.clone();
    for (idx, snake) in snapshot.iter().enumerate() {
        if !snake.alive || snake.body.is_empty() {
            continue;
        }
        let head = snake.body[0];

        let out_of_bounds = head.x < 0 || head.y < 0 || head.x >= width || head.y >= height;
        if out_of_bounds {
            dead.push(DeathEvent {
                snake_id: snake.id.clone(),
                reason: "Wall".to_owned(),
            });
            continue;
        }
        if snake.health <= 0 {
            dead.push(DeathEvent {
                snake_id: snake.id.clone(),
                reason: "Starvation".to_owned(),
            });
            continue;
        }

        let mut body_hit = false;
        for other in &snapshot {
            for (part_idx, part) in other.body.iter().enumerate() {
                // Head-to-head is resolved separately, so head segments should
                // never count as body collisions.
                if part_idx == 0 {
                    continue;
                }
                if part.x == head.x && part.y == head.y {
                    body_hit = true;
                    break;
                }
            }
            if body_hit {
                break;
            }
        }
        if body_hit {
            dead.push(DeathEvent {
                snake_id: snake.id.clone(),
                reason: "Body".to_owned(),
            });
            continue;
        }

        let mut head_hit = false;
        for (other_idx, other) in snapshot.iter().enumerate() {
            if idx == other_idx || other.body.is_empty() {
                continue;
            }
            let other_head = other.body[0];
            if other_head.x == head.x
                && other_head.y == head.y
                && snake.body.len() <= other.body.len()
            {
                head_hit = true;
                break;
            }
        }
        if head_hit {
            dead.push(DeathEvent {
                snake_id: snake.id.clone(),
                reason: "Head".to_owned(),
            });
        }
    }

    if !dead.is_empty() {
        let dead_ids: HashMap<String, &str> = dead
            .iter()
            .map(|d| (d.snake_id.0.clone(), d.reason.as_str()))
            .collect();
        for snake in &mut state.board.snakes {
            if dead_ids.contains_key(&snake.id.0) {
                snake.alive = false;
                snake.body.clear();
            }
        }
    }

    let alive_snakes: Vec<Snake> = state
        .board
        .snakes
        .iter()
        .filter(|s| s.alive && !s.body.is_empty())
        .cloned()
        .collect();
    apply_standard_food_spawning(
        rng,
        state.board.width,
        state.board.height,
        &alive_snakes,
        &mut state.board.food,
        cfg.food,
    );

    let alive_ids = state
        .board
        .snakes
        .iter()
        .filter(|s| s.alive && !s.body.is_empty())
        .map(|s| s.id.clone())
        .collect();
    TurnSummary {
        turn: state.turn,
        dead,
        alive_ids,
    }
}

pub fn snake_head_direction(body: &[Point]) -> Direction {
    if body.len() < 2 {
        return Direction::Up;
    }
    let head = body[0];
    let neck = body[1];
    if head.x > neck.x {
        Direction::Right
    } else if head.x < neck.x {
        Direction::Left
    } else if head.y > neck.y {
        Direction::Up
    } else {
        Direction::Down
    }
}
