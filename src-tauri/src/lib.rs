use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    env,
    fs::{self, File},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

const HTTP_TIMEOUT_SECONDS: u64 = 12;
const DOWNLOAD_TIMEOUT_SECONDS: u64 = 300;
const SHADOWS_MANIFEST_URL: &str = "https://aethro.net/launcher/shadows/stable/manifest.json";

#[derive(Debug, Serialize, Deserialize)]
struct HashResult {
    path: String,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModpackFileStatus {
    path: String,
    status: String,
    expected_sha256: Option<String>,
    actual_sha256: Option<String>,
    size_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModpackCheckResult {
    game_id: String,
    display_name: String,
    channel: String,
    install_dir: String,
    total_files: usize,
    ok_files: usize,
    missing_files: usize,
    changed_files: usize,
    invalid_manifest_files: usize,
    ready: bool,
    files: Vec<ModpackFileStatus>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShadowsRepairProgress {
    phase: String,
    message: String,
    current_file: Option<String>,
    current_index: usize,
    total_files: usize,
    downloaded_bytes: u64,
    total_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalMinecraftProfile {
    name: String,
    uuid: Option<String>,
    source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShadowsManifest {
    game_id: String,
    channel: String,
    display_name: String,
    minecraft: Option<ShadowsManifestMinecraft>,
    launch: Option<ShadowsManifestLaunch>,
    remove_extra_files_under: Option<Vec<String>>,
    files: Vec<ShadowsManifestFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShadowsManifestMinecraft {
    version: String,
    loader: String,
    loader_version: Option<String>,
    java_major: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShadowsManifestLaunch {
    jvm_args: Option<Vec<String>>,
    game_args: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShadowsManifestFile {
    path: String,
    url: Option<String>,
    sha256: String,
    size_bytes: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct FabricLoaderEntry {
    loader: FabricLoaderInfo,
}

#[derive(Debug, Deserialize)]
struct FabricLoaderInfo {
    version: String,
    stable: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthLoginRequest {
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    scope: String,
    #[serde(default)]
    use_pkce: bool,
    #[serde(default = "default_token_auth_method")]
    token_auth_method: TokenAuthMethod,
    authorize_url: String,
    token_url: String,
    userinfo_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum TokenAuthMethod {
    ClientSecretBasic,
    ClientSecretPost,
    None,
}

fn default_token_auth_method() -> TokenAuthMethod {
    TokenAuthMethod::ClientSecretBasic
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    expires_at: Option<String>,
}

fn extract_token_response(value: serde_json::Value) -> Result<TokenResponse, String> {
    let candidate = value
        .get("data")
        .or_else(|| value.get("token"))
        .or_else(|| value.get("oauth"))
        .unwrap_or(&value)
        .clone();

    serde_json::from_value::<TokenResponse>(candidate.clone()).map_err(|e| {
        format!(
            "Unable to parse Aethro token response: {e}. Body: {}",
            candidate.to_string().chars().take(500).collect::<String>()
        )
    })
}

fn extract_user_info(value: serde_json::Value) -> Result<FlexibleUserInfo, String> {
    let candidate = value
        .get("data")
        .or_else(|| value.get("user"))
        .or_else(|| value.get("account"))
        .or_else(|| value.get("profile"))
        .unwrap_or(&value)
        .clone();

    serde_json::from_value::<FlexibleUserInfo>(candidate.clone()).map_err(|e| {
        format!(
            "Unable to parse Aethro user info response: {e}. Body: {}",
            candidate.to_string().chars().take(500).collect::<String>()
        )
    })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UserProfile {
    id: String,
    display_name: String,
    username: Option<String>,
    email: Option<String>,
    avatar_url: Option<String>,
    minecraft_name: Option<String>,
    minecraft_uuid: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSession {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<String>,
    user: UserProfile,
}

#[derive(Debug, Deserialize)]
struct FlexibleUserInfo {
    id: Option<serde_json::Value>,
    sub: Option<serde_json::Value>,
    #[serde(alias = "userId")]
    user_id: Option<serde_json::Value>,
    discord_user_id: Option<serde_json::Value>,
    username: Option<String>,
    discord_username: Option<String>,
    name: Option<String>,
    #[serde(alias = "displayName", alias = "display_name")]
    display_name: Option<String>,
    email: Option<String>,
    #[serde(alias = "avatarUrl", alias = "avatar_url")]
    avatar_url: Option<String>,
    avatar: Option<String>,
    picture: Option<String>,
    #[serde(
        alias = "minecraftName",
        alias = "minecraft_name",
        alias = "minecraft_username"
    )]
    minecraft_name: Option<String>,
    #[serde(alias = "minecraftUuid", alias = "minecraft_uuid")]
    minecraft_uuid: Option<String>,
}

fn random_string(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn value_to_string(value: Option<serde_json::Value>) -> Option<String> {
    value.map(|v| match v {
        serde_json::Value::String(s) => s,
        serde_json::Value::Number(n) => n.to_string(),
        other => other.to_string(),
    })
}

fn user_profile_from_info(info: FlexibleUserInfo) -> UserProfile {
    let discord_user_id = value_to_string(info.discord_user_id);
    let username = info.username.or(info.discord_username);

    let id = value_to_string(info.sub)
        .or_else(|| value_to_string(info.id))
        .or_else(|| value_to_string(info.user_id))
        .or_else(|| discord_user_id.clone())
        .unwrap_or_else(|| "aethro-user".to_string());

    let display_name = info
        .display_name
        .clone()
        .or(info.name.clone())
        .or(username.clone())
        .or(discord_user_id)
        .or(info.email.clone())
        .unwrap_or_else(|| "Aethro Hero".to_string());

    UserProfile {
        id,
        display_name,
        username,
        email: info.email,
        avatar_url: info.avatar_url.or(info.avatar).or(info.picture),
        minecraft_name: info.minecraft_name,
        minecraft_uuid: info.minecraft_uuid,
    }
}

fn read_http_request(stream: &mut TcpStream) -> Result<String, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(120)))
        .map_err(|e| format!("Unable to set OAuth callback timeout: {e}"))?;

    let mut buffer = [0_u8; 8192];
    let size = stream
        .read(&mut buffer)
        .map_err(|e| format!("Unable to read OAuth callback: {e}"))?;

    String::from_utf8(buffer[..size].to_vec())
        .map_err(|e| format!("OAuth callback was not valid UTF-8: {e}"))
}

fn write_callback_response(stream: &mut TcpStream, ok: bool) -> Result<(), String> {
    let body = if ok {
        "<html><body style=\"font-family:system-ui;background:#06131f;color:#e8f7ff;padding:40px\"><h1>Play Aethro login received</h1><p>You can close this browser tab and return to the launcher to finish signing in.</p></body></html>"
    } else {
        "<html><body style=\"font-family:system-ui;background:#1f0606;color:#ffe8e8;padding:40px\"><h1>Play Aethro login failed</h1><p>Return to the launcher and try again.</p></body></html>"
    };

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );

    stream
        .write_all(response.as_bytes())
        .map_err(|e| format!("Unable to write OAuth callback response: {e}"))
}

fn callback_listener_from_redirect_uri(redirect_uri: &str) -> Result<(String, String), String> {
    let parsed = reqwest::Url::parse(redirect_uri)
        .map_err(|e| format!("Invalid OAuth redirect URI: {e}"))?;

    if parsed.scheme() != "http" {
        return Err("OAuth redirect URI must use http for the local callback.".to_string());
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "OAuth redirect URI is missing a host.".to_string())?;

    if host != "127.0.0.1" && host != "localhost" {
        return Err("OAuth redirect URI must use 127.0.0.1 or localhost.".to_string());
    }

    let port = parsed
        .port()
        .ok_or_else(|| "OAuth redirect URI must include an explicit local port.".to_string())?;

    Ok((format!("{host}:{port}"), parsed.path().to_string()))
}

fn parse_callback(
    request: &str,
    expected_state: &str,
    expected_path: &str,
) -> Result<String, String> {
    let first_line = request.lines().next().unwrap_or_default();
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();

    if method != "GET" || path.is_empty() {
        return Err("OAuth callback did not contain a GET request.".to_string());
    }

    let parsed = reqwest::Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|e| format!("Unable to parse OAuth callback URL: {e}"))?;

    if parsed.path() != expected_path {
        return Err(format!(
            "OAuth callback path did not match. Expected {expected_path}, received {}.",
            parsed.path()
        ));
    }

    let params: HashMap<String, String> = parsed.query_pairs().into_owned().collect();

    if let Some(error) = params.get("error") {
        return Err(format!("Aethro login returned an error: {error}"));
    }

    let state = params
        .get("state")
        .ok_or_else(|| "OAuth callback was missing state.".to_string())?;

    if state != expected_state {
        return Err(
            "OAuth callback state did not match. Login was cancelled for safety.".to_string(),
        );
    }

    params
        .get("code")
        .cloned()
        .ok_or_else(|| "OAuth callback was missing an authorization code.".to_string())
}

fn add_query(url: &str, params: &[(&str, String)]) -> Result<String, String> {
    let mut parsed = reqwest::Url::parse(url).map_err(|e| format!("Invalid OAuth URL: {e}"))?;
    {
        let mut query = parsed.query_pairs_mut();
        for (name, value) in params {
            query.append_pair(name, value);
        }
    }
    Ok(parsed.to_string())
}

fn is_real_sha256(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit())
}

fn safe_join(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.is_absolute() {
        return Err(format!("Manifest path must be relative: {relative}"));
    }

    let mut joined = base.to_path_buf();
    for component in path.components() {
        match component {
            Component::Normal(part) => joined.push(part),
            Component::CurDir => {}
            _ => return Err(format!("Manifest path is not allowed: {relative}")),
        }
    }

    Ok(joined)
}

fn minecraft_launcher_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Ok(appdata) = env::var("APPDATA") {
        dirs.push(PathBuf::from(appdata).join(".minecraft"));
    }

    if let Ok(home) = env::var("HOME") {
        let home = PathBuf::from(home);
        dirs.push(
            home.join("Library")
                .join("Application Support")
                .join("minecraft"),
        );
        dirs.push(home.join(".minecraft"));
    }

    dirs
}

fn primary_minecraft_launcher_dir() -> Result<PathBuf, String> {
    let dirs = minecraft_launcher_dirs();
    dirs.iter()
        .find(|dir| dir.exists())
        .cloned()
        .or_else(|| dirs.into_iter().next())
        .ok_or_else(|| "Unable to locate the Minecraft Launcher folder.".to_string())
}

fn json_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|field| field.as_str())
        .map(str::trim)
        .filter(|field| !field.is_empty())
        .map(str::to_string)
}

fn minecraft_profile_from_account(account: &serde_json::Value) -> Option<LocalMinecraftProfile> {
    let minecraft_profile = account.get("minecraftProfile");
    let name = minecraft_profile
        .and_then(|profile| json_string(profile, "name"))
        .or_else(|| json_string(account, "displayName"))
        .or_else(|| json_string(account, "username"))?;

    let uuid = minecraft_profile
        .and_then(|profile| json_string(profile, "id"))
        .or_else(|| json_string(account, "uuid"));

    Some(LocalMinecraftProfile {
        name,
        uuid,
        source: "Minecraft Launcher".to_string(),
    })
}

fn detect_from_launcher_accounts(path: &Path) -> Option<LocalMinecraftProfile> {
    let text = fs::read_to_string(path).ok()?;
    let json = serde_json::from_str::<serde_json::Value>(&text).ok()?;
    let accounts = json.get("accounts")?.as_object()?;

    if let Some(active_id) = json_string(&json, "activeAccountLocalId") {
        if let Some(profile) = accounts
            .get(&active_id)
            .and_then(minecraft_profile_from_account)
        {
            return Some(profile);
        }
    }

    accounts.values().find_map(minecraft_profile_from_account)
}

fn detect_from_launcher_profiles(path: &Path) -> Option<LocalMinecraftProfile> {
    let text = fs::read_to_string(path).ok()?;
    let json = serde_json::from_str::<serde_json::Value>(&text).ok()?;
    let auth_db = json.get("authenticationDatabase")?.as_object()?;

    auth_db.values().find_map(|account| {
        if let Some(name) = json_string(account, "displayName") {
            return Some(LocalMinecraftProfile {
                name,
                uuid: json_string(account, "uuid"),
                source: "Minecraft Launcher".to_string(),
            });
        }

        account
            .get("profiles")
            .and_then(|profiles| profiles.as_object())
            .and_then(|profiles| {
                profiles.values().find_map(|profile| {
                    json_string(profile, "displayName")
                        .or_else(|| json_string(profile, "name"))
                        .map(|name| LocalMinecraftProfile {
                            name,
                            uuid: json_string(profile, "id"),
                            source: "Minecraft Launcher".to_string(),
                        })
                })
            })
    })
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("Unable to open file: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|e| format!("Unable to read file: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn load_bundled_shadows_manifest() -> Result<ShadowsManifest, String> {
    serde_json::from_str::<ShadowsManifest>(include_str!("../../manifests/shadows-stable.json"))
        .map_err(|e| format!("Unable to parse bundled Shadows manifest: {e}"))
}

async fn load_shadows_manifest() -> Result<ShadowsManifest, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECONDS))
        .build()
        .map_err(|e| format!("Unable to create Shadows manifest client: {e}"))?;
    let cache_bust = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let manifest_url = format!("{SHADOWS_MANIFEST_URL}?t={cache_bust}");

    match client.get(&manifest_url).send().await {
        Ok(response) if response.status().is_success() => {
            let text = response
                .text()
                .await
                .map_err(|e| format!("Unable to read remote Shadows manifest: {e}"))?;
            serde_json::from_str::<ShadowsManifest>(&text)
                .map_err(|e| format!("Unable to parse remote Shadows manifest: {e}"))
        }
        Ok(response) => {
            eprintln!(
                "Remote Shadows manifest returned HTTP {}; using bundled fallback.",
                response.status()
            );
            load_bundled_shadows_manifest()
        }
        Err(err) => {
            eprintln!("Remote Shadows manifest unavailable: {err}; using bundled fallback.");
            load_bundled_shadows_manifest()
        }
    }
}

fn shadows_install_dir(
    app_handle: &tauri::AppHandle,
    manifest: &ShadowsManifest,
) -> Result<PathBuf, String> {
    Ok(app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Unable to locate launcher data folder: {e}"))?
        .join("instances")
        .join(&manifest.game_id)
        .join(&manifest.channel))
}

fn check_shadows_manifest_files(
    manifest: &ShadowsManifest,
    install_dir: &Path,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<ModpackCheckResult, String> {
    let mut files = Vec::with_capacity(manifest.files.len());
    let total_bytes = manifest
        .files
        .iter()
        .filter_map(|file| file.size_bytes)
        .sum::<u64>();
    let mut checked_bytes = 0_u64;

    for (index, manifest_file) in manifest.files.iter().enumerate() {
        if !is_real_sha256(&manifest_file.sha256) {
            files.push(ModpackFileStatus {
                path: manifest_file.path.clone(),
                status: "invalidManifest".to_string(),
                expected_sha256: Some(manifest_file.sha256.clone()),
                actual_sha256: None,
                size_bytes: manifest_file.size_bytes,
            });
            checked_bytes += manifest_file.size_bytes.unwrap_or(0);
            if let Some(app_handle) = app_handle {
                emit_shadows_progress(
                    app_handle,
                    "checking",
                    format!("Checking {}", manifest_file.path),
                    Some(manifest_file.path.clone()),
                    index + 1,
                    manifest.files.len(),
                    checked_bytes,
                    total_bytes,
                );
            }
            continue;
        }

        let file_path = safe_join(install_dir, &manifest_file.path)?;
        if !file_path.exists() {
            files.push(ModpackFileStatus {
                path: manifest_file.path.clone(),
                status: "missing".to_string(),
                expected_sha256: Some(manifest_file.sha256.clone()),
                actual_sha256: None,
                size_bytes: manifest_file.size_bytes,
            });
            checked_bytes += manifest_file.size_bytes.unwrap_or(0);
            if let Some(app_handle) = app_handle {
                emit_shadows_progress(
                    app_handle,
                    "checking",
                    format!("Checking {}", manifest_file.path),
                    Some(manifest_file.path.clone()),
                    index + 1,
                    manifest.files.len(),
                    checked_bytes,
                    total_bytes,
                );
            }
            continue;
        }

        let actual_sha256 = sha256_file(&file_path)?;
        let status = if actual_sha256.eq_ignore_ascii_case(&manifest_file.sha256) {
            "ok"
        } else {
            "changed"
        };

        files.push(ModpackFileStatus {
            path: manifest_file.path.clone(),
            status: status.to_string(),
            expected_sha256: Some(manifest_file.sha256.clone()),
            actual_sha256: Some(actual_sha256),
            size_bytes: manifest_file.size_bytes,
        });
        checked_bytes += manifest_file.size_bytes.unwrap_or(0);
        if let Some(app_handle) = app_handle {
            emit_shadows_progress(
                app_handle,
                "checking",
                format!("Checking {}", manifest_file.path),
                Some(manifest_file.path.clone()),
                index + 1,
                manifest.files.len(),
                checked_bytes,
                total_bytes,
            );
        }
    }

    let ok_files = files.iter().filter(|file| file.status == "ok").count();
    let missing_files = files.iter().filter(|file| file.status == "missing").count();
    let changed_files = files.iter().filter(|file| file.status == "changed").count();
    let invalid_manifest_files = files
        .iter()
        .filter(|file| file.status == "invalidManifest")
        .count();

    Ok(ModpackCheckResult {
        game_id: manifest.game_id.clone(),
        display_name: manifest.display_name.clone(),
        channel: manifest.channel.clone(),
        install_dir: install_dir.to_string_lossy().to_string(),
        total_files: files.len(),
        ok_files,
        missing_files,
        changed_files,
        invalid_manifest_files,
        ready: missing_files == 0 && changed_files == 0 && invalid_manifest_files == 0,
        files,
    })
}

fn collect_regular_files(root: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }

    for entry in
        fs::read_dir(root).map_err(|e| format!("Unable to read folder {}: {e}", root.display()))?
    {
        let entry = entry.map_err(|e| format!("Unable to read folder entry: {e}"))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Unable to inspect {}: {e}", entry.path().display()))?;

        if file_type.is_dir() {
            collect_regular_files(&entry.path(), files)?;
        } else if file_type.is_file() {
            files.push(entry.path());
        }
    }

    Ok(())
}

fn remove_empty_child_dirs(root: &Path) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }

