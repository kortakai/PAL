use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    time::Duration,
};

#[derive(Debug, Serialize, Deserialize)]
struct HashResult {
    path: String,
    sha256: String,
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
    authorize_url: String,
    token_url: String,
    userinfo_url: String,
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
    username: Option<String>,
    name: Option<String>,
    #[serde(alias = "displayName", alias = "display_name")]
    display_name: Option<String>,
    email: Option<String>,
    #[serde(alias = "avatarUrl", alias = "avatar_url")]
    avatar_url: Option<String>,
    avatar: Option<String>,
    picture: Option<String>,
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
    let id = value_to_string(info.id)
        .or_else(|| value_to_string(info.sub))
        .or_else(|| value_to_string(info.user_id))
        .unwrap_or_else(|| "aethro-user".to_string());

    let display_name = info
        .display_name
        .clone()
        .or(info.name.clone())
        .or(info.username.clone())
        .or(info.email.clone())
        .unwrap_or_else(|| "Aethro Hero".to_string());

    UserProfile {
        id,
        display_name,
        username: info.username,
        email: info.email,
        avatar_url: info.avatar_url.or(info.avatar).or(info.picture),
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
        "<html><body style=\"font-family:system-ui;background:#06131f;color:#e8f7ff;padding:40px\"><h1>Play Aethro login complete</h1><p>You can close this browser tab and return to the launcher.</p></body></html>"
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

fn parse_callback(request: &str, expected_state: &str) -> Result<String, String> {
    let first_line = request.lines().next().unwrap_or_default();
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();

    if method != "GET" || path.is_empty() {
        return Err("OAuth callback did not contain a GET request.".to_string());
    }

    let parsed = reqwest::Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|e| format!("Unable to parse OAuth callback URL: {e}"))?;

    let params: HashMap<String, String> = parsed.query_pairs().into_owned().collect();

    if let Some(error) = params.get("error") {
        return Err(format!("Aethro login returned an error: {error}"));
    }

    let state = params
        .get("state")
        .ok_or_else(|| "OAuth callback was missing state.".to_string())?;

    if state != expected_state {
        return Err("OAuth callback state did not match. Login was cancelled for safety.".to_string());
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

#[tauri::command]
fn hash_file(path: String) -> Result<HashResult, String> {
    let path_buf = PathBuf::from(&path);
    let mut file = File::open(&path_buf).map_err(|e| format!("Unable to open file: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let n = file.read(&mut buffer).map_err(|e| format!("Unable to read file: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    Ok(HashResult {
        path,
        sha256: format!("{:x}", hasher.finalize()),
    })
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

    let response = reqwest::get(&url)
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

    let allowed_hosts = ["aethro.net", "api.aethro.net", "localhost", "127.0.0.1"];
    if !allowed_hosts.contains(&host) {
        return Err(format!("API host is not allowed by the launcher: {host}"));
    }

    let client = reqwest::Client::new();
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
            .and_then(|value| value.get("message").and_then(|v| v.as_str()).map(str::to_owned))
            .unwrap_or_else(|| text.chars().take(300).collect());
        return Err(format!("API returned HTTP {status}: {message}"));
    }

    serde_json::from_str(&text).map_err(|e| format!("Unable to parse API JSON: {e}"))
}

#[tauri::command]
async fn oauth_login(config: OAuthLoginRequest) -> Result<AuthSession, String> {
    let listener = TcpListener::bind("127.0.0.1:38987")
        .map_err(|e| format!("Unable to start local OAuth callback listener on port 38987: {e}"))?;

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

    open::that(&authorize_url).map_err(|e| format!("Unable to open Aethro login in browser: {e}"))?;

    let (mut stream, _) = listener
        .accept()
        .map_err(|e| format!("Unable to receive OAuth callback: {e}"))?;

    let request = read_http_request(&mut stream)?;
    let code_result = parse_callback(&request, &state);
    let _ = write_callback_response(&mut stream, code_result.is_ok());
    let code = code_result?;

    let client = reqwest::Client::new();
    let mut form = HashMap::new();
    form.insert("grant_type", "authorization_code".to_string());
    form.insert("code", code);
    form.insert("redirect_uri", config.redirect_uri.clone());
    if config.use_pkce {
        form.insert("code_verifier", verifier);
    }

    // First try client_secret_post, which is what many custom OAuth providers expect.
    let mut post_form = form.clone();
    post_form.insert("client_id", config.client_id.clone());
    post_form.insert("client_secret", config.client_secret.clone());

    let first_response = client
        .post(&config.token_url)
        .form(&post_form)
        .send()
        .await
        .map_err(|e| format!("Unable to exchange Aethro login code using client_secret_post: {e}"))?;

    let first_status = first_response.status();
    let first_text = first_response
        .text()
        .await
        .map_err(|e| format!("Unable to read Aethro token response: {e}"))?;

    let (token_status, token_text, auth_method) = if first_status.is_success() {
        (first_status, first_text, "client_secret_post")
    } else if first_text.contains("invalid_client") {
        // If the server rejected body credentials, retry HTTP Basic auth. The auth-code
        // should not be consumed by an invalid_client response.
        let basic_response = client
            .post(&config.token_url)
            .basic_auth(&config.client_id, Some(&config.client_secret))
            .form(&form)
            .send()
            .await
            .map_err(|e| format!("Unable to exchange Aethro login code using client_secret_basic: {e}"))?;

        let basic_status = basic_response.status();
        let basic_text = basic_response
            .text()
            .await
            .map_err(|e| format!("Unable to read Aethro Basic-auth token response: {e}"))?;

        (basic_status, basic_text, "client_secret_basic")
    } else {
        (first_status, first_text, "client_secret_post")
    };

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            hash_file,
            fetch_text,
            api_request_json,
            oauth_login,
            launch_placeholder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Play Aethro Launcher");
}
