//! Recursive layout tree operations and the invariants from spec §4.2:
//!  - every layout tree contains at least one pane
//!  - split ratios stay within a valid, normalized range
//!  - a pane id appears in exactly one session tree
//!  - moving a pane across tabs is transactional
use super::models::{LayoutNode, Pane, SplitDirection};
use crate::error::AppError;

pub const MIN_RATIO: f64 = 0.05;
pub const MAX_RATIO: f64 = 0.95;
pub const DEFAULT_COLS: u16 = 120;
pub const DEFAULT_ROWS: u16 = 32;

impl LayoutNode {
    pub fn new_pane(pane: Pane) -> Self {
        LayoutNode::Pane { pane }
    }

    /// All panes in the tree, depth-first (stable order).
    pub fn panes(&self) -> Vec<&Pane> {
        let mut out = Vec::new();
        self.collect_panes(&mut out);
        out
    }

    fn collect_panes<'a>(&'a self, out: &mut Vec<&'a Pane>) {
        match self {
            LayoutNode::Pane { pane } => out.push(pane),
            LayoutNode::Split { first, second, .. } => {
                first.collect_panes(out);
                second.collect_panes(out);
            }
        }
    }

    pub fn pane_count(&self) -> usize {
        match self {
            LayoutNode::Pane { .. } => 1,
            LayoutNode::Split { first, second, .. } => first.pane_count() + second.pane_count(),
        }
    }

    pub fn contains_pane(&self, pane_id: &str) -> bool {
        match self {
            LayoutNode::Pane { pane } => pane.id == pane_id,
            LayoutNode::Split { first, second, .. } => {
                first.contains_pane(pane_id) || second.contains_pane(pane_id)
            }
        }
    }

    pub fn find_pane(&self, pane_id: &str) -> Option<&Pane> {
        match self {
            LayoutNode::Pane { pane } if pane.id == pane_id => Some(pane),
            LayoutNode::Split { first, second, .. } => {
                first.find_pane(pane_id).or_else(|| second.find_pane(pane_id))
            }
            _ => None,
        }
    }

    pub fn find_pane_mut(&mut self, pane_id: &str) -> Option<&mut Pane> {
        match self {
            LayoutNode::Pane { pane } if pane.id == pane_id => Some(pane),
            LayoutNode::Split { first, second, .. } => {
                first.find_pane_mut(pane_id).or_else(|| second.find_pane_mut(pane_id))
            }
            _ => None,
        }
    }

    /// Split the pane `pane_id` in `direction`, placing `new_pane` after it.
    pub fn split(&mut self, pane_id: &str, direction: SplitDirection, new_pane: Pane) -> bool {
        match self {
            LayoutNode::Pane { pane } if pane.id == pane_id => {
                let old = std::mem::replace(pane, Pane::placeholder());
                *self = LayoutNode::Split {
                    direction,
                    ratio: 0.5,
                    first: Box::new(LayoutNode::Pane { pane: old }),
                    second: Box::new(LayoutNode::Pane { pane: new_pane }),
                };
                true
            }
            LayoutNode::Split { first, second, .. } => {
                first.split(pane_id, direction, new_pane.clone())
                    || second.split(pane_id, direction, new_pane)
            }
            _ => false,
        }
    }

    /// Remove `pane_id`, collapsing the parent split. Returns the removed pane.
    /// Never removes the last pane of the tree (invariant).
    pub fn remove_pane(&mut self, pane_id: &str) -> Option<Pane> {
        if self.pane_count() <= 1 {
            return None;
        }
        self.remove_pane_inner(pane_id)
    }

    fn remove_pane_inner(&mut self, pane_id: &str) -> Option<Pane> {
        // Direct child removal with split collapse.
        if let LayoutNode::Split { first, second, .. } = self {
            let hit_first = matches!(**first, LayoutNode::Pane { ref pane } if pane.id == pane_id);
            let hit_second =
                matches!(**second, LayoutNode::Pane { ref pane } if pane.id == pane_id);
            if hit_first || hit_second {
                let (removed, survivor) = if hit_first {
                    let LayoutNode::Split { first, second, .. } =
                        std::mem::replace(self, LayoutNode::Pane { pane: Pane::placeholder() })
                    else {
                        unreachable!()
                    };
                    (*first, *second)
                } else {
                    let LayoutNode::Split { first, second, .. } =
                        std::mem::replace(self, LayoutNode::Pane { pane: Pane::placeholder() })
                    else {
                        unreachable!()
                    };
                    (*second, *first)
                };
                *self = survivor;
                if let LayoutNode::Pane { pane } = removed {
                    return Some(pane);
                }
                return None;
            }
        }
        match self {
            LayoutNode::Split { first, second, .. } => first
                .remove_pane_inner(pane_id)
                .or_else(|| second.remove_pane_inner(pane_id)),
            _ => None,
        }
    }

    /// Set the ratio of the split identified by a path ([] = root split).
    pub fn set_ratio_at_path(&mut self, path: &[bool], ratio: f64) -> bool {
        let ratio = ratio.clamp(MIN_RATIO, MAX_RATIO);
        match self {
            LayoutNode::Split { ratio: r, .. } if path.is_empty() => {
                *r = ratio;
                true
            }
            LayoutNode::Split { first, second, .. } => {
                if path[0] {
                    first.set_ratio_at_path(&path[1..], ratio)
                } else {
                    second.set_ratio_at_path(&path[1..], ratio)
                }
            }
            _ => false,
        }
    }

    /// Enumerate split paths (for divider rendering). Each element is the path
    /// to a split node; `bool` true = go to first child.
    pub fn split_paths(&self) -> Vec<Vec<bool>> {
        let mut out = Vec::new();
        self.collect_split_paths(&mut Vec::new(), &mut out);
        out
    }

    fn collect_split_paths(&self, cur: &mut Vec<bool>, out: &mut Vec<Vec<bool>>) {
        if let LayoutNode::Split { first, second, .. } = self {
            out.push(cur.clone());
            cur.push(true);
            first.collect_split_paths(cur, out);
            cur.pop();
            cur.push(false);
            second.collect_split_paths(cur, out);
            cur.pop();
        }
    }

    /// Normalize invariants: clamp all ratios into valid range.
    pub fn normalize(&mut self) {
        match self {
            LayoutNode::Pane { .. } => {}
            LayoutNode::Split { ratio, first, second, .. } => {
                *ratio = ratio.clamp(MIN_RATIO, MAX_RATIO);
                first.normalize();
                second.normalize();
            }
        }
    }

    pub fn validate(&self) -> Result<(), AppError> {
        if self.pane_count() == 0 {
            return Err(AppError::Invariant("布局树至少需要一个 Pane".into()));
        }
        let mut ids = std::collections::HashSet::new();
        for p in self.panes() {
            if !ids.insert(p.id.clone()) {
                return Err(AppError::Invariant(format!("布局树中 Pane id 重复: {}", p.id)));
            }
        }
        match self {
            LayoutNode::Split { ratio, .. } if !(*ratio >= MIN_RATIO && *ratio <= MAX_RATIO) => {
                return Err(AppError::Invariant("分割比例超出有效范围".into()));
            }
            _ => {}
        }
        Ok(())
    }

    /// Detach `pane_id` if present (allows empty result; caller re-adopts).
    pub fn detach_pane(&mut self, pane_id: &str) -> Option<Pane> {
        if matches!(self, LayoutNode::Pane { pane } if pane.id == pane_id) {
            let pane = std::mem::replace(
                self,
                LayoutNode::Pane { pane: Pane::placeholder() },
            );
            if let LayoutNode::Pane { pane } = pane {
                return Some(pane);
            }
            return None;
        }
        self.remove_pane_inner(pane_id)
    }

    /// Adopt a detached pane next to `anchor_pane_id`.
    pub fn adopt_pane(&mut self, anchor_pane_id: &str, pane: Pane) -> bool {
        self.split(anchor_pane_id, SplitDirection::Row, pane)
    }
}

