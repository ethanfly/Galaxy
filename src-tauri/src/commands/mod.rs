//! Whitelisted Tauri commands (spec §3.3). No generic file or process
//! execution capability is exposed to the WebView — every command is a
//! narrow, typed operation.
pub mod features;
pub mod pty_cmds;
pub mod system;
pub mod workspace;

macro_rules! all_commands {
    () => {
        tauri::generate_handler![
            // workspace
            crate::commands::workspace::project_list,
            crate::commands::workspace::project_add,
            crate::commands::workspace::project_update,
            crate::commands::workspace::project_remove,
            crate::commands::workspace::session_list,
            crate::commands::workspace::session_create,
            crate::commands::workspace::session_close,
            crate::commands::workspace::session_rename,
            crate::commands::workspace::session_reorder,
            crate::commands::workspace::session_set_sync_input,
            crate::commands::workspace::pane_split,
            crate::commands::workspace::pane_close,
            crate::commands::workspace::pane_move_to_session,
            crate::commands::workspace::layout_set_ratio,
            crate::commands::workspace::template_save,
            crate::commands::workspace::template_apply,
            crate::commands::workspace::template_delete,
            crate::commands::workspace::workspace_restore,
            crate::commands::workspace::recovery_clean_start,
            // pty
            crate::commands::pty_cmds::pty_write,
            crate::commands::pty_cmds::pty_broadcast,
            crate::commands::pty_cmds::pty_resize,
            crate::commands::pty_cmds::pty_replay,
            crate::commands::pty_cmds::pty_observe_screen,
            crate::commands::pty_cmds::pty_kill,
            // features
            crate::commands::features::block_list,
            crate::commands::features::block_search,
            crate::commands::features::block_set_favorite,
            crate::commands::features::block_rerun,
            crate::commands::features::blocks_clear_non_favorites,
            crate::commands::features::insights_summary,
            crate::commands::features::agent_scan,
            crate::commands::features::agent_scan_cancel,
            crate::commands::features::agent_availability,
            crate::commands::features::agent_messages,
            crate::commands::features::agent_open_conversation,
            crate::commands::features::agent_status_map,
            crate::commands::features::git_status,
            crate::commands::features::git_branches,
            crate::commands::features::git_checkout,
            crate::commands::features::git_refresh,
            crate::commands::features::workflow_list,
            crate::commands::features::workflow_resolve,
            crate::commands::features::workflow_run,
            crate::commands::features::notification_list,
            crate::commands::features::notification_mark_read,
            // system
            crate::commands::system::config_get,
            crate::commands::system::config_update,
            crate::commands::system::config_reset_shortcuts,
            crate::commands::system::profiles_list,
            crate::commands::system::profiles_redetect,
            crate::commands::system::diagnostics_info,
            crate::commands::system::diagnostics_report,
            crate::commands::system::system_open_external,
            crate::commands::system::system_open_path,
            crate::commands::system::system_pending_open_here,
            crate::commands::system::window_save_state,
            crate::commands::system::boot_info,
            crate::commands::system::updater_check,
            crate::commands::system::context_menu_set,
        ]
    };
}

pub(crate) use all_commands;
