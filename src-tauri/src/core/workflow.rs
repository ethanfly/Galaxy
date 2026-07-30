//! Parameterized command templates (`{{param}}`), spec §5.6.
//! Parameters are validated against their declared types before the command
//! is ever handed to a PTY or a process.
use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ParamType {
    String,
    Int,
    Bool,
    Choice(Vec<String>),
    Path,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowParam {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: ParamType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
    #[serde(default)]
    pub required: bool,
    /// Allowed characters beyond alphanumerics for String params when the
    /// value will flow into a shell command line (defense in depth).
    #[serde(default)]
    pub allow_shell_chars: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CwdMode {
    Project,
    CurrentPane,
    Fixed(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub command_template: String,
    #[serde(default)]
    pub params: Vec<WorkflowParam>,
    #[serde(default)]
    pub cwd: Option<CwdMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    /// Show the fully resolved command and target directory before running.
    #[serde(default = "default_true")]
    pub confirm_before_run: bool,
}

fn default_true() -> bool {
    true
}

impl Default for Workflow {
    fn default() -> Self {
        Self {
            id: super::models::new_id(),
            name: String::new(),
            description: String::new(),
            command_template: String::new(),
            params: Vec::new(),
            cwd: None,
            profile_id: None,
            confirm_before_run: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedWorkflow {
    pub command: String,
    pub cwd: Option<String>,
    pub requires_confirmation: bool,
}

static TEMPLATE_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();

fn template_re() -> &'static regex::Regex {
    TEMPLATE_RE.get_or_init(|| regex::Regex::new(r"\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}").unwrap())
}

/// Characters that may not appear in validated parameter values unless the
/// param explicitly allows shell metacharacters.
fn is_safe_value(v: &str, allow_shell_chars: bool) -> bool {
    if allow_shell_chars {
        return !v.contains('\0') && !v.contains('\r') && !v.contains('\n');
    }
    !v.chars().any(|c| matches!(c, '\0' | '\r' | '\n' | '|' | '&' | ';' | '<' | '>' | '`' | '$' | '(' | ')' | '{' | '}' | '[' | ']' | '"' | '\'' | '\\'))
}

pub fn validate_value(param: &WorkflowParam, raw: &str) -> Result<String, AppError> {
    let v = raw.trim();
    match &param.ty {
        ParamType::String => {
            if param.required && v.is_empty() {
                return Err(AppError::InvalidInput(format!("参数 {} 为必填项", param.name)));
            }
            if !is_safe_value(v, param.allow_shell_chars) {
                return Err(AppError::InvalidInput(format!(
                    "参数 {} 包含不允许的字符",
                    param.name
                )));
            }
        }
        ParamType::Int => {
            if param.required && v.is_empty() {
                return Err(AppError::InvalidInput(format!("参数 {} 为必填项", param.name)));
            }
            if !v.is_empty() && v.parse::<i64>().is_err() {
                return Err(AppError::InvalidInput(format!("参数 {} 必须是整数", param.name)));
            }
        }
        ParamType::Bool => {
            if !matches!(v, "" | "true" | "false" | "0" | "1") {
                return Err(AppError::InvalidInput(format!("参数 {} 必须是布尔值", param.name)));
            }
        }
        ParamType::Choice(options) => {
            if param.required && v.is_empty() {
                return Err(AppError::InvalidInput(format!("参数 {} 为必填项", param.name)));
            }
            if !v.is_empty() && !options.iter().any(|o| o == v) {
                return Err(AppError::InvalidInput(format!(
                    "参数 {} 必须是以下之一: {}",
                    param.name,
                    options.join(", ")
                )));
            }
        }
        ParamType::Path => {
            if param.required && v.is_empty() {
                return Err(AppError::InvalidInput(format!("参数 {} 为必填项", param.name)));
            }
            if v.contains('\0') {
                return Err(AppError::InvalidInput(format!("参数 {} 不是合法路径", param.name)));
            }
        }
    }
    Ok(v.to_string())
}

impl Workflow {
    /// Fill the template. Missing params fall back to defaults; unknown
    /// placeholders fail loudly instead of leaking `{{name}}` into a shell.
    pub fn resolve(
        &self,
        values: &std::collections::HashMap<String, String>,
        cwd: Option<String>,
    ) -> Result<ResolvedWorkflow, AppError> {
        let mut resolved = self.command_template.clone();
        for param in &self.params {
            let raw = values
                .get(&param.name)
                .cloned()
                .or_else(|| param.default.clone())
                .unwrap_or_default();
            let value = validate_value(param, &raw)?;
            let re = regex::Regex::new(&format!(
                r"\{{\{{\s*{}\s*\}}\}}",
                regex::escape(&param.name)
            ))
            .map_err(|e| AppError::Internal(e.to_string()))?;
            resolved = re.replace_all(&resolved, value.as_str()).to_string();
        }
        // Any placeholder left behind is an error.
        if let Some(m) = template_re().find(&resolved) {
            return Err(AppError::InvalidInput(format!(
                "Workflow 包含未声明的参数: {}",
                m.as_str()
            )));
        }
        Ok(ResolvedWorkflow {
            command: resolved,
            cwd,
            requires_confirmation: self.confirm_before_run,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn workflow() -> Workflow {
        Workflow {
            command_template: "git log --oneline -n {{count}} {{extra}}".into(),
            params: vec![
                WorkflowParam {
                    name: "count".into(),
                    ty: ParamType::Int,
                    default: Some("5".into()),
                    required: true,
                    allow_shell_chars: false,
                },
                WorkflowParam {
                    name: "extra".into(),
                    ty: ParamType::String,
                    default: None,
                    required: false,
                    allow_shell_chars: false,
                },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn resolves_template_with_types() {
        let wf = workflow();
        let out = wf
            .resolve(&HashMap::from([("count".into(), "10".into())]), Some("C:\\proj".into()))
            .unwrap();
        assert_eq!(out.command, "git log --oneline -n 10 ");
        assert_eq!(out.cwd.as_deref(), Some("C:\\proj"));
    }

    #[test]
    fn rejects_invalid_int() {
        let wf = workflow();
        let err = wf.resolve(&HashMap::from([("count".into(), "abc".into())]), None);
        assert!(err.is_err());
    }

    #[test]
    fn rejects_shell_injection_in_string_param() {
        let wf = workflow();
        let err = wf.resolve(
            &HashMap::from([("extra".into(), "; rm -rf /".into())]),
            None,
        );
        assert!(err.is_err());
    }

    #[test]
    fn rejects_undeclared_placeholders() {
        let mut wf = workflow();
        wf.command_template = "echo {{nope}}".into();
        let err = wf.resolve(&HashMap::new(), None);
        assert!(err.is_err());
    }
}