    for entry in
        fs::read_dir(root).map_err(|e| format!("Unable to read folder {}: {e}", root.display()))?
    {
        let entry = entry.map_err(|e| format!("Unable to read folder entry: {e}"))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Unable to inspect {}: {e}", entry.path().display()))?;

        if file_type.is_dir() {
            remove_empty_child_dirs(&entry.path())?;
            if fs::read_dir(entry.path())
                .map_err(|e| format!("Unable to read folder {}: {e}", entry.path().display()))?
                .next()
                .is_none()
            {
                fs::remove_dir(entry.path())
                    .map_err(|e| format!("Unable to remove empty folder: {e}"))?;
            }
        }
    }

    Ok(())
}

fn manifest_path_from_file(install_dir: &Path, file_path: &Path) -> Result<String, String> {
    let relative = file_path
        .strip_prefix(install_dir)
        .map_err(|e| format!("Unable to resolve installed file path: {e}"))?;
    let mut parts = Vec::new();

    for component in relative.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            Component::CurDir => {}
            _ => {
                return Err(format!(
                    "Installed file path is not allowed: {}",
                    file_path.display()
                ))
            }
        }
    }

    Ok(parts.join("/"))
}

fn cleanup_extra_manifest_files(
    manifest: &ShadowsManifest,
    install_dir: &Path,
) -> Result<usize, String> {
    let cleanup_roots = match manifest.remove_extra_files_under.as_deref() {
        Some(roots) if !roots.is_empty() => roots,
        _ => return Ok(0),
    };
    let manifest_paths = manifest
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect::<HashSet<_>>();
    let mut removed = 0;

    for cleanup_root in cleanup_roots {
        let root_dir = safe_join(install_dir, cleanup_root)?;
        let mut installed_files = Vec::new();
        collect_regular_files(&root_dir, &mut installed_files)?;

        for installed_file in installed_files {
            let manifest_path = manifest_path_from_file(install_dir, &installed_file)?;
            if manifest_paths.contains(manifest_path.as_str()) {
                continue;
            }

            fs::remove_file(&installed_file).map_err(|e| {
                format!(
                    "Unable to remove old Shadows file {}: {e}",
                    installed_file.display()
                )
            })?;
            removed += 1;
        }

        remove_empty_child_dirs(&root_dir)?;
    }

    Ok(removed)
}

