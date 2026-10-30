#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod protocol;

use protocol::{
    new_verifier, redeem_status, safe_download, safe_external, session_cookie, trusted,
    valid_browser_url, valid_mode, SessionCookie, ORIGIN,
};
use reqwest::{header, Client};
use serde::Deserialize;
use std::time::Duration;
use tauri::{
    webview::{DownloadEvent, NewWindowResponse},
    State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tokio::{
    sync::Mutex,
    time::{sleep, timeout},
};

const INIT_SCRIPT: &str = r#"
if (window === window.top && window.location.origin === 'https://betterbox.kevinjbridgelal.workers.dev') {
  Object.defineProperty(window, '__BETTERBOX_DESKTOP__', {
    value: Object.freeze({ authenticate: (mode) => window.__TAURI_INTERNALS__.invoke('desktop_auth', { mode }) }),
    writable: false,
    configurable: false
  });
}
"#;

#[derive(Default)]
struct AuthState(Mutex<()>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartResponse {
    id: String,
    user_code: String,
    browser_url: String,
}

#[derive(Deserialize)]
struct RedeemResponse {
    cookie: SessionCookie,
}

#[tauri::command]
async fn desktop_auth(
    window: WebviewWindow,
    state: State<'_, AuthState>,
    mode: String,
) -> Result<(), String> {
    if window.label() != "main"
        || !window.url().is_ok_and(|url| trusted(&url))
        || !valid_mode(&mode)
    {
        return Err("This desktop sign-in request is not allowed.".into());
    }
    let _guard = state
        .0
        .try_lock()
        .map_err(|_| "A desktop sign-in is already in progress.")?;
    let result = timeout(Duration::from_secs(300), authenticate(&window, &mode))
        .await
        .map_err(|_| "Desktop sign-in timed out. Start again in BetterBox.".to_string())
        .and_then(|result| result);
    let _ = window.set_title("BetterBox");
    result
}

async fn authenticate(window: &WebviewWindow, mode: &str) -> Result<(), String> {
    let origin = ORIGIN
        .parse::<url::Url>()
        .map_err(|_| "Invalid desktop configuration.")?;
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Could not initialize desktop sign-in.")?;
    let (verifier, challenge) = new_verifier();
    // This command is async: reading WebView2 cookies on the UI thread deadlocks.
    let cookies = window
        .cookies_for_url(origin.clone())
        .map_err(|_| "Could not read the desktop session.")?
        .into_iter()
        .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
        .collect::<Vec<_>>()
        .join("; ");
    let mut request = client
        .post(format!("{ORIGIN}/api/desktop/start"))
        .header(header::ORIGIN, ORIGIN)
        .json(&serde_json::json!({ "challenge": challenge, "mode": mode }));
    if !cookies.is_empty() {
        request = request.header(header::COOKIE, cookies);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Could not reach BetterBox. Check your internet connection.")?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            "Sign in to BetterBox before linking another account."
        } else {
            "BetterBox could not start desktop sign-in. Try again."
        }
        .into());
    }
    let ticket: StartResponse = response
        .json()
        .await
        .map_err(|_| "Invalid BetterBox sign-in response.")?;
    if ticket.id.len() != 43
        || !ticket
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || !valid_browser_url(&ticket.browser_url, &ticket.id)
        || ticket.user_code != format!("{}-{}", &ticket.id[..4], &ticket.id[4..8]).to_uppercase()
    {
        return Err("BetterBox returned an invalid sign-in request.".into());
    }
    window
        .set_title(&format!("BetterBox — approval code {}", ticket.user_code))
        .map_err(|_| "Could not display the desktop approval code.")?;
    let approved = rfd::AsyncMessageDialog::new()
        .set_title("BetterBox browser sign-in")
        .set_description(format!("Your approval code is {}.\n\nSelect OK to open your browser. Compare this code with the browser page before approving. Keep the BetterBox title bar visible to compare it. The request expires in five minutes.", ticket.user_code))
        .set_buttons(rfd::MessageButtons::OkCancel)
        .show().await;
    if approved != rfd::MessageDialogResult::Ok {
        return Err("Desktop sign-in was cancelled.".into());
    }
    open::that(&ticket.browser_url).map_err(|_| "Could not open your system browser.")?;
    loop {
        sleep(Duration::from_secs(2)).await;
        let response = client
            .post(format!("{ORIGIN}/api/desktop/redeem"))
            .header(header::ORIGIN, ORIGIN)
            .json(&serde_json::json!({ "id": ticket.id, "verifier": verifier }))
            .send()
            .await
            .map_err(|_| "Could not reach BetterBox during sign-in. Try again.")?;
        if !redeem_status(response.status().as_u16())? {
            continue;
        }
        let redeemed: RedeemResponse = response
            .json()
            .await
            .map_err(|_| "Invalid desktop session response.")?;
        let cookie = session_cookie(&redeemed.cookie)?;
        if !window.url().is_ok_and(|url| trusted(&url)) {
            return Err("The BetterBox window is no longer available.".into());
        }
        window
            .set_cookie(cookie)
            .map_err(|_| "Could not install the desktop session.")?;
        window
            .navigate(origin)
            .map_err(|_| "Could not reload BetterBox after sign-in.")?;
        return Ok(());
    }
}

fn main() {
    tauri::Builder::default()
        .manage(AuthState::default())
        .invoke_handler(tauri::generate_handler![desktop_auth])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(ORIGIN.parse()?))
                .title("BetterBox")
                .inner_size(1280.0, 860.0)
                .min_inner_size(800.0, 600.0)
                .disable_drag_drop_handler()
                .initialization_script(INIT_SCRIPT)
                .on_navigation(|url| {
                    if trusted(url) {
                        return true;
                    }
                    if safe_external(url) {
                        let _ = open::that(url.as_str());
                    }
                    false
                })
                .on_new_window(|url, _| {
                    if safe_external(&url) {
                        let _ = open::that(url.as_str());
                    }
                    NewWindowResponse::Deny
                })
                .on_download(|_, event| {
                    if let DownloadEvent::Requested { url, destination } = event {
                        if !safe_download(&url) {
                            return false;
                        }
                        let name = destination
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned();
                        if let Some(path) = rfd::FileDialog::new()
                            .set_title("Save BetterBox attachment")
                            .set_file_name(name)
                            .save_file()
                        {
                            *destination = path;
                            return true;
                        }
                        return false;
                    }
                    true
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("BetterBox desktop could not start");
}
