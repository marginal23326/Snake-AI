use std::collections::HashMap;

use snake_domain::Direction;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TtFlag {
    Exact,
    LowerBound,
    UpperBound,
}

#[derive(Debug, Clone, Copy)]
pub struct TtMove {
    pub x: i32,
    pub y: i32,
    pub dir: Direction,
    pub dir_int: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct TtEntry {
    pub depth: usize,
    pub score: f64,
    pub flag: TtFlag,
    pub mv: Option<TtMove>,
}

#[derive(Default, Debug, Clone)]
pub struct TranspositionTable {
    map: HashMap<u64, TtEntry>,
}

impl TranspositionTable {
    pub fn clear(&mut self) {
        self.map.clear();
    }

    pub fn get(&self, hash: u64) -> Option<TtEntry> {
        self.map.get(&hash).copied()
    }

    pub fn set(&mut self, hash: u64, depth: usize, score: f64, flag: TtFlag, mv: Option<TtMove>) {
        if let Some(existing) = self.map.get(&hash)
            && existing.depth > depth
        {
            return;
        }

        self.map.insert(
            hash,
            TtEntry {
                depth,
                score,
                flag,
                mv,
            },
        );
    }
}
