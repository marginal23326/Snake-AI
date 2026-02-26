use snake_domain::Point;

#[derive(Debug, Clone)]
pub struct AgentState {
    pub body: Vec<Point>,
    pub health: i32,
}

/// We keep this struct minimal to maintain signature compatibility and for any future
/// generational markers (e.g. for TT or legacy pathfinding).
#[derive(Debug, Clone)]
pub struct SearchBuffers {
    pub current_gen: u16,
}

impl SearchBuffers {
    pub fn new(_size: usize) -> Self {
        Self { current_gen: 0 }
    }

    #[inline(always)]
    pub fn ensure_adj(&mut self, _width: i32, _height: i32) {
        // No-op: BitBoards compute adjacency dynamically via shifts.
    }

    #[inline(always)]
    pub fn next_gen(&mut self) -> u16 {
        self.current_gen = self.current_gen.wrapping_add(1);
        if self.current_gen == 0 {
            self.current_gen = 1;
        }
        self.current_gen
    }
}
