use snake_domain::Point;

#[derive(Debug, Clone)]
pub struct AgentState {
    pub body: Vec<Point>,
    pub health: i32,
}

#[derive(Debug, Clone)]
pub struct SearchBuffers {
    pub current_gen: u16,

    pub adj_width: i32,
    pub adj_height: i32,
    pub adj_len: Vec<usize>,
    pub adj_list: Vec<[usize; 4]>,

    // Voronoi
    pub v_visited: Vec<u32>,
    pub v_my_front: Vec<u16>,
    pub v_en_front: Vec<u16>,
    pub v_next_my: Vec<u16>,
    pub v_next_en: Vec<u16>,

    // Floodfill
    pub ff_gen: Vec<u16>,
    pub ff_body_gen: Vec<u16>,
    pub ff_body_map: Vec<i32>,
    pub ff_queue: Vec<u32>,

    // Shortest Path
    pub sd_gen: Vec<u16>,
    pub sd_queue: Vec<u32>,
}

impl SearchBuffers {
    pub fn new(size: usize) -> Self {
        Self {
            current_gen: 0,
            adj_width: 0,
            adj_height: 0,
            adj_len: vec![0; size],
            adj_list: vec![[0; 4]; size],

            v_visited: vec![0; size],
            v_my_front: Vec::with_capacity(size),
            v_en_front: Vec::with_capacity(size),
            v_next_my: Vec::with_capacity(size),
            v_next_en: Vec::with_capacity(size),

            ff_gen: vec![0; size],
            ff_body_gen: vec![0; size],
            ff_body_map: vec![0; size],
            ff_queue: Vec::with_capacity(size),

            sd_gen: vec![0; size],
            sd_queue: Vec::with_capacity(size),
        }
    }

    pub fn ensure_adj(&mut self, width: i32, height: i32) {
        if self.adj_width == width && self.adj_height == height {
            return;
        }
        self.adj_width = width;
        self.adj_height = height;
        let size = (width * height) as usize;

        if self.adj_len.len() < size {
            self.adj_len.resize(size, 0);
            self.adj_list.resize(size, [0; 4]);
        }

        for y in 0..height {
            for x in 0..width {
                let idx = (y * width + x) as usize;
                let mut count = 0;
                if y > 0 {
                    self.adj_list[idx][count] = idx - width as usize;
                    count += 1;
                }
                if y < height - 1 {
                    self.adj_list[idx][count] = idx + width as usize;
                    count += 1;
                }
                if x > 0 {
                    self.adj_list[idx][count] = idx - 1;
                    count += 1;
                }
                if x < width - 1 {
                    self.adj_list[idx][count] = idx + 1;
                    count += 1;
                }
                self.adj_len[idx] = count;
            }
        }
    }

    #[inline(always)]
    pub fn next_gen(&mut self) -> u16 {
        self.current_gen = self.current_gen.wrapping_add(1);
        if self.current_gen == 0 {
            self.current_gen = 1;
            self.v_visited.fill(0);
            self.ff_gen.fill(0);
            self.ff_body_gen.fill(0);
            self.sd_gen.fill(0);
        }
        self.current_gen
    }
}