impl Pane {
    pub fn new(cwd: String, profile: super::models::ShellProfile) -> Self {
        Self {
            id: super::models::new_id(),
            cwd,
            profile,
            cols: DEFAULT_COLS,
            rows: DEFAULT_ROWS,
            title: String::new(),
            active: true,
            exit_code: None,
            agent_kind: None,
            resume: None,
        }
    }

    fn placeholder() -> Self {
        Self {
            id: String::new(),
            cwd: String::new(),
            profile: super::models::ShellProfile {
                id: String::new(),
                name: String::new(),
                program: String::new(),
                args: Vec::new(),
                icon: None,
                env: Default::default(),
                source: super::models::ProfileSource::Detected,
            },
            cols: DEFAULT_COLS,
            rows: DEFAULT_ROWS,
            title: String::new(),
            active: false,
            exit_code: None,
            agent_kind: None,
            resume: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::models::{ProfileSource, ShellProfile};

    fn profile() -> ShellProfile {
        ShellProfile {
            id: "p1".into(),
            name: "PowerShell".into(),
            program: "powershell.exe".into(),
            args: vec![],
            icon: None,
            env: Default::default(),
            source: ProfileSource::Detected,
        }
    }

    fn pane(cwd: &str) -> Pane {
        Pane::new(cwd.into(), profile())
    }

    #[test]
    fn split_and_remove_pane_keeps_invariants() {
        let p1 = pane("a");
        let p1_id = p1.id.clone();
        let p2 = pane("b");
        let p2_id = p2.id.clone();
        let mut tree = LayoutNode::new_pane(p1);
        assert!(tree.split(&p1_id, SplitDirection::Row, p2));
        tree.validate().unwrap();
        assert_eq!(tree.pane_count(), 2);
        let removed = tree.remove_pane(&p2_id).expect("should remove");
        assert_eq!(removed.id, p2_id);
        assert_eq!(tree.pane_count(), 1);
        // removing the last pane is refused (invariant)
        assert!(tree.remove_pane(&p1_id).is_none());
    }

    #[test]
    fn ratios_are_normalized() {
        let p1 = pane("a");
        let p1_id = p1.id.clone();
        let mut tree = LayoutNode::new_pane(p1);
        tree.split(&p1_id, SplitDirection::Column, pane("b"));
        let mut node = tree;
        if let LayoutNode::Split { ratio, .. } = &mut node {
            *ratio = 42.0;
        }
        node.normalize();
        match node {
            LayoutNode::Split { ratio, .. } => assert!((MIN_RATIO..=MAX_RATIO).contains(&ratio)),
            _ => panic!("expected split"),
        }
    }

    #[test]
    fn move_pane_is_transactional_shape() {
        // detach from source then adopt into target; if adopt fails the pane
        // is still available to the caller.
        let a = pane("a");
        let a_id = a.id.clone();
        let mut src = LayoutNode::new_pane(a);
        src.split(&a_id, SplitDirection::Row, pane("b"));
        let moving_id = src.panes()[1].id.clone();
        let detached = src.detach_pane(&moving_id).expect("detach");
        assert!(!src.contains_pane(&moving_id));

        let c = pane("c");
        let c_id = c.id.clone();
        let mut dst = LayoutNode::new_pane(c);
        assert!(dst.adopt_pane(&c_id, detached));
        assert!(dst.contains_pane(&moving_id));
    }

    #[test]
    fn set_ratio_by_path() {
        let p1 = pane("a");
        let p1_id = p1.id.clone();
        let mut tree = LayoutNode::new_pane(p1);
        tree.split(&p1_id, SplitDirection::Row, pane("b"));
        assert_eq!(tree.split_paths().len(), 1);
        assert!(tree.set_ratio_at_path(&[], 0.7));
        match tree {
            LayoutNode::Split { ratio, .. } => assert!((ratio - 0.7).abs() < f64::EPSILON),
            _ => panic!(),
        }
    }

    #[test]
    fn pane_variant_serializes_flat_for_frontend_contract() {
        let tree = LayoutNode::new_pane(pane("C:/tmp"));
        let json = serde_json::to_value(&tree).unwrap();
        // Expected: { "pane": { "id": ..., "profile": {...}, ... } }
        // Not:      { "pane": { "pane": { ... } } }
        let pane_obj = json.get("pane").expect("pane tag");
        assert!(pane_obj.get("profile").is_some(), "profile must be at pane.*");
        assert!(pane_obj.get("pane").is_none(), "must not double-nest pane");
        assert!(pane_obj.get("id").is_some());
        // Round-trip
        let back: LayoutNode = serde_json::from_value(json).unwrap();
        assert_eq!(back.pane_count(), 1);
    }
}
