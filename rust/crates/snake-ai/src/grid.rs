use snake_domain::Point;

#[derive(Debug, Clone)]
pub struct Grid {
    pub width: i32,
    pub height: i32,
    pub cells: Vec<i8>,
}

impl Grid {
    pub fn new(width: i32, height: i32) -> Self {
        Self {
            width,
            height,
            cells: vec![0; (width * height) as usize],
        }
    }

    #[inline]
    pub fn idx(&self, x: i32, y: i32) -> usize {
        (y * self.width + x) as usize
    }

    #[inline]
    pub fn get(&self, x: i32, y: i32) -> i8 {
        if x < 0 || y < 0 || x >= self.width || y >= self.height {
            return 9;
        }
        self.cells[self.idx(x, y)]
    }

    #[inline]
    pub fn set(&mut self, x: i32, y: i32, val: i8) {
        if x < 0 || y < 0 || x >= self.width || y >= self.height {
            return;
        }
        let idx = self.idx(x, y);
        self.cells[idx] = val;
    }

    #[inline]
    pub fn is_safe(&self, x: i32, y: i32) -> bool {
        matches!(self.get(x, y), 0 | 1)
    }

    pub fn from_state(cols: i32, rows: i32, food: &[Point], my_body: &[Point], enemy_body: &[Point]) -> Self {
        let mut g = Self::new(cols, rows);
        for f in food {
            g.set(f.x, f.y, 1);
        }
        for p in my_body {
            g.set(p.x, p.y, 2);
        }
        for p in enemy_body {
            g.set(p.x, p.y, 3);
        }
        g
    }
}
