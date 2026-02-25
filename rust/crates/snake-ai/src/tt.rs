use snake_domain::Direction;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TtFlag {
    Exact,
    LowerBound,
    UpperBound,
}

impl Default for TtFlag {
    fn default() -> Self {
        Self::Exact
    }
}

#[derive(Debug, Clone, Copy)]
pub struct TtMove {
    pub x: i32,
    pub y: i32,
    pub dir: Direction,
    pub dir_int: usize,
}

impl Default for TtMove {
    fn default() -> Self {
        Self {
            x: 0,
            y: 0,
            dir: Direction::Up,
            dir_int: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TtEntry {
    pub key: u64,
    pub generation: u16,
    pub depth: u8,
    pub score: f64,
    pub flag: TtFlag,
    pub mv: Option<TtMove>,
}

#[derive(Debug, Clone)]
pub struct TranspositionTable {
    entries: Vec<TtEntry>,
    mask: usize,
    pub generation: u16,
}

impl Default for TranspositionTable {
    fn default() -> Self {
        Self::new(1 << 20)
    }
}

impl TranspositionTable {
    pub fn new(size: usize) -> Self {
        let size = if size.is_power_of_two() {
            size
        } else {
            size.next_power_of_two()
        };
        Self {
            entries: vec![TtEntry::default(); size],
            mask: size - 1,
            generation: 0,
        }
    }

    pub fn prepare_for_search(&mut self, requested_size: usize) {
        let size = if requested_size.is_power_of_two() {
            requested_size
        } else {
            requested_size.next_power_of_two()
        };
        
        let size = size.min(self.entries.len());
        self.mask = size - 1;
        
        self.generation = self.generation.wrapping_add(1);
        if self.generation == 0 {
            self.generation = 1;
            self.entries.fill(TtEntry::default());
        }
    }

    #[inline]
    pub fn get(&self, hash: u64) -> Option<TtEntry> {
        let idx = (hash as usize) & self.mask;
        let entry = unsafe { self.entries.get_unchecked(idx) };

        if entry.key == hash && entry.generation == self.generation { 
            Some(*entry) 
        } else { 
            None 
        }
    }

    #[inline]
    pub fn set(&mut self, hash: u64, depth: usize, score: f64, flag: TtFlag, mv: Option<TtMove>) {
        let idx = (hash as usize) & self.mask;
        let entry = unsafe { self.entries.get_unchecked_mut(idx) };
        let depth_u8 = depth as u8;

        // If it's from an old generation, overwrite it immediately
        if entry.generation != self.generation || entry.key != hash || depth_u8 >= entry.depth {
            *entry = TtEntry {
                key: hash,
                generation: self.generation,
                depth: depth_u8,
                score,
                flag,
                mv,
            };
        }
    }
}