fn validate_shadows_download_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("Invalid Shadows file URL: {e}"))?;
    let host = parsed.host_str().unwrap_or_default();

    if parsed.scheme() != "https" || host != "aethro.net" {
        return Err(format!("Shadows file URL is not allowed: {url}"));
    }

    if !parsed.path().starts_with("/launcher/shadows/stable/files/") {
        return Err(format!(
            "Shadows file URL is outside the pack folder: {url}"
        ));
    }

    Ok(parsed)
}

fn emit_shadows_progress(
    app_handle: &tauri::AppHandle,
    phase: &str,
    message: impl Into<String>,
    current_file: Option<String>,
    current_index: usize,
    total_files: usize,
    downloaded_bytes: u64,
    total_bytes: u64,
) {
    let _ = app_handle.emit(
        "shadows-repair-progress",
        ShadowsRepairProgress {
            phase: phase.to_string(),
            message: message.into(),
            current_file,
            current_index,
            total_files,
            downloaded_bytes,
            total_bytes,
        },
    );
}

async fn download_manifest_file(
    client: &reqwest::Client,
    install_dir: &Path,
    manifest_file: &ShadowsManifestFile,
) -> Result<u64, String> {
    if !is_real_sha256(&manifest_file.sha256) {
        return Err(format!(
            "Cannot download {} because its manifest hash is invalid.",
            manifest_file.path
        ));
    }

    let url = manifest_file.url.as_deref().ok_or_else(|| {
        format!(
            "Manifest file is missing a download URL: {}",
            manifest_file.path
        )
    })?;
    let parsed_url = validate_shadows_download_url(url)?;
    let file_path = safe_join(install_dir, &manifest_file.path)?;

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Unable to create folder for {}: {e}", manifest_file.path))?;
    }

    let response = client
        .get(parsed_url)
        .send()
        .await
        .map_err(|e| format!("Unable to download {}: {e}", manifest_file.path))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed for {} with HTTP {}",
            manifest_file.path,
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Unable to read download for {}: {e}", manifest_file.path))?;

    if let Some(expected_size) = manifest_file.size_bytes {
        if bytes.len() as u64 != expected_size {
            return Err(format!(
                "Downloaded size mismatch for {}. Expected {} bytes, received {} bytes.",
                manifest_file.path,
                expected_size,
                bytes.len()
            ));
        }
    }

    let actual_sha256 = sha256_bytes(&bytes);
    if !actual_sha256.eq_ignore_ascii_case(&manifest_file.sha256) {
        return Err(format!(
            "Downloaded hash mismatch for {}. Expected {}, received {}.",
            manifest_file.path, manifest_file.sha256, actual_sha256
        ));
    }

    let file_name = file_path
        .file_name()
        .ok_or_else(|| format!("Manifest path has no file name: {}", manifest_file.path))?
        .to_string_lossy();
    let temp_path = file_path.with_file_name(format!("{file_name}.download"));

    fs::write(&temp_path, &bytes)
        .map_err(|e| format!("Unable to write download for {}: {e}", manifest_file.path))?;

    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| {
            format!(
                "Unable to replace existing file {}: {e}",
                manifest_file.path
            )
        })?;
    }

    fs::rename(&temp_path, &file_path)
        .map_err(|e| format!("Unable to finish download for {}: {e}", manifest_file.path))?;

    Ok(bytes.len() as u64)
}

