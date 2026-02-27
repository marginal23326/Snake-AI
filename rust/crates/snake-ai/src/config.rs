use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoodCurveConfig {
    pub intensity: f64,
    pub threshold: f64,
    pub exponent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreConfig {
    pub win: f64,
    pub loss: f64,
    pub draw: f64,
    pub trap_danger: f64,
    pub strategic_squeeze: f64,
    pub enemy_trapped: f64,
    pub head_on_collision: f64,
    pub tight_spot: f64,
    pub length: f64,
    pub eat_reward: f64,
    pub territory_control: f64,
    pub kill_pressure: f64,
    pub food: FoodCurveConfig,
    pub aggression: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub max_depth: usize,
    pub dense_tail_race_occupancy: f64,
    pub scores: ScoreConfig,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            max_depth: 16,
            dense_tail_race_occupancy: 0.5,
            scores: ScoreConfig {
                win: 1_000_000_000.0,
                loss: -1_000_000_000.0,
                draw: -100_000_000.0,
                trap_danger: -413_704_270.0,
                strategic_squeeze: -18_960_904.0,
                enemy_trapped: 320_798_923.0,
                head_on_collision: -140_956_186.0,
                tight_spot: -76_752.599,
                length: 1_000.0,
                eat_reward: 2_000.0,
                territory_control: 3_265.2,
                kill_pressure: 66_318.811,
                food: FoodCurveConfig {
                    intensity: 3_303.092,
                    threshold: 19.357,
                    exponent: 1.968,
                },
                aggression: 7_595.795,
            },
        }
    }
}
