//! Z-ordering keys.

/// A 64-bit sortable key derived from the record's fractional index by the host.
/// Ties are broken by handle so ordering is always total.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ZKey(pub u64);

impl ZKey {
    /// From the two `u32` words the host sends (low, high).
    #[inline]
    pub const fn from_words(lo: u32, hi: u32) -> Self {
        ZKey(((hi as u64) << 32) | lo as u64)
    }
}