async fn resolve_fabric_loader_version(
    client: &reqwest::Client,
    minecraft_version: &str,
    configured_loader_version: Option<&str>,
) -> Result<String, String> {
    if let Some(loader_version) = configured_loader_version {
        if !loader_version.trim().is_empty() {
            return Ok(loader_version.trim().to_string());
        }
    }

    let url = format!("https://meta.fabricmc.net/v2/versions/loader/{minecraft_version}");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Unable to load Fabric versions: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Fabric versions endpoint returned HTTP {}",
            response.status()
        ));
    }

    let versions = response
        .json::<Vec<FabricLoaderEntry>>()
        .await
        .map_err(|e| format!("Unable to parse Fabric versions: {e}"))?;

    versions
        .iter()
        .find(|entry| entry.loader.stable.unwrap_or(false))
        .or_else(|| versions.first())
        .map(|entry| entry.loader.version.clone())
        .ok_or_else(|| format!("Fabric did not return a loader for Minecraft {minecraft_version}."))
}

async fn install_fabric_launcher_profile(
    client: &reqwest::Client,
    manifest: &ShadowsManifest,
    install_dir: &Path,
) -> Result<(), String> {
    let minecraft = manifest
        .minecraft
        .as_ref()
        .ok_or_else(|| "Shadows manifest is missing Minecraft loader settings.".to_string())?;

    if minecraft.loader != "fabric" {
        return Err(format!(
            "Unsupported Shadows loader: {}. Expected fabric.",
            minecraft.loader
        ));
    }

    let loader_version = resolve_fabric_loader_version(
        client,
        &minecraft.version,
        minecraft.loader_version.as_deref(),
    )
    .await?;
    let fabric_profile_url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
        minecraft.version, loader_version
    );
    let response = client
        .get(&fabric_profile_url)
        .send()
        .await
        .map_err(|e| format!("Unable to download Fabric profile: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Fabric profile endpoint returned HTTP {}",
            response.status()
        ));
    }

    let profile_text = response
        .text()
        .await
        .map_err(|e| format!("Unable to read Fabric profile: {e}"))?;
    let profile_json = serde_json::from_str::<serde_json::Value>(&profile_text)
        .map_err(|e| format!("Unable to parse Fabric profile JSON: {e}"))?;
    let version_id = profile_json
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Fabric profile JSON did not include a version id.".to_string())?;

    let minecraft_dir = primary_minecraft_launcher_dir()?;
    let version_dir = minecraft_dir.join("versions").join(version_id);
    fs::create_dir_all(&version_dir)
        .map_err(|e| format!("Unable to create Fabric version folder: {e}"))?;
    fs::write(version_dir.join(format!("{version_id}.json")), profile_text)
        .map_err(|e| format!("Unable to write Fabric version profile: {e}"))?;

    let profiles_path = minecraft_dir.join("launcher_profiles.json");
    let mut launcher_profiles = if profiles_path.exists() {
        let text = fs::read_to_string(&profiles_path)
            .map_err(|e| format!("Unable to read Minecraft launcher profiles: {e}"))?;
        serde_json::from_str::<serde_json::Value>(&text)
            .map_err(|e| format!("Unable to parse Minecraft launcher profiles: {e}"))?
    } else {
        serde_json::json!({
            "profiles": {},
            "settings": {},
            "version": 3
        })
    };

    if !launcher_profiles.is_object() {
        launcher_profiles = serde_json::json!({
            "profiles": {},
            "settings": {},
            "version": 3
        });
    }

    if !launcher_profiles
        .get("profiles")
        .map(|profiles| profiles.is_object())
        .unwrap_or(false)
    {
        launcher_profiles["profiles"] = serde_json::json!({});
    }

    let jvm_args = manifest
        .launch
        .as_ref()
        .and_then(|launch| launch.jvm_args.as_ref())
        .map(|args| args.join(" "))
        .unwrap_or_else(|| "-Xmx6G -Xms2G".to_string());
    let game_args = manifest
        .launch
        .as_ref()
        .and_then(|launch| launch.game_args.as_ref())
        .cloned()
        .unwrap_or_default();

    launcher_profiles["profiles"]["play-aethro-shadows"] = serde_json::json!({
        "name": manifest.display_name.clone(),
        "type": "custom",
        "lastVersionId": version_id,
        "gameDir": install_dir.to_string_lossy().to_string(),
        "javaArgs": jvm_args,
        "playAethroJavaMajor": minecraft.java_major,
        "playAethroGameArgs": game_args
    });
    launcher_profiles["selectedProfile"] =
        serde_json::Value::String("play-aethro-shadows".to_string());

    fs::write(
        &profiles_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&launcher_profiles)
                .map_err(|e| format!("Unable to serialize Minecraft launcher profiles: {e}"))?
        ),
    )
    .map_err(|e| format!("Unable to write Minecraft launcher profile: {e}"))
}

