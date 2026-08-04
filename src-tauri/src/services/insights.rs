use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, Date, Duration, OffsetDateTime, UtcOffset};

use crate::core::models::{AgentKind, CommandBlock, Project};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InsightsRange {
    SevenDays,
    ThirtyDays,
    NinetyDays,
    Year,
}

impl InsightsRange {
    fn days(self) -> i64 {
        match self {
            Self::SevenDays => 7,
            Self::ThirtyDays => 30,
            Self::NinetyDays => 90,
            Self::Year => 365,
        }
    }
}

#[derive(Debug, Clone)]
pub struct InsightsQuery {
    pub project_id: Option<String>,
    pub range: InsightsRange,
    pub timezone_offset_minutes: i32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryMetrics {
    pub command_count: usize,
    pub active_days: usize,
    pub completed_count: usize,
    pub success_count: usize,
    pub success_rate: Option<f64>,
    pub active_duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DailyActivity {
    pub date: String,
    pub command_count: usize,
    pub success_count: usize,
    pub failure_count: usize,
    pub agent_command_count: usize,
    pub active_duration_ms: i64,
    pub level: u8,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInsight {
    pub project_id: String,
    pub project_name: String,
    pub command_count: usize,
    pub completed_count: usize,
    pub failure_count: usize,
    pub failure_rate: Option<f64>,
    pub active_duration_ms: i64,
    pub last_activity_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentInsight {
    pub agent_kind: Option<AgentKind>,
    pub command_count: usize,
    pub session_count: usize,
    pub last_activity_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentActivity {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub session_id: String,
    pub pane_id: String,
    pub command: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub exit_code: Option<i32>,
    pub agent_kind: Option<AgentKind>,
    pub favorite: bool,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InsightsSummary {
    pub range: InsightsRange,
    pub range_start: String,
    pub range_end: String,
    pub generated_at: String,
    pub summary: SummaryMetrics,
    pub daily: Vec<DailyActivity>,
    pub projects: Vec<ProjectInsight>,
    pub agents: Vec<AgentInsight>,
    pub recent: Vec<RecentActivity>,
    pub invalid_record_count: usize,
}

#[derive(Default)]
struct ProjectAccumulator {
    command_count: usize,
    completed_count: usize,
    failure_count: usize,
    active_duration_ms: i64,
    last_activity_at: String,
}

#[derive(Default)]
struct AgentAccumulator {
    command_count: usize,
    sessions: HashSet<String>,
    last_activity_at: String,
}

pub fn aggregate(
    blocks: &[CommandBlock],
    projects: &[Project],
    query: InsightsQuery,
    now: OffsetDateTime,
) -> InsightsSummary {
    let offset_seconds = query
        .timezone_offset_minutes
        .saturating_neg()
        .saturating_mul(60)
        .clamp(-86_399, 86_399);
    let offset = UtcOffset::from_whole_seconds(offset_seconds).unwrap_or(UtcOffset::UTC);
    let local_now = now.to_offset(offset);
    let end_date = local_now.date();
    let start_date = end_date - Duration::days(query.range.days() - 1);
    let project_names = projects
        .iter()
        .map(|project| (project.id.as_str(), project.name.as_str()))
        .collect::<HashMap<_, _>>();

    let mut daily = complete_days(start_date, query.range.days());
    let mut project_stats: HashMap<String, ProjectAccumulator> = HashMap::new();
    let mut agent_stats: HashMap<Option<AgentKind>, AgentAccumulator> = HashMap::new();
    let mut valid_blocks: Vec<(&CommandBlock, OffsetDateTime, Option<i64>)> = Vec::new();
    let mut invalid_record_count = 0usize;

    for block in blocks {
        if query
            .project_id
            .as_deref()
            .is_some_and(|id| id != block.project_id)
        {
            continue;
        }
        let Ok(started) = OffsetDateTime::parse(&block.started_at, &Rfc3339) else {
            invalid_record_count += 1;
            continue;
        };
        let local_date = started.to_offset(offset).date();
        if local_date < start_date || local_date > end_date {
            continue;
        }
        let duration_ms = valid_duration_ms(started, block.ended_at.as_deref());
        valid_blocks.push((block, started, duration_ms));

        let day = daily.get_mut(&local_date).expect("complete date range");
        day.command_count += 1;
        if block.exit_code == Some(0) {
            day.success_count += 1;
        } else if block.exit_code.is_some() {
            day.failure_count += 1;
        }
        if block.agent_kind.is_some() {
            day.agent_command_count += 1;
        }
        day.active_duration_ms += duration_ms.unwrap_or(0);

        let project = project_stats.entry(block.project_id.clone()).or_default();
        project.command_count += 1;
        if block.exit_code.is_some() {
            project.completed_count += 1;
        }
        if block.exit_code.is_some_and(|code| code != 0) {
            project.failure_count += 1;
        }
        project.active_duration_ms += duration_ms.unwrap_or(0);
        if block.started_at > project.last_activity_at {
            project.last_activity_at.clone_from(&block.started_at);
        }

        let agent = agent_stats.entry(block.agent_kind).or_default();
        agent.command_count += 1;
        agent.sessions.insert(block.session_id.clone());
        if block.started_at > agent.last_activity_at {
            agent.last_activity_at.clone_from(&block.started_at);
        }
    }

    let non_zero = daily
        .values()
        .filter_map(|day| (day.command_count > 0).then_some(day.command_count))
        .collect::<Vec<_>>();
    let thresholds = quartile_thresholds(&non_zero);
    for day in daily.values_mut() {
        day.level = activity_level(day.command_count, thresholds);
    }

    let command_count = valid_blocks.len();
    let completed_count = valid_blocks
        .iter()
        .filter(|(block, _, _)| block.exit_code.is_some())
        .count();
    let success_count = valid_blocks
        .iter()
        .filter(|(block, _, _)| block.exit_code == Some(0))
        .count();
    let success_rate =
        (completed_count > 0).then_some(success_count as f64 / completed_count as f64);
    let active_duration_ms = valid_blocks
        .iter()
        .filter_map(|(_, _, duration)| *duration)
        .sum();
    let active_days = daily.values().filter(|day| day.command_count > 0).count();

    let mut projects = project_stats
        .into_iter()
        .map(|(project_id, stats)| ProjectInsight {
            project_name: project_names
                .get(project_id.as_str())
                .copied()
                .unwrap_or("Unknown project")
                .to_string(),
            project_id,
            command_count: stats.command_count,
            completed_count: stats.completed_count,
            failure_count: stats.failure_count,
            failure_rate: (stats.completed_count > 0)
                .then_some(stats.failure_count as f64 / stats.completed_count as f64),
            active_duration_ms: stats.active_duration_ms,
            last_activity_at: stats.last_activity_at,
        })
        .collect::<Vec<_>>();
    projects.sort_by(|left, right| {
        right
            .command_count
            .cmp(&left.command_count)
            .then_with(|| left.project_name.cmp(&right.project_name))
    });

    let mut agents = agent_stats
        .into_iter()
        .map(|(agent_kind, stats)| AgentInsight {
            agent_kind,
            command_count: stats.command_count,
            session_count: stats.sessions.len(),
            last_activity_at: stats.last_activity_at,
        })
        .collect::<Vec<_>>();
    agents.sort_by(|left, right| right.command_count.cmp(&left.command_count));

    valid_blocks.sort_by(|left, right| right.1.cmp(&left.1));
    let recent = valid_blocks
        .into_iter()
        .take(50)
        .map(|(block, _, duration_ms)| RecentActivity {
            id: block.id.clone(),
            project_id: block.project_id.clone(),
            project_name: project_names
                .get(block.project_id.as_str())
                .copied()
                .unwrap_or("Unknown project")
                .to_string(),
            session_id: block.session_id.clone(),
            pane_id: block.pane_id.clone(),
            command: block.command.clone(),
            started_at: block.started_at.clone(),
            ended_at: block.ended_at.clone(),
            exit_code: block.exit_code,
            agent_kind: block.agent_kind,
            favorite: block.favorite,
            duration_ms,
        })
        .collect();

    InsightsSummary {
        range: query.range,
        range_start: format_date(start_date),
        range_end: format_date(end_date),
        generated_at: now.format(&Rfc3339).unwrap_or_default(),
        summary: SummaryMetrics {
            command_count,
            active_days,
            completed_count,
            success_count,
            success_rate,
            active_duration_ms,
        },
        daily: daily.into_values().collect(),
        projects,
        agents,
        recent,
        invalid_record_count,
    }
}

fn complete_days(start: Date, count: i64) -> BTreeMap<Date, DailyActivity> {
    (0..count)
        .map(|offset| {
            let date = start + Duration::days(offset);
            (
                date,
                DailyActivity {
                    date: format_date(date),
                    command_count: 0,
                    success_count: 0,
                    failure_count: 0,
                    agent_command_count: 0,
                    active_duration_ms: 0,
                    level: 0,
                },
            )
        })
        .collect()
}

fn format_date(date: Date) -> String {
    date.to_string()
}

fn valid_duration_ms(started: OffsetDateTime, ended_at: Option<&str>) -> Option<i64> {
    let ended = OffsetDateTime::parse(ended_at?, &Rfc3339).ok()?;
    let duration = ended - started;
    (!duration.is_negative()).then_some(duration.whole_milliseconds().min(i64::MAX as i128) as i64)
}

fn quartile_thresholds(counts: &[usize]) -> Option<[usize; 3]> {
    if counts.is_empty() {
        return None;
    }
    let mut sorted = counts.to_vec();
    sorted.sort_unstable();
    let rank = |percent: usize| {
        let index = (sorted.len() * percent).div_ceil(100).saturating_sub(1);
        sorted[index]
    };
    Some([rank(25), rank(50), rank(75)])
}

fn activity_level(count: usize, thresholds: Option<[usize; 3]>) -> u8 {
    let Some([low, middle, high]) = thresholds else {
        return 0;
    };
    if count == 0 {
        0
    } else if count <= low {
        1
    } else if count <= middle {
        2
    } else if count <= high {
        3
    } else {
        4
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::models::{AgentKind, CommandBlock, Project};
    use time::{format_description::well_known::Rfc3339, OffsetDateTime};

    fn block(
        id: &str,
        project_id: &str,
        session_id: &str,
        started_at: &str,
        ended_at: Option<&str>,
        exit_code: Option<i32>,
        agent_kind: Option<AgentKind>,
    ) -> CommandBlock {
        CommandBlock {
            id: id.into(),
            project_id: project_id.into(),
            session_id: session_id.into(),
            pane_id: format!("pane-{session_id}"),
            command: format!("command-{id}"),
            output: String::new(),
            started_at: started_at.into(),
            ended_at: ended_at.map(str::to_string),
            exit_code,
            agent_kind,
            favorite: false,
        }
    }

    fn project(id: &str, name: &str) -> Project {
        Project {
            id: id.into(),
            name: name.into(),
            path: format!("C:\\{id}"),
            color: "#00aa88".into(),
            default_profile_id: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            last_accessed_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn at(value: &str) -> OffsetDateTime {
        OffsetDateTime::parse(value, &Rfc3339).unwrap()
    }

    #[test]
    fn empty_summary_contains_complete_zero_days() {
        let result = aggregate(
            &[],
            &[],
            InsightsQuery {
                project_id: None,
                range: InsightsRange::SevenDays,
                timezone_offset_minutes: 0,
            },
            at("2026-08-04T12:00:00Z"),
        );

        assert_eq!(result.summary.command_count, 0);
        assert_eq!(result.summary.active_days, 0);
        assert_eq!(result.summary.success_rate, None);
        assert_eq!(result.daily.len(), 7);
        assert_eq!(result.daily.first().unwrap().date, "2026-07-29");
        assert_eq!(result.daily.last().unwrap().date, "2026-08-04");
        assert!(result.projects.is_empty());
        assert!(result.agents.is_empty());
        assert!(result.recent.is_empty());
    }

    #[test]
    fn aggregates_results_duration_projects_agents_and_invalid_records() {
        let blocks = vec![
            block(
                "1",
                "p1",
                "s1",
                "2026-08-03T10:00:00Z",
                Some("2026-08-03T10:00:02Z"),
                Some(0),
                Some(AgentKind::Codex),
            ),
            block(
                "2",
                "p1",
                "s1",
                "2026-08-03T11:00:00Z",
                Some("2026-08-03T10:59:00Z"),
                Some(2),
                Some(AgentKind::Codex),
            ),
            block("3", "p2", "s2", "2026-08-04T01:00:00Z", None, None, None),
            block("bad", "p2", "s3", "not-a-time", None, Some(0), None),
        ];

        let result = aggregate(
            &blocks,
            &[project("p1", "Galaxy"), project("p2", "Orbit")],
            InsightsQuery {
                project_id: None,
                range: InsightsRange::SevenDays,
                timezone_offset_minutes: 0,
            },
            at("2026-08-04T12:00:00Z"),
        );

        assert_eq!(result.summary.command_count, 3);
        assert_eq!(result.summary.active_days, 2);
        assert_eq!(result.summary.completed_count, 2);
        assert_eq!(result.summary.success_count, 1);
        assert_eq!(result.summary.success_rate, Some(0.5));
        assert_eq!(result.summary.active_duration_ms, 2_000);
        assert_eq!(result.invalid_record_count, 1);
        assert_eq!(result.projects[0].project_id, "p1");
        assert_eq!(result.projects[0].command_count, 2);
        assert_eq!(result.agents[0].agent_kind, Some(AgentKind::Codex));
        assert_eq!(result.agents[0].session_count, 1);
        assert_eq!(result.recent.len(), 3);
    }

    #[test]
    fn applies_project_filter_and_local_timezone_day_boundary() {
        let blocks = vec![
            block(
                "local",
                "p1",
                "s1",
                "2026-08-03T16:30:00Z",
                Some("2026-08-03T16:31:00Z"),
                Some(0),
                None,
            ),
            block(
                "other",
                "p2",
                "s2",
                "2026-08-04T02:00:00Z",
                None,
                None,
                None,
            ),
        ];

        let result = aggregate(
            &blocks,
            &[project("p1", "Galaxy"), project("p2", "Orbit")],
            InsightsQuery {
                project_id: Some("p1".into()),
                range: InsightsRange::SevenDays,
                // Browser Date#getTimezoneOffset returns UTC - local time.
                timezone_offset_minutes: -480,
            },
            at("2026-08-04T12:00:00Z"),
        );

        assert_eq!(result.summary.command_count, 1);
        let today = result
            .daily
            .iter()
            .find(|d| d.date == "2026-08-04")
            .unwrap();
        assert_eq!(today.command_count, 1);
        assert_eq!(result.projects.len(), 1);
        assert_eq!(result.projects[0].project_id, "p1");
    }

    #[test]
    fn assigns_stable_activity_levels_for_repeated_counts() {
        let blocks = (1..=5)
            .flat_map(|day| {
                (0..day).map(move |index| {
                    block(
                        &format!("{day}-{index}"),
                        "p1",
                        "s1",
                        &format!("2026-08-0{day}T10:00:00Z"),
                        None,
                        None,
                        None,
                    )
                })
            })
            .collect::<Vec<_>>();

        let result = aggregate(
            &blocks,
            &[project("p1", "Galaxy")],
            InsightsQuery {
                project_id: None,
                range: InsightsRange::SevenDays,
                timezone_offset_minutes: 0,
            },
            at("2026-08-05T12:00:00Z"),
        );
        let levels = result
            .daily
            .iter()
            .filter(|day| day.command_count > 0)
            .map(|day| day.level)
            .collect::<Vec<_>>();

        assert_eq!(levels, vec![1, 1, 2, 3, 4]);
    }
}
