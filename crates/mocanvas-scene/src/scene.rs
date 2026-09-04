//! The struct-of-arrays scene.

use crate::order::ZKey;
use crate::style::Style;
use crate::Handle;
use mocanvas_geo::{Box2d, Mat2d, Path, Vec2};
use rstar::{primitives::{GeomWithData, Rectangle}, RTree};

/// Shape is not rendered and not hit-testable.
pub const FLAG_HIDDEN: u32 = 1 << 0;
/// Shape cannot be selected by pointer (still renders).
pub const FLAG_LOCKED: u32 = 1 << 1;
/// Shape is drawn by the DOM overlay, not the GPU.
pub const FLAG_OVERLAY: u32 = 1 << 2;
/// Hit test ignores the interior even if the style has a fill (hollow geo shapes).
pub const FLAG_NO_FILL: u32 = 1 << 3;
/// Shape is drawn by the GPU and additionally reported to the DOM overlay (text labels).
pub const FLAG_LABEL: u32 = 1 << 4;
/// Every descendant is clipped to this shape's page-space geometry AABB (frames).
pub const FLAG_CLIP: u32 = 1 << 5;

/// Dense index into the scene arrays. Stable until the shape is removed.
pub type Slot = u32;

type IndexItem = GeomWithData<Rectangle<[f32; 2]>, Handle>;

/// Everything the engine knows about one shape, by reference.
#[derive(Clone, Copy, Debug)]
pub struct ShapeRef<'a> {
    /// Host handle.
    pub handle: Handle,
    /// Dense slot.
    pub slot: Slot,
    /// Shape kind id (registered by the host per ShapeUtil).
    pub kind: u16,
    /// Parent handle, 0 for page root.
    pub parent: Handle,
    /// Flags.
    pub flags: u32,
    /// Local transform: position and rotation relative to parent.
    pub x: f32,
    /// See `x`.
    pub y: f32,
    /// Rotation in radians.
    pub rotation: f32,
    /// Nominal width (informational; geometry is authoritative).
    pub w: f32,
    /// Nominal height.
    pub h: f32,
    /// Page-space transform.
    pub page_transform: &'a Mat2d,
    /// Page-space axis-aligned *ink* bounds: the outline expanded by half the
    /// stroke width. What the spatial index, culling and clipping run on.
    pub page_bounds: &'a Box2d,
    /// Page-space axis-aligned *geometry* bounds: the same outline without the
    /// stroke pad. What user-facing measurements (fit, align, report) want.
    pub geom_bounds: &'a Box2d,
    /// Local-space bounds of the outline (empty if no geometry was uploaded).
    pub local_bounds: &'a Box2d,
    /// Page-space clip rectangle inherited from the nearest `FLAG_CLIP` ancestor
    /// (intersected with that ancestor's own clip), or `None` when unclipped.
    /// May be an empty box when the intersection is empty (fully clipped).
    pub clip: Option<Box2d>,
    /// Local outline.
    pub path: &'a Path,
    /// Style.
    pub style: &'a Style,
    /// Bumps on every change.
    pub version: u32,
    /// Bumps when geometry or style changed (mesh must be rebuilt).
    pub geom_version: u32,
    /// Z rank in page draw order (0 = bottom).
    pub z_rank: u32,
}

/// Struct-of-arrays scene.
#[derive(Default)]
pub struct Scene {
    // handle -> slot + 1 (0 = absent)
    slot_of: Vec<u32>,
    free_slots: Vec<Slot>,

    handles: Vec<Handle>,
    kind: Vec<u16>,
    parent: Vec<Handle>,
    zkey: Vec<ZKey>,
    flags: Vec<u32>,
    x: Vec<f32>,
    y: Vec<f32>,
    rot: Vec<f32>,
    w: Vec<f32>,
    h: Vec<f32>,
    version: Vec<u32>,
    geom_version: Vec<u32>,
    path: Vec<Path>,
    style: Vec<Style>,
    local_bounds: Vec<Box2d>,
    page_xf: Vec<Mat2d>,
    page_bounds: Vec<Box2d>,
    geom_bounds: Vec<Box2d>,
    clip_of: Vec<Option<Box2d>>,
    z_rank: Vec<u32>,
    alive: Vec<bool>,
    indexed_env: Vec<Option<Rectangle<[f32; 2]>>>,