#[tauri::command]
fn hash_file(path: String) -> Result<HashResult, String> {
    let path_buf = PathBuf::from(&path);

    Ok(HashResult {
        path,
        sha256: sha256_file(&path_buf)?,
    })
}

#[tauri::command]
async fn check_shadows_install(app_handle: tauri::AppHandle) -> Result<ModpackCheckResult, String> {
    let manifest = load_shadows_manifest().await?;
    let install_dir = shadows_install_dir(&app_handle, &manifest)?;
    emit_shadows_progress(
        &app_handle,
        "checking",
        "Checking Shadows files",
        None,
        0,
        manifest.files.len(),
        0,
        manifest
            .files
            .iter()
            .filter_map(|file| file.size_bytes)
            .sum(),
    );
    let result = check_shadows_manifest_files(&manifest, &install_dir, Some(&app_handle))?;
    emit_shadows_progress(
        &app_handle,
        if result.ready { "ready" } else { "needsUpdate" },
        if result.ready {
            "Shadows is ready"
        } else {
            "Shadows needs files"
        },
        None,
        result.ok_files,
        result.total_files,
        result.files.iter().filter_map(|file| file.size_bytes).sum(),
        result.files.iter().filter_map(|file| file.size_bytes).sum(),
    );
    Ok(result)
}

