//! Parses git's `--progress` output (clone, fetch, push) into a single
//! overall percentage.

use serde::Serialize;

/// Stages of a transfer, in the order git reports them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum ProgressPhase {
    Counting,
    Compressing,
    Receiving,
    Resolving,
    /// Uploading objects during a push.
    Writing,
    CheckingOut,
}

/// Which command the progress comes from; decides which phases exist and
/// how much of the bar each one covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TransferKind {
    #[default]
    Clone,
    Fetch,
    Push,
}

impl ProgressPhase {
    /// Share of the overall bar each phase covers for `kind`; 0 for phases
    /// that command doesn't have. Network transfer dominates on real
    /// networks, so it gets the largest slice.
    fn weight(self, kind: TransferKind) -> f64 {
        match (kind, self) {
            (TransferKind::Clone, Self::Counting) => 0.05,
            (TransferKind::Clone, Self::Compressing) => 0.05,
            (TransferKind::Clone, Self::Receiving) => 0.65,
            (TransferKind::Clone, Self::Resolving) => 0.15,
            (TransferKind::Clone, Self::CheckingOut) => 0.10,
            (TransferKind::Fetch, Self::Counting) => 0.05,
            (TransferKind::Fetch, Self::Compressing) => 0.05,
            (TransferKind::Fetch, Self::Receiving) => 0.70,
            (TransferKind::Fetch, Self::Resolving) => 0.20,
            (TransferKind::Push, Self::Counting) => 0.10,
            (TransferKind::Push, Self::Compressing) => 0.20,
            (TransferKind::Push, Self::Writing) => 0.70,
            _ => 0.0,
        }
    }

    fn all() -> [Self; 6] {
        [
            Self::Counting,
            Self::Compressing,
            Self::Receiving,
            Self::Resolving,
            Self::Writing,
            Self::CheckingOut,
        ]
    }

