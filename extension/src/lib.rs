use std::{env, fs};

use zed_extension_api::{
    self as zed, settings::LspSettings, LanguageServerId, LanguageServerInstallationStatus, Result,
};

/// npm package holding the language server.
const SERVER_PACKAGE: &str = "@thecode/claude-skills-lsp";

/// Pinned, never floated.
///
/// The extension and the server share an interface that is not LSP —
/// `initialization_options` is a config object we define — and registry updates
/// take days, so a floating server could break users the moment it is published
/// with no way to hot-fix. A CI job asserts this matches the server's
/// package.json.
const SERVER_VERSION: &str = "0.1.0";

/// Entry point inside the installed package.
const SERVER_ENTRY: &str = "node_modules/@thecode/claude-skills-lsp/bin/server.js";

/// Name of the npm `bin`, for a globally installed server on `$PATH`.
const SERVER_BIN: &str = "claude-skills-lsp";

struct ClaudeSkillsExtension {
    /// Avoids an npm registry round-trip on every language-server restart.
    /// Survives restarts but not `zed: reload extensions`, which is the right
    /// granularity.
    checked_managed_install: bool,
}

impl ClaudeSkillsExtension {
    fn server_entry_exists() -> bool {
        fs::metadata(SERVER_ENTRY).is_ok_and(|stat| stat.is_file())
    }

    /// Resolve the managed install to an ABSOLUTE path.
    ///
    /// `npm_install_package` installs relative to the extension's work
    /// directory, but the `Command` we return is executed by the host with the
    /// project as its cwd. Returning the relative path is the single most
    /// common cause of a server that exits immediately with MODULE_NOT_FOUND.
    fn managed_server_path(&mut self, language_server_id: &LanguageServerId) -> Result<String> {
        let exists = Self::server_entry_exists();
        if !(self.checked_managed_install && exists) {
            zed::set_language_server_installation_status(
                language_server_id,
                &LanguageServerInstallationStatus::CheckingForUpdate,
            );

            let installed = zed::npm_package_installed_version(SERVER_PACKAGE)?;
            if !exists || installed.as_deref() != Some(SERVER_VERSION) {
                zed::set_language_server_installation_status(
                    language_server_id,
                    &LanguageServerInstallationStatus::Downloading,
                );

                match zed::npm_install_package(SERVER_PACKAGE, SERVER_VERSION) {
                    Ok(()) => {
                        if !Self::server_entry_exists() {
                            return Err(format!(
                                "installed {SERVER_PACKAGE} but it does not contain {SERVER_ENTRY}"
                            ));
                        }
                    }
                    // Offline with a previous copy on disk is a working state,
                    // so only surface the error when there is nothing to run.
                    Err(error) => {
                        if !Self::server_entry_exists() {
                            return Err(error);
                        }
                    }
                }
            }
            self.checked_managed_install = true;
        }

        let cwd = env::current_dir()
            .map_err(|e| format!("could not resolve the extension working directory: {e}"))?;
        Ok(cwd.join(SERVER_ENTRY).to_string_lossy().into_owned())
    }
}

impl zed::Extension for ClaudeSkillsExtension {
    fn new() -> Self {
        Self {
            checked_managed_install: false,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        // An absent `lsp.<id>` block is the normal case, not an error.
        let user_binary = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .ok()
            .and_then(|settings| settings.binary);

        // --- 1. explicit override ------------------------------------------
        // Honour it exactly: no install status, no npm, no probing. This branch
        // is also the whole local dev loop — pointing `path` at a built
        // dist/server.js runs it under Zed's bundled Node.
        if let Some(binary) = user_binary.as_ref() {
            if let Some(path) = binary.path.as_ref() {
                let args = binary
                    .arguments
                    .clone()
                    .unwrap_or_else(|| vec!["--stdio".to_string()]);
                // CommandSettings carries a map; Command wants ordered pairs.
                let env: Vec<(String, String)> =
                    binary.env.clone().unwrap_or_default().into_iter().collect();

                if path.ends_with(".js") || path.ends_with(".mjs") || path.ends_with(".cjs") {
                    let mut full_args = vec![path.clone()];
                    full_args.extend(args);
                    return Ok(zed::Command {
                        command: zed::node_binary_path()?,
                        args: full_args,
                        env,
                    });
                }

                let command = if path.contains('/') || path.contains('\\') {
                    path.clone()
                } else {
                    worktree
                        .which(path)
                        .ok_or_else(|| format!("`{path}` was not found on $PATH"))?
                };
                return Ok(zed::Command { command, args, env });
            }
        }

        let extra_args = user_binary
            .and_then(|binary| binary.arguments)
            .unwrap_or_else(|| vec!["--stdio".to_string()]);

        // --- 2. a globally installed server --------------------------------
        if let Some(command) = worktree.which(SERVER_BIN) {
            return Ok(zed::Command {
                command,
                args: extra_args,
                // Inherit the worktree env so nvm/mise/asdf shims resolve.
                env: worktree.shell_env(),
            });
        }

        // --- 3. managed npm install ----------------------------------------
        let entry = self.managed_server_path(language_server_id)?;
        let mut args = vec![entry];
        args.extend(extra_args);

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args,
            env: Default::default(),
        })
    }

    /// Defaults the user can override from `lsp.claude-skills-lsp.initialization_options`.
    fn language_server_initialization_options(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<zed::serde_json::Value>> {
        let user = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .ok()
            .and_then(|settings| settings.initialization_options);

        let mut options = match user {
            Some(zed::serde_json::Value::Object(map)) => map,
            _ => zed::serde_json::Map::new(),
        };

        // The user always wins: only fill in what they did not set.
        let scoped = options
            .entry("claudeSkills")
            .or_insert_with(|| zed::serde_json::json!({}));
        if let Some(map) = scoped.as_object_mut() {
            map.entry("enabled").or_insert(true.into());
            map.entry("reportUndocumented").or_insert(true.into());
            map.entry("portability").or_insert(false.into());
            map.entry("client").or_insert(zed::serde_json::json!({
                "name": "zed",
                "extensionVersion": env!("CARGO_PKG_VERSION"),
            }));
        }

        Ok(Some(zed::serde_json::Value::Object(options)))
    }
}

zed::register_extension!(ClaudeSkillsExtension);