#[tauri::command]
async fn repair_shadows_install(
    app_handle: tauri::AppHandle,
) -> Result<ModpackCheckResult, String> {
    let manifest = load_shadows_manifest().await?;
    let install_dir = shadows_install_dir(&app_handle, &manifest)?;

    emit_shadows_progress(
        &app_handle,
        "checking",
        "Checking Shadows files",
        None,
        0,
        manifest.files.len(),
        0,
        manifest
            .files
            .iter()
            .filter_map(|file| file.size_bytes)
            .sum(),
    );

    let current = check_shadows_manifest_files(&manifest, &install_dir, Some(&app_handle))?;

    if current.invalid_manifest_files > 0 {
        emit_shadows_progress(
            &app_handle,
            "failed",
            "Manifest has invalid hashes",
            None,
            0,
            current.total_files,
            0,
            0,
        );
        return Err("Shadows manifest has invalid file hashes and cannot be repaired.".to_string());
    }

    let repair_files = current
        .files
        .iter()
        .filter(|file| file.status == "missing" || file.status == "changed")
        .filter_map(|file_status| {
            manifest
                .files
                .iter()
                .find(|manifest_file| manifest_file.path == file_status.path)
        })
        .collect::<Vec<_>>();
    let total_download_bytes = repair_files
        .iter()
        .filter_map(|file| file.size_bytes)
        .sum::<u64>();
    let total_manifest_bytes = manifest
        .files
        .iter()
        .filter_map(|file| file.size_bytes)
        .sum::<u64>();

    if repair_files.is_empty() {
        emit_shadows_progress(
            &app_handle,
            "setup",
            "Removing old Shadows files",
            None,
            current.ok_files,
            current.total_files,
            total_manifest_bytes,
            total_manifest_bytes,
        );
        let removed_files = cleanup_extra_manifest_files(&manifest, &install_dir)?;
        if removed_files > 0 {
            eprintln!("Removed {removed_files} old Shadows files.");
        }

        emit_shadows_progress(
            &app_handle,
            "setup",
            "Setting up Minecraft Launcher profile",
            None,
            current.ok_files,
            current.total_files,
            total_manifest_bytes,
            total_manifest_bytes,
        );

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECONDS))
            .build()
            .map_err(|e| format!("Unable to create Shadows download client: {e}"))?;

        install_fabric_launcher_profile(&client, &manifest, &install_dir).await?;
        let final_check = check_shadows_manifest_files(&manifest, &install_dir, Some(&app_handle))?;
        emit_shadows_progress(
            &app_handle,
            if final_check.ready {
                "ready"
            } else {
                "needsUpdate"
            },
            if final_check.ready {
                "Shadows is ready"
            } else {
                "Shadows still needs files"
            },
            None,
            final_check.ok_files,
            final_check.total_files,
            total_manifest_bytes,
            total_manifest_bytes,
        );
        return Ok(final_check);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECONDS))
        .build()
        .map_err(|e| format!("Unable to create Shadows download client: {e}"))?;

    let mut downloaded_bytes = 0_u64;
    for (index, manifest_file) in repair_files.iter().enumerate() {
        emit_shadows_progress(
            &app_handle,
            "installing",
            format!("Installing {}", manifest_file.path),
            Some(manifest_file.path.clone()),
            index + 1,
            repair_files.len(),
            downloaded_bytes,
            total_download_bytes,
        );

        downloaded_bytes += download_manifest_file(&client, &install_dir, manifest_file).await?;

        emit_shadows_progress(
            &app_handle,
            "installing",
            format!("Installed {}", manifest_file.path),
            Some(manifest_file.path.clone()),
            index + 1,
            repair_files.len(),
            downloaded_bytes,
            total_download_bytes,
        );
    }

    emit_shadows_progress(
        &app_handle,
        "setup",
        "Removing old Shadows files",
        None,
        repair_files.len(),
        repair_files.len(),
        downloaded_bytes,
        total_download_bytes,
    );
    let removed_files = cleanup_extra_manifest_files(&manifest, &install_dir)?;
    if removed_files > 0 {
        eprintln!("Removed {removed_files} old Shadows files.");
    }

    emit_shadows_progress(
        &app_handle,
        "setup",
        "Setting up Minecraft Launcher profile",
        None,
        repair_files.len(),
        repair_files.len(),
        downloaded_bytes,
        total_download_bytes,
    );

    install_fabric_launcher_profile(&client, &manifest, &install_dir).await?;

    emit_shadows_progress(
        &app_handle,
        "verifying",
        "Verifying Shadows files",
        None,
        repair_files.len(),
        repair_files.len(),
        downloaded_bytes,
        total_download_bytes,
    );

    let final_check = check_shadows_manifest_files(&manifest, &install_dir, Some(&app_handle))?;
    emit_shadows_progress(
        &app_handle,
        if final_check.ready {
            "ready"
        } else {
            "needsUpdate"
        },
        if final_check.ready {
            "Shadows is ready"
        } else {
            "Shadows still needs files"
        },
        None,
        final_check.ok_files,
        final_check.total_files,
        downloaded_bytes,
        total_download_bytes,
    );

    Ok(final_check)
}

