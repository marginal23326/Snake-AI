use snake_domain::Point;

#[derive(Debug, Clone)]
pub struct AgentState {
    pub body: Vec<Point>,
    pub health: i32,
}

#[derive(Debug, Clone)]
pub struct SearchState {
    pub me: AgentState,
    pub enemy: AgentState,
    pub food: Vec<Point>,
    pub cols: i32,
    pub rows: i32,
    pub dist_map: Option<Vec<i16>>,
}