    fn from_title(title: &str) -> Option<Self> {
        match title {
            "Enumerating objects" | "Counting objects" => Some(Self::Counting),
            "Compressing objects" => Some(Self::Compressing),
            "Receiving objects" => Some(Self::Receiving),
            "Resolving deltas" => Some(Self::Resolving),
            "Writing objects" => Some(Self::Writing),
            "Updating files" | "Checking out files" => Some(Self::CheckingOut),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: ProgressPhase,
    /// Percent of the current phase, when git reports one.
    pub phase_percent: Option<u8>,
    /// Overall progress across all phases, 0–100.
    pub overall_percent: u8,
}

/// Turns progress lines into monotonically increasing [`Progress`] updates.
#[derive(Debug, Default)]
pub struct ProgressParser {
    kind: TransferKind,
    last: Option<Progress>,
}

impl ProgressParser {
    /// A parser for `git clone` output.
    pub fn new() -> Self {
        Self::default()
    }

    pub fn for_kind(kind: TransferKind) -> Self {
        Self { kind, last: None }
    }

    /// Feeds one stderr line. Returns an update if the line was progress
    /// output that moved the bar.
    pub fn feed(&mut self, line: &str) -> Option<Progress> {
        let (phase, phase_percent) = parse_line(line)?;
        if phase.weight(self.kind) == 0.0 {
            return None;
        }
        let overall = overall_percent(self.kind, phase, phase_percent);
        if let Some(last) = self.last {
            // Never move backwards (e.g. "Counting" lines printed late).
            if phase < last.phase || overall < last.overall_percent {
                return None;
            }
            if phase == last.phase && phase_percent == last.phase_percent {
                return None;
            }
        }
        let progress = Progress {
            phase,
            phase_percent,
            overall_percent: overall,
        };
        self.last = Some(progress);
        Some(progress)
    }
}

/// Parses lines like:
/// `remote: Compressing objects:  50% (5/10)` or
/// `Receiving objects:  33% (1/3), 1.20 MiB | 2.00 MiB/s`.
fn parse_line(line: &str) -> Option<(ProgressPhase, Option<u8>)> {
    let line = line.trim().strip_prefix("remote:").unwrap_or(line).trim();
    let (title, rest) = line.split_once(':')?;
    let phase = ProgressPhase::from_title(title.trim())?;
    let percent = rest
        .trim()
        .split_once('%')
        .and_then(|(n, _)| n.trim().parse::<u8>().ok())
        .filter(|p| *p <= 100);
    Some((phase, percent))
}

fn overall_percent(kind: TransferKind, phase: ProgressPhase, phase_percent: Option<u8>) -> u8 {
    let before: f64 = ProgressPhase::all()
        .into_iter()
        .take_while(|p| *p != phase)
        .map(|p| p.weight(kind))
        .sum();
    let within = phase.weight(kind) * f64::from(phase_percent.unwrap_or(0)) / 100.0;
    ((before + within) * 100.0).round().clamp(0.0, 100.0) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_remote_and_local_lines() {
        assert_eq!(
            parse_line("remote: Compressing objects:  50% (5/10)"),
            Some((ProgressPhase::Compressing, Some(50)))
        );
        assert_eq!(
            parse_line("Receiving objects:  33% (1/3), 1.20 MiB | 2.00 MiB/s"),
            Some((ProgressPhase::Receiving, Some(33)))
        );
        assert_eq!(
            parse_line("Resolving deltas: 100% (2/2), done."),
            Some((ProgressPhase::Resolving, Some(100)))
        );
        assert_eq!(
            parse_line("remote: Enumerating objects: 12, done."),
            Some((ProgressPhase::Counting, None))
        );
    }

    #[test]
    fn ignores_other_lines() {
        assert_eq!(parse_line("Cloning into 'garam'..."), None);
        assert_eq!(
            parse_line("warning: You appear to have cloned an empty repository."),
            None
        );
        assert_eq!(parse_line(""), None);
    }

    #[test]
    fn overall_progress_spans_phases() {
        let clone = TransferKind::Clone;
        assert_eq!(overall_percent(clone, ProgressPhase::Counting, Some(0)), 0);
        assert_eq!(
            overall_percent(clone, ProgressPhase::Receiving, Some(0)),
            10
        );
        assert_eq!(
            overall_percent(clone, ProgressPhase::Receiving, Some(100)),
            75
        );
        assert_eq!(
            overall_percent(clone, ProgressPhase::CheckingOut, Some(100)),
            100
        );
    }

    #[test]
    fn fetch_and_push_reach_full_progress() {
        let fetch = TransferKind::Fetch;
        assert_eq!(
            overall_percent(fetch, ProgressPhase::Resolving, Some(100)),
            100
        );
        let push = TransferKind::Push;
        assert_eq!(overall_percent(push, ProgressPhase::Writing, Some(0)), 30);
        assert_eq!(
            overall_percent(push, ProgressPhase::Writing, Some(100)),
            100
        );
    }

    #[test]
    fn push_parser_reads_writing_objects() {
        let mut parser = ProgressParser::for_kind(TransferKind::Push);
        let p = parser
            .feed("Writing objects:  50% (3/6), 1.00 KiB | 1.00 MiB/s")
            .unwrap();
        assert_eq!(p.phase, ProgressPhase::Writing);
        assert_eq!(p.overall_percent, 65);
        // Fetch-only phases are ignored for a push.
        assert!(parser.feed("Resolving deltas: 100% (2/2)").is_none());
    }

    #[test]
    fn parser_is_monotonic() {
        let mut parser = ProgressParser::new();
        assert!(parser.feed("Receiving objects:  50% (5/10)").is_some());
        assert!(parser.feed("Receiving objects:  50% (5/10)").is_none());
        assert!(
            parser
                .feed("remote: Counting objects: 100% (10/10)")
                .is_none()
        );
        let p = parser.feed("Resolving deltas:  20% (2/10)").unwrap();
        assert_eq!(p.phase, ProgressPhase::Resolving);
        assert_eq!(p.overall_percent, 78);
    }
}