#[tauri::command]
fn detect_local_minecraft_profile() -> Result<Option<LocalMinecraftProfile>, String> {
    for dir in minecraft_launcher_dirs() {
        if let Some(profile) = detect_from_launcher_accounts(&dir.join("launcher_accounts.json")) {
            return Ok(Some(profile));
        }

        if let Some(profile) = detect_from_launcher_profiles(&dir.join("launcher_profiles.json")) {
            return Ok(Some(profile));
        }
    }

    Ok(None)
}

#[tauri::command]
async fn open_minecraft_launcher(app_handle: tauri::AppHandle) -> Result<String, String> {
    let manifest = load_shadows_manifest().await?;
    let install_dir = shadows_install_dir(&app_handle, &manifest)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECONDS))
        .build()
        .map_err(|e| format!("Unable to create Minecraft profile setup client: {e}"))?;
    install_fabric_launcher_profile(&client, &manifest, &install_dir).await?;

    #[cfg(target_os = "windows")]
    {
        let mut launcher_paths = Vec::new();

        if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
            launcher_paths.push(
                PathBuf::from(program_files_x86)
                    .join("Minecraft Launcher")
                    .join("MinecraftLauncher.exe"),
            );
        }

        if let Ok(program_files) = env::var("ProgramFiles") {
            launcher_paths.push(
                PathBuf::from(&program_files)
                    .join("Minecraft Launcher")
                    .join("MinecraftLauncher.exe"),
            );
            launcher_paths.push(
                PathBuf::from(&program_files)
                    .join("WindowsApps")
                    .join("Microsoft.4297127D64EC6_8wekyb3d8bbwe")
                    .join("Minecraft.exe"),
            );
        }

        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            launcher_paths.push(
                PathBuf::from(local_app_data)
                    .join("Programs")
                    .join("Minecraft Launcher")
                    .join("MinecraftLauncher.exe"),
            );
        }

        for launcher_path in launcher_paths {
            if launcher_path.exists() {
                Command::new(&launcher_path)
                    .spawn()
                    .map_err(|e| format!("Unable to open {}: {e}", launcher_path.display()))?;

                return Ok("Minecraft Launcher opened.".to_string());
            }
        }

        Command::new("explorer.exe")
            .arg("shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft")
            .spawn()
            .map_err(|e| format!("Unable to open Minecraft Launcher from the Start menu: {e}"))?;

        return Ok("Minecraft Launcher opened.".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        if open::that("minecraft://").is_ok() {
            return Ok("Minecraft Launcher opened.".to_string());
        }

        #[cfg(target_os = "macos")]
        {
            let app_paths = [
                "/Applications/Minecraft.app",
                "/Applications/Minecraft Launcher.app",
            ];

            for app_path in app_paths {
                if Path::new(app_path).exists() {
                    let status = Command::new("/usr/bin/open")
                        .arg(app_path)
                        .status()
                        .map_err(|e| format!("Unable to open {app_path}: {e}"))?;

                    if status.success() {
                        return Ok("Minecraft Launcher opened.".to_string());
                    }
                }
            }

            let status = Command::new("/usr/bin/open")
                .args(["-a", "Minecraft"])
                .status()
                .map_err(|e| format!("Unable to open Minecraft by app name: {e}"))?;

            if status.success() {
                return Ok("Minecraft Launcher opened.".to_string());
            }
        }

        Err("Unable to open Minecraft Launcher. Install it, then open Minecraft Launcher once so your system registers it.".to_string())
    }
}

#[tauri::command]
async fn fetch_text(url: String) -> Result<String, String> {
    let allowed = [
        "https://aethro.net/rss.php?division=play-aethro",
        "https://aethro.net/rss.php?division=aethro-online",
        "https://aethro.net/rss.php?division=minecraft-survival",
    ];

    if !allowed.contains(&url.as_str()) {
        return Err("URL is not allowed by the launcher.".to_string());
    }

    let mut request_url =
        reqwest::Url::parse(&url).map_err(|e| format!("Invalid RSS feed URL: {e}"))?;
    let cache_bust = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string();
    request_url
        .query_pairs_mut()
        .append_pair("launcher_t", &cache_bust);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECONDS))
        .build()
        .map_err(|e| format!("Unable to create RSS HTTP client: {e}"))?;

    let response = client
        .get(request_url)
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .header(reqwest::header::PRAGMA, "no-cache")
        .send()
        .await
        .map_err(|e| format!("Unable to fetch RSS feed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("RSS feed returned HTTP {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Unable to read RSS response: {e}"))
}

#[tauri::command]
async fn api_request_json(
    url: String,
    method: String,
    headers: std::collections::HashMap<String, String>,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("Invalid API URL: {e}"))?;
    let host = parsed.host_str().unwrap_or_default();

    let allowed_hosts = [
        "aethro.net",
        "api.aethro.net",
        "playaethro.online",
        "www.playaethro.online",
        "localhost",
        "127.0.0.1",
    ];
    if !allowed_hosts.contains(&host) {
        return Err(format!("API host is not allowed by the launcher: {host}"));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECONDS))
        .build()
        .map_err(|e| format!("Unable to create API HTTP client: {e}"))?;
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("Invalid API method: {e}"))?;

    let mut request = client.request(method, parsed);

    for (name, value) in headers {
        request = request.header(name, value);
    }

    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Unable to send API request: {e}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Unable to read API response: {e}"))?;

    if !status.is_success() {
        let message = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|value| {
                value
                    .get("message")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| text.chars().take(300).collect());
        return Err(format!("API returned HTTP {status}: {message}"));
    }

    if text.trim().is_empty() {
        return Ok(serde_json::Value::Null);
    }

    serde_json::from_str(&text).map_err(|e| format!("Unable to parse API JSON: {e}"))
}