    children: Vec<Vec<Slot>>,

    tree: RTree<IndexItem>,
    /// Draw order (slots), rebuilt lazily.
    order: Vec<Slot>,
    order_dirty: bool,
    /// Global change counter.
    epoch: u64,
    /// Flattening tolerance for bounds.
    tol: f32,
}

impl Scene {
    /// New empty scene.
    pub fn new() -> Self {
        Self { tol: 0.25, ..Default::default() }
    }

    /// Number of live shapes.
    pub fn len(&self) -> usize {
        self.handles.len() - self.free_slots.len()
    }

    /// True if no shapes.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Monotonic counter incremented on every mutation.
    pub fn epoch(&self) -> u64 {
        self.epoch
    }

    /// Remove everything.
    pub fn clear(&mut self) {
        *self = Self::new();
        self.epoch += 1;
    }

    /// Slot for a handle.
    #[inline]
    pub fn slot(&self, handle: Handle) -> Option<Slot> {
        match self.slot_of.get(handle as usize) {
            Some(&s) if s != 0 => Some(s - 1),
            _ => None,
        }
    }

    /// Handle for a slot.
    #[inline]
    pub fn handle_at(&self, slot: Slot) -> Handle {
        self.handles[slot as usize]
    }

    /// Borrow all facts about a shape.
    pub fn get(&self, handle: Handle) -> Option<ShapeRef<'_>> {
        let s = self.slot(handle)? as usize;
        Some(self.shape_at(s as Slot))
    }

    /// Borrow by slot (must be alive).
    pub fn shape_at(&self, slot: Slot) -> ShapeRef<'_> {
        let s = slot as usize;
        debug_assert!(self.alive[s]);
        ShapeRef {
            handle: self.handles[s],
            slot,
            kind: self.kind[s],
            parent: self.parent[s],
            flags: self.flags[s],
            x: self.x[s],
            y: self.y[s],
            rotation: self.rot[s],
            w: self.w[s],
            h: self.h[s],
            page_transform: &self.page_xf[s],
            page_bounds: &self.page_bounds[s],
            geom_bounds: &self.geom_bounds[s],
            local_bounds: &self.local_bounds[s],
            clip: self.clip_of[s],
            path: &self.path[s],
            style: &self.style[s],
            version: self.version[s],
            geom_version: self.geom_version[s],
            z_rank: self.z_rank[s],
        }
    }

    /// Insert or update the record-level facts of a shape. Geometry and style
    /// are set separately and default to an empty path / default style.
    #[allow(clippy::too_many_arguments)]
    pub fn upsert(
        &mut self,
        handle: Handle,
        kind: u16,
        parent: Handle,
        zkey: ZKey,
        flags: u32,
        x: f32,
        y: f32,
        rotation: f32,
        w: f32,
        h: f32,
    ) {
        assert!(handle != 0, "handle 0 is reserved");
        self.epoch += 1;
        let slot = match self.slot(handle) {
            Some(s) => s,
            None => self.alloc_slot(handle),
        };
        let s = slot as usize;

        let structural = self.kind[s] != kind || self.parent[s] != parent || self.zkey[s] != zkey;
        if self.parent[s] != parent {
            self.unlink_child(slot);
            self.parent[s] = parent;
            self.link_child(slot);
        }
        let transform_changed = self.x[s] != x || self.y[s] != y || self.rot[s] != rotation;
        let size_changed = self.w[s] != w || self.h[s] != h;
        let clip_changed = (self.flags[s] ^ flags) & FLAG_CLIP != 0;

        self.kind[s] = kind;
        self.zkey[s] = zkey;
        self.flags[s] = flags;
        self.x[s] = x;
        self.y[s] = y;
        self.rot[s] = rotation;
        self.w[s] = w;
        self.h[s] = h;
        self.version[s] = self.version[s].wrapping_add(1);
        if size_changed {
            // Geometry is uploaded separately, but size change implies a
            // pending geometry update; bump so stale meshes are not drawn.
            self.geom_version[s] = self.geom_version[s].wrapping_add(1);
        }
        if structural {
            self.order_dirty = true;
        }
        if transform_changed || structural || size_changed || clip_changed {
            self.recompute_transforms(slot);
        }
    }

    /// Replace the local outline of a shape. The shape must exist.
    pub fn set_geometry(&mut self, handle: Handle, path: Path) -> bool {
        let Some(slot) = self.slot(handle) else { return false };
        let s = slot as usize;
        self.epoch += 1;
        self.local_bounds[s] = path.bounds(self.tol);
        self.path[s] = path;
        self.version[s] = self.version[s].wrapping_add(1);
        self.geom_version[s] = self.geom_version[s].wrapping_add(1);
        self.update_page_bounds(slot);
        if self.flags[s] & FLAG_CLIP != 0 {
            self.recompute_clips(slot);
        }
        true
    }

    /// Set the fill texture id of a shape (0 = none). The shape must exist.
    pub fn set_texture(&mut self, handle: Handle, texture: u32) -> bool {
        let Some(slot) = self.slot(handle) else { return false };
        let s = slot as usize;
        if self.style[s].texture == texture {
            return true;
        }
        self.epoch += 1;
        self.style[s].texture = texture;
        self.version[s] = self.version[s].wrapping_add(1);
        true
    }

    /// Clip rectangle applied to the descendants of a shape, or `None`.
    pub fn clip_of(&self, handle: Handle) -> Option<Box2d> {
        self.slot(handle).and_then(|s| self.clip_of[s as usize])
    }

    /// Replace the style of a shape. The shape must exist.
    pub fn set_style(&mut self, handle: Handle, style: Style) -> bool {
        let Some(slot) = self.slot(handle) else { return false };
        let s = slot as usize;
        if self.style[s] == style {
            return true;
        }
        self.epoch += 1;
        let stroke_changed = self.style[s].stroke_width != style.stroke_width;
        self.style[s] = style;
        self.version[s] = self.version[s].wrapping_add(1);
        self.geom_version[s] = self.geom_version[s].wrapping_add(1);
        if stroke_changed {
            self.update_page_bounds(slot);
        }
        true
    }

    /// Remove a shape. Children are re-parented to the page root (the host is
    /// expected to have handled them already; this keeps the scene consistent).
    pub fn remove(&mut self, handle: Handle) -> bool {
        let Some(slot) = self.slot(handle) else { return false };
        let s = slot as usize;
        self.epoch += 1;
        self.unindex(slot);
        self.unlink_child(slot);
        let kids = core::mem::take(&mut self.children[s]);
        for k in kids {
            self.parent[k as usize] = 0;
            self.link_child(k);
            self.recompute_transforms(k);
        }
        self.alive[s] = false;
        self.slot_of[handle as usize] = 0;
        self.handles[s] = 0;
        self.path[s] = Path::new();
        self.free_slots.push(slot);
        self.order_dirty = true;
        true
    }

    /// Slots in draw order (bottom to top), rebuilt if needed.
    pub fn draw_order(&mut self) -> &[Slot] {
        if self.order_dirty {
            self.rebuild_order();
        }
        &self.order
    }

    /// Union of page bounds of the given handles.
    pub fn union_bounds(&self, handles: &[Handle]) -> Box2d {
        let mut b = Box2d::EMPTY;
        for &h in handles {
            if let Some(s) = self.slot(h) {
                b = b.union(&self.page_bounds[s as usize]);
            }
        }
        b
    }

    /// Union of page bounds of every shape.
    pub fn all_bounds(&self) -> Box2d {
        let mut b = Box2d::EMPTY;
        for (s, alive) in self.alive.iter().enumerate() {
            if *alive {
                b = b.union(&self.page_bounds[s]);
            }
        }
        b
    }

    /// Page-space geometry bounds of one shape: the outline transformed into
    /// page space, *without* the half-stroke pad that `page_bounds` carries.
    pub fn geometry_bounds(&self, handle: Handle) -> Option<Box2d> {
        self.slot(handle).map(|s| self.geom_bounds[s as usize])
    }

    /// Union of geometry bounds of every shape. The box a viewport fit or any
    /// other user-facing measurement of the page should use.
    pub fn all_geometry_bounds(&self) -> Box2d {
        let mut b = Box2d::EMPTY;
        for (s, alive) in self.alive.iter().enumerate() {
            if *alive {
                b = b.union(&self.geom_bounds[s]);
            }
        }
        b
    }

    /// Iterate live slots (unordered).
    pub fn slots(&self) -> impl Iterator<Item = Slot> + '_ {
        self.alive.iter().enumerate().filter(|(_, a)| **a).map(|(i, _)| i as Slot)
    }

    pub(crate) fn tree(&self) -> &RTree<IndexItem> {
        &self.tree
    }

    pub(crate) fn z_rank_of(&self, slot: Slot) -> u32 {
        self.z_rank[slot as usize]
    }

    // ---- internals -------------------------------------------------------

    fn alloc_slot(&mut self, handle: Handle) -> Slot {
        let h = handle as usize;
        if self.slot_of.len() <= h {
            self.slot_of.resize(h + 1, 0);
        }
        let slot = if let Some(s) = self.free_slots.pop() {
            let i = s as usize;
            self.handles[i] = handle;
            self.kind[i] = 0;
            self.parent[i] = 0;
            self.zkey[i] = ZKey::default();
            self.flags[i] = 0;
            self.x[i] = 0.0;
            self.y[i] = 0.0;
            self.rot[i] = 0.0;
            self.w[i] = 0.0;
            self.h[i] = 0.0;
            self.version[i] = 0;
            self.geom_version[i] = 0;
            self.path[i] = Path::new();
            self.style[i] = Style::default();
            self.local_bounds[i] = Box2d::EMPTY;
            self.page_xf[i] = Mat2d::IDENTITY;
            self.page_bounds[i] = Box2d::EMPTY;
            self.geom_bounds[i] = Box2d::EMPTY;
            self.clip_of[i] = None;
            self.z_rank[i] = 0;
            self.alive[i] = true;
            self.indexed_env[i] = None;
            self.children[i].clear();
            s
        } else {
            self.handles.push(handle);
            self.kind.push(0);
            self.parent.push(0);
            self.zkey.push(ZKey::default());
            self.flags.push(0);
            self.x.push(0.0);
            self.y.push(0.0);
            self.rot.push(0.0);
            self.w.push(0.0);
            self.h.push(0.0);
            self.version.push(0);
            self.geom_version.push(0);
            self.path.push(Path::new());
            self.style.push(Style::default());
            self.local_bounds.push(Box2d::EMPTY);
            self.page_xf.push(Mat2d::IDENTITY);
            self.page_bounds.push(Box2d::EMPTY);
            self.geom_bounds.push(Box2d::EMPTY);
            self.clip_of.push(None);
            self.z_rank.push(0);
            self.alive.push(true);
            self.indexed_env.push(None);
            self.children.push(Vec::new());
            (self.handles.len() - 1) as Slot
        };
        self.slot_of[h] = slot + 1;
        self.link_child(slot);
        self.order_dirty = true;
        slot
    }

    fn link_child(&mut self, slot: Slot) {
        let p = self.parent[slot as usize];
        if p != 0 {
            if let Some(ps) = self.slot(p) {
                self.children[ps as usize].push(slot);
            }
        }
    }

    fn unlink_child(&mut self, slot: Slot) {
        let p = self.parent[slot as usize];
        if p != 0 {
            if let Some(ps) = self.slot(p) {
                let kids = &mut self.children[ps as usize];
                if let Some(i) = kids.iter().position(|&k| k == slot) {
                    kids.swap_remove(i);
                }
            }
        }
    }

    fn parent_transform(&self, slot: Slot) -> Mat2d {
        let p = self.parent[slot as usize];
        if p == 0 {
            return Mat2d::IDENTITY;
        }
        match self.slot(p) {
            Some(ps) => self.page_xf[ps as usize],
            None => Mat2d::IDENTITY,
        }
    }

    /// Recompute page transform (and inherited clip) for a slot and its descendants.
    fn recompute_transforms(&mut self, slot: Slot) {
        let mut stack = vec![slot];
        while let Some(s) = stack.pop() {
            let i = s as usize;
            let parent = self.parent_transform(s);
            let local = Mat2d::from_trs(self.x[i], self.y[i], self.rot[i]);
            self.page_xf[i] = parent.mul(&local);
            self.update_page_bounds(s);
            self.clip_of[i] = self.clip_for(s);
            stack.extend_from_slice(&self.children[i]);
        }
    }

    /// Recompute the inherited clip of every descendant of `slot` (not `slot` itself).
    fn recompute_clips(&mut self, slot: Slot) {
        let mut stack = self.children[slot as usize].clone();
        while let Some(s) = stack.pop() {
            let i = s as usize;
            self.clip_of[i] = self.clip_for(s);
            stack.extend_from_slice(&self.children[i]);
        }
    }

    /// Page-space rectangle a `FLAG_CLIP` shape clips its descendants to: its
    /// geometry bounds (nominal size if no geometry yet), without stroke padding.
    fn clip_rect(&self, slot: Slot) -> Box2d {
        self.geom_bounds[slot as usize]
    }

    /// Clip inherited by `slot` from its parent chain: the nearest clipping
    /// ancestor's rect intersected with that ancestor's own inherited clip.
    fn clip_for(&self, slot: Slot) -> Option<Box2d> {
        let p = self.parent[slot as usize];
        if p == 0 {
            return None;
        }
        let ps = self.slot(p)?;
        let inherited = self.clip_of[ps as usize];
        if self.flags[ps as usize] & FLAG_CLIP == 0 {
            return inherited;
        }
        let own = self.clip_rect(ps);
        Some(match inherited {
            Some(c) => c.intersection(&own),
            None => own,
        })
    }

    /// Recompute both page-space boxes of a slot from the one page transform:
    /// the geometry box (outline only) and the ink box (outline + half stroke).
    /// The spatial index tracks the ink box.
    fn update_page_bounds(&mut self, slot: Slot) {
        let i = slot as usize;
        let lb = self.local_bounds[i];
        // No geometry yet: fall back to nominal size so culling still works.
        let lb = if lb.is_empty() { Box2d::from_xywh(0.0, 0.0, self.w[i], self.h[i]) } else { lb };
        let xf = self.page_xf[i];
        let gb = lb.transformed(&xf);
        // The stroke pad is applied in local space (it is a local-space outline
        // offset), so the ink box is a second transform of the padded outline
        // rather than a page-space inflation of `gb`.
        let half = if self.local_bounds[i].is_empty() {
            0.0
        } else if self.style[i].has_stroke() {
            self.style[i].stroke_width * 0.5
        } else {
            0.0
        };
        self.geom_bounds[i] = gb;
        self.page_bounds[i] = if half == 0.0 { gb } else { lb.expand(half).transformed(&xf) };
        self.reindex(slot);
    }

    fn reindex(&mut self, slot: Slot) {
        self.unindex(slot);
        let i = slot as usize;
        let b = self.page_bounds[i];
        if b.is_empty() {
            return;
        }
        let env = Rectangle::from_corners([b.min.x, b.min.y], [b.max.x, b.max.y]);
        self.tree.insert(GeomWithData::new(env, self.handles[i]));
        self.indexed_env[i] = Some(env);
    }

    fn unindex(&mut self, slot: Slot) {
        let i = slot as usize;
        if let Some(env) = self.indexed_env[i].take() {
            let h = self.handles[i];
            self.tree.remove(&GeomWithData::new(env, h));
        }
    }

    fn rebuild_order(&mut self) {
        self.order.clear();
        // Roots: alive shapes whose parent is 0 or missing.
        let mut roots: Vec<Slot> = self
            .slots()
            .filter(|&s| {
                let p = self.parent[s as usize];
                p == 0 || self.slot(p).is_none()
            })
            .collect();
        self.sort_by_zkey(&mut roots);
        let mut stack: Vec<Slot> = roots.into_iter().rev().collect();
        while let Some(s) = stack.pop() {
            self.order.push(s);
            let mut kids = self.children[s as usize].clone();
            if !kids.is_empty() {
                self.sort_by_zkey(&mut kids);
                stack.extend(kids.into_iter().rev());
            }
        }
        for (rank, &s) in self.order.iter().enumerate() {
            self.z_rank[s as usize] = rank as u32;
        }
        self.order_dirty = false;
    }

    fn sort_by_zkey(&self, slots: &mut [Slot]) {
        slots.sort_unstable_by(|&a, &b| {
            let (ia, ib) = (a as usize, b as usize);
            self.zkey[ia].cmp(&self.zkey[ib]).then(self.handles[ia].cmp(&self.handles[ib]))
        });
    }

    /// Local point for a page point.
    pub fn page_to_local(&self, slot: Slot, p: Vec2) -> Option<Vec2> {
        self.page_xf[slot as usize].inverse().map(|m| m.apply(p))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect_scene() -> Scene {
        let mut sc = Scene::new();
        // three rects, handle 1 bottom, 3 top
        for (h, z) in [(1u32, 10u64), (2, 20), (3, 30)] {
            sc.upsert(h, 1, 0, ZKey(z), 0, 10.0 * h as f32, 0.0, 0.0, 100.0, 100.0);
            sc.set_geometry(h, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
        }
        sc
    }

    #[test]
    fn upsert_and_bounds() {
        let sc = rect_scene();
        assert_eq!(sc.len(), 3);
        let s = sc.get(2).unwrap();
        // stroke width 2 default → bounds expand by 1
        assert!((s.page_bounds.min.x - 19.0).abs() < 1e-5);
        assert!((s.page_bounds.max.x - 121.0).abs() < 1e-5);
    }

    #[test]
    fn draw_order_follows_zkey_then_children() {
        let mut sc = rect_scene();
        // make 1 a child of 3
        sc.upsert(1, 1, 3, ZKey(10), 0, 5.0, 5.0, 0.0, 100.0, 100.0);
        let slots = sc.draw_order().to_vec();
        let order: Vec<Handle> = slots.iter().map(|&s| sc.handle_at(s)).collect();
        assert_eq!(order, vec![2, 3, 1]);
        // child page transform composes parent's
        let c = sc.get(1).unwrap();
        assert!((c.page_transform.e - 35.0).abs() < 1e-5);
    }

    #[test]
    fn remove_reuses_slot_and_reparents_children() {
        let mut sc = rect_scene();
        sc.upsert(1, 1, 3, ZKey(10), 0, 5.0, 5.0, 0.0, 100.0, 100.0);
        assert!(sc.remove(3));
        assert_eq!(sc.len(), 2);
        assert_eq!(sc.get(1).unwrap().parent, 0);
        assert!((sc.get(1).unwrap().page_transform.e - 5.0).abs() < 1e-5);
        sc.upsert(9, 1, 0, ZKey(1), 0, 0.0, 0.0, 0.0, 1.0, 1.0);
        assert_eq!(sc.len(), 3);
        assert!(sc.get(3).is_none());
        assert!(sc.get(9).is_some());
    }

    #[test]
    fn clip_inherits_from_nearest_clip_ancestor_and_intersects() {
        let mut sc = Scene::new();
        // outer frame (clip) at (100,100) size 200x200
        sc.upsert(1, 1, 0, ZKey(1), FLAG_CLIP, 100.0, 100.0, 0.0, 200.0, 200.0);
        sc.set_geometry(1, Path::rect(&Box2d::from_xywh(0.0, 0.0, 200.0, 200.0)));
        // plain child of the frame → clipped to the frame rect (no stroke padding)
        sc.upsert(2, 1, 1, ZKey(1), 0, 10.0, 10.0, 0.0, 50.0, 50.0);
        assert_eq!(sc.get(1).unwrap().clip, None);
        assert_eq!(sc.get(2).unwrap().clip, Some(Box2d::from_xywh(100.0, 100.0, 200.0, 200.0)));
        // nested frame partially outside the outer one: it is clipped by the outer rect
        sc.upsert(3, 1, 1, ZKey(2), FLAG_CLIP, 150.0, 150.0, 0.0, 100.0, 100.0);
        assert_eq!(sc.get(3).unwrap().clip, Some(Box2d::from_xywh(100.0, 100.0, 200.0, 200.0)));
        // grandchild: nested rect (250..350) ∩ outer (100..300) = 250..300
        sc.upsert(4, 1, 3, ZKey(1), 0, 0.0, 0.0, 0.0, 10.0, 10.0);
        assert_eq!(sc.get(4).unwrap().clip, Some(Box2d::from_xywh(250.0, 250.0, 50.0, 50.0)));
        assert_eq!(sc.clip_of(4), sc.get(4).unwrap().clip);
        // moving the outer frame propagates to every descendant
        sc.upsert(1, 1, 0, ZKey(1), FLAG_CLIP, 0.0, 0.0, 0.0, 200.0, 200.0);
        assert_eq!(sc.get(2).unwrap().clip, Some(Box2d::from_xywh(0.0, 0.0, 200.0, 200.0)));
        assert_eq!(sc.get(4).unwrap().clip, Some(Box2d::from_xywh(150.0, 150.0, 50.0, 50.0)));
        // geometry change of a clip shape updates the descendants' clip
        sc.set_geometry(1, Path::rect(&Box2d::from_xywh(0.0, 0.0, 160.0, 160.0)));
        assert_eq!(sc.get(2).unwrap().clip, Some(Box2d::from_xywh(0.0, 0.0, 160.0, 160.0)));
        assert_eq!(sc.get(4).unwrap().clip, Some(Box2d::from_xywh(150.0, 150.0, 10.0, 10.0)));
        // clearing the flag removes the clip from descendants
        sc.upsert(1, 1, 0, ZKey(1), 0, 0.0, 0.0, 0.0, 200.0, 200.0);
        assert_eq!(sc.get(2).unwrap().clip, None);
        assert_eq!(sc.get(4).unwrap().clip, Some(Box2d::from_xywh(150.0, 150.0, 100.0, 100.0)));
        // reparenting to the root drops the clip
        sc.upsert(4, 1, 0, ZKey(1), 0, 0.0, 0.0, 0.0, 10.0, 10.0);
        assert_eq!(sc.get(4).unwrap().clip, None);
    }

    #[test]
    fn disjoint_nested_clip_is_empty() {
        let mut sc = Scene::new();
        sc.upsert(1, 1, 0, ZKey(1), FLAG_CLIP, 0.0, 0.0, 0.0, 100.0, 100.0);
        sc.upsert(2, 1, 1, ZKey(1), FLAG_CLIP, 500.0, 500.0, 0.0, 100.0, 100.0);
        sc.upsert(3, 1, 2, ZKey(1), 0, 0.0, 0.0, 0.0, 10.0, 10.0);
        assert!(sc.get(3).unwrap().clip.unwrap().is_empty());
    }

    #[test]
    fn set_texture_updates_style() {
        let mut sc = rect_scene();
        assert!(sc.set_texture(1, 7));
        assert_eq!(sc.get(1).unwrap().style.texture, 7);
        assert!(sc.get(1).unwrap().style.has_texture());
        assert!(!sc.set_texture(99, 7));
    }

    #[test]
    fn geometry_bounds_ignore_the_stroke_that_page_bounds_include() {
        let mut sc = Scene::new();
        // 200x120 at (100,100) with a 3.5 unit stroke → 1.75 of pad on every side.
        sc.upsert(1, 1, 0, ZKey(1), 0, 100.0, 100.0, 0.0, 200.0, 120.0);
        sc.set_style(1, Style { stroke_width: 3.5, ..Style::default() });
        sc.set_geometry(1, Path::rect(&Box2d::from_xywh(0.0, 0.0, 200.0, 120.0)));

        let gb = sc.geometry_bounds(1).unwrap();
        assert_eq!(gb.to_array(), [100.0, 100.0, 300.0, 220.0]);
        let pb = *sc.get(1).unwrap().page_bounds;
        assert_eq!(pb.to_array(), [98.25, 98.25, 301.75, 221.75]);
        assert_eq!(sc.get(1).unwrap().geom_bounds.to_array(), gb.to_array());
        // One shape: the page-wide unions are the per-shape boxes.
        assert_eq!(sc.all_geometry_bounds().to_array(), gb.to_array());
        assert_eq!(sc.all_bounds().to_array(), pb.to_array());

        // A hairline second shape below shows the asymmetry the ink union has
        // and the geometry union does not.
        sc.upsert(2, 1, 0, ZKey(2), 0, 100.0, 300.0, 0.0, 200.0, 120.0);
        sc.set_style(2, Style { stroke_width: 1.0, ..Style::default() });
        sc.set_geometry(2, Path::rect(&Box2d::from_xywh(0.0, 0.0, 200.0, 120.0)));
        assert_eq!(sc.all_geometry_bounds().to_array(), [100.0, 100.0, 300.0, 420.0]);
        assert_eq!(sc.all_bounds().to_array(), [98.25, 98.25, 301.75, 420.5]);

        // A shape with no stroke has identical boxes.
        sc.set_style(2, Style { stroke: 0, ..Style::default() });
        assert_eq!(sc.geometry_bounds(2).unwrap().to_array(), [100.0, 300.0, 300.0, 420.0]);
        assert_eq!(sc.get(2).unwrap().page_bounds.to_array(), [100.0, 300.0, 300.0, 420.0]);

        assert!(sc.geometry_bounds(99).is_none());
    }

    #[test]
    fn geometry_bounds_of_a_rotated_shape_exclude_the_stroke() {
        let mut sc = Scene::new();
        sc.upsert(1, 1, 0, ZKey(1), 0, 0.0, 0.0, core::f32::consts::FRAC_PI_4, 100.0, 100.0);
        sc.set_style(1, Style { stroke_width: 4.0, ..Style::default() });
        sc.set_geometry(1, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
        let gb = sc.geometry_bounds(1).unwrap();
        let pb = *sc.get(1).unwrap().page_bounds;
        // 100x100 at 45° spans 100*sqrt(2); the 2-unit pad rotates with it,
        // widening the box by 2*2*sqrt(2) with no shift of the centre.
        assert!((gb.width() - 141.42).abs() < 0.01);
        assert!((pb.width() - (141.42 + 5.657)).abs() < 0.01);
        assert!((gb.center().x - pb.center().x).abs() < 1e-4);
        assert!((gb.center().y - pb.center().y).abs() < 1e-4);
    }

    #[test]
    fn rotation_expands_bounds() {
        let mut sc = Scene::new();
        sc.upsert(1, 1, 0, ZKey(1), 0, 0.0, 0.0, core::f32::consts::FRAC_PI_4, 100.0, 100.0);
        sc.set_style(1, Style { stroke: 0, ..Style::default() });
        sc.set_geometry(1, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
        let b = sc.get(1).unwrap().page_bounds;
        assert!((b.width() - 141.42).abs() < 0.1);
    }
}
