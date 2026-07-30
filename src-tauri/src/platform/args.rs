//! Command-line parsing. Supported:
//!   galaxy-terminal [--open-here <path>] [--new-window]
//! Anything else is ignored. Parsed once at startup and again by the
//! single-instance plugin for forwarded invocations.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CliArgs {
    pub open_here: Option<String>,
    pub new_window: bool,
}

pub fn parse<I: IntoIterator<Item = String>>(args: I) -> CliArgs {
    let mut out = CliArgs::default();
    let mut it = args.into_iter().skip(1); // executable name
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--open-here" => {
                if let Some(path) = it.next() {
                    let cleaned = path.trim_matches('"').to_string();
                    if !cleaned.is_empty() {
                        out.open_here = Some(cleaned);
                    }
                }
            }
            "--new-window" => out.new_window = true,
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_open_here() {
        let args = parse(vec![
            "gt.exe".into(),
            "--open-here".into(),
            "\"C:\\Program Files\\x\"".into(),
        ]);
        assert_eq!(args.open_here.as_deref(), Some("C:\\Program Files\\x"));
        assert!(!args.new_window);
    }

    #[test]
    fn ignores_unknown_args() {
        let args = parse(vec!["gt.exe".into(), "--something".into(), "x".into()]);
        assert_eq!(args, CliArgs::default());
    }
}