async fn exchange_authorization_code(
    client: &reqwest::Client,
    config: &OAuthLoginRequest,
    form: &HashMap<String, String>,
) -> Result<(reqwest::StatusCode, String, &'static str), String> {
    let mut token_form = form.clone();
    let mut request = client
        .post(&config.token_url)
        .header(reqwest::header::ACCEPT, "application/json");

    let auth_method = match &config.token_auth_method {
        TokenAuthMethod::ClientSecretBasic => {
            if config.client_secret.is_empty() {
                return Err("OAuth client secret is empty for client_secret_basic.".to_string());
            }
            request = request.basic_auth(&config.client_id, Some(&config.client_secret));
            "client_secret_basic"
        }
        TokenAuthMethod::ClientSecretPost => {
            if config.client_secret.is_empty() {
                return Err("OAuth client secret is empty for client_secret_post.".to_string());
            }
            token_form.insert("client_id".to_string(), config.client_id.clone());
            token_form.insert("client_secret".to_string(), config.client_secret.clone());
            "client_secret_post"
        }
        TokenAuthMethod::None => {
            token_form.insert("client_id".to_string(), config.client_id.clone());
            "none"
        }
    };

    let response =
        request.form(&token_form).send().await.map_err(|e| {
            format!("Unable to exchange Aethro login code using {auth_method}: {e}")
        })?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Unable to read Aethro token response using {auth_method}: {e}"))?;

    Ok((status, text, auth_method))
}

#[tauri::command]
async fn oauth_login(config: OAuthLoginRequest) -> Result<AuthSession, String> {
    let (callback_bind_addr, callback_path) =
        callback_listener_from_redirect_uri(&config.redirect_uri)?;
    let listener = TcpListener::bind(&callback_bind_addr).map_err(|e| {
        format!("Unable to start local OAuth callback listener on {callback_bind_addr}: {e}")
    })?;

    let state = random_string(48);
    let verifier = random_string(96);

    let mut authorize_params = vec![
        ("response_type", "code".to_string()),
        ("client_id", config.client_id.clone()),
        ("redirect_uri", config.redirect_uri.clone()),
        ("scope", config.scope.clone()),
        ("state", state.clone()),
    ];

    if config.use_pkce {
        authorize_params.push(("code_challenge", pkce_challenge(&verifier)));
        authorize_params.push(("code_challenge_method", "S256".to_string()));
    }

    let authorize_url = add_query(&config.authorize_url, &authorize_params)?;

    open::that(&authorize_url)
        .map_err(|e| format!("Unable to open Aethro login in browser: {e}"))?;

    let (mut stream, _) = listener
        .accept()
        .map_err(|e| format!("Unable to receive OAuth callback: {e}"))?;

    let request = read_http_request(&mut stream)?;
    let code_result = parse_callback(&request, &state, &callback_path);
    let _ = write_callback_response(&mut stream, code_result.is_ok());
    let code = code_result?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECONDS))
        .build()
        .map_err(|e| format!("Unable to create OAuth HTTP client: {e}"))?;
    let mut form = HashMap::<String, String>::new();
    form.insert("grant_type".to_string(), "authorization_code".to_string());
    form.insert("code".to_string(), code);
    form.insert("redirect_uri".to_string(), config.redirect_uri.clone());
    if config.use_pkce {
        form.insert("code_verifier".to_string(), verifier);
    }

    let (token_status, token_text, auth_method) =
        exchange_authorization_code(&client, &config, &form).await?;

    if !token_status.is_success() {
        return Err(format!(
            "Aethro token endpoint returned HTTP {token_status} using {auth_method}: {}",
            token_text.chars().take(500).collect::<String>()
        ));
    }

    let token_json: serde_json::Value = serde_json::from_str(&token_text)
        .map_err(|e| format!("Unable to parse Aethro token JSON: {e}. Body: {token_text}"))?;
    let token = extract_token_response(token_json)?;

    let user_response = client
        .get(&config.userinfo_url)
        .header(reqwest::header::ACCEPT, "application/json")
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|e| format!("Unable to load Aethro user info: {e}"))?;

    let user_status = user_response.status();
    let user_text = user_response
        .text()
        .await
        .map_err(|e| format!("Unable to read Aethro user info response: {e}"))?;

    if !user_status.is_success() {
        return Err(format!(
            "Aethro user info endpoint returned HTTP {user_status}: {}",
            user_text.chars().take(300).collect::<String>()
        ));
    }

    let user_json: serde_json::Value = serde_json::from_str(&user_text)
        .map_err(|e| format!("Unable to parse Aethro user info JSON: {e}. Body: {user_text}"))?;
    let info = extract_user_info(user_json)?;

    let expires_at = token.expires_at.or_else(|| {
        token.expires_in.map(|seconds| {
            let unix = std::time::SystemTime::now()
                .checked_add(Duration::from_secs(seconds))
                .unwrap_or(std::time::SystemTime::now())
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            format!("unix:{unix}")
        })
    });

    Ok(AuthSession {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at,
        user: user_profile_from_info(info),
    })
}

#[tauri::command]
fn launch_placeholder(game_id: String) -> Result<String, String> {
    Ok(format!("Launch flow placeholder for {game_id}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            hash_file,
            check_shadows_install,
            repair_shadows_install,
            detect_local_minecraft_profile,
            fetch_text,
            api_request_json,
            oauth_login,
            open_minecraft_launcher,
            launch_placeholder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Play Aethro Launcher");
}
