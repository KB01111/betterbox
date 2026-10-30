#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appearance;
mod native;
mod notification_identity;
mod protocol;

use protocol::{
    new_verifier, recovery, redeem_status, safe_download, safe_external, session_cookie, trusted,
    valid_browser_url, valid_mode, SessionCookie, ORIGIN,
};
use reqwest::{header, Client};
use serde::Deserialize;
use std::time::Duration;
use tauri::{
    webview::{DownloadEvent, NewWindowResponse},
    Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tokio::{
    sync::Mutex,
    time::{sleep, timeout},
};

const INIT_SCRIPT: &str = r#"
if (window === window.top && window.location.origin === 'https://betterbox.kevinjbridgelal.workers.dev') {
  const bridge = Object.freeze({version:1,capabilities:Object.freeze(['auth','lifecycle','settings','updates','mail','appearance']),authenticate:(mode)=>window.__TAURI_INTERNALS__.invoke('desktop_auth',{mode}),request:(action,payload={})=>{if(action==='quit-response'&&payload.allow===true)document.documentElement.inert=true;return window.__TAURI_INTERNALS__.invoke('desktop_action',{action,payload});}});
  Object.defineProperty(window, '__KB_ONEMAIL_DESKTOP__', {value:bridge,writable:false,configurable:false});
  Object.defineProperty(window, '__BETTERBOX_DESKTOP__', {
    value: Object.freeze({ authenticate: bridge.authenticate }),
    writable: false,
    configurable: false
  });
  window.addEventListener('keydown',e=>{if(e.key==='F5'||((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='r')){e.preventDefault();e.stopImmediatePropagation();window.__TAURI_INTERNALS__.invoke('desktop_action',{action:'reload',payload:{}}).catch(()=>{});}},true);
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
    window
        .state::<native::NativeState>()
        .authenticating
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let result = timeout(Duration::from_secs(300), authenticate(&window, &mode))
        .await
        .map_err(|_| "Desktop sign-in timed out. Start again in KB OneMail.".to_string())
        .and_then(|result| result);
    let _ = window.set_title("KB OneMail");
    window
        .state::<native::NativeState>()
        .authenticating
        .store(false, std::sync::atomic::Ordering::SeqCst);
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
        .map_err(|_| "Could not reach KB OneMail. Check your internet connection.")?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            "Sign in to KB OneMail before linking another account."
        } else {
            "KB OneMail could not start desktop sign-in. Try again."
        }
        .into());
    }
    let ticket: StartResponse = response
        .json()
        .await
        .map_err(|_| "Invalid KB OneMail sign-in response.")?;
    if ticket.id.len() != 43
        || !ticket
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || !valid_browser_url(&ticket.browser_url, &ticket.id)
        || ticket.user_code != format!("{}-{}", &ticket.id[..4], &ticket.id[4..8]).to_uppercase()
    {
        return Err("KB OneMail returned an invalid sign-in request.".into());
    }
    window
        .set_title(&format!("KB OneMail — approval code {}", ticket.user_code))
        .map_err(|_| "Could not display the desktop approval code.")?;
    let approved = rfd::AsyncMessageDialog::new()
        .set_title("KB OneMail browser sign-in")
        .set_description(format!("Your approval code is {}.\n\nSelect OK to open your browser. Compare this code with the browser page before approving. Keep the KB OneMail title bar visible to compare it. The request expires in five minutes.", ticket.user_code))
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
            .map_err(|_| "Could not reach KB OneMail during sign-in. Try again.")?;
        if !redeem_status(response.status().as_u16())? {
            continue;
        }
        let redeemed: RedeemResponse = response
            .json()
            .await
            .map_err(|_| "Invalid desktop session response.")?;
        let cookie = session_cookie(&redeemed.cookie)?;
        if !window.url().is_ok_and(|url| trusted(&url)) {
            return Err("The KB OneMail window is no longer available.".into());
        }
        window
            .set_cookie(cookie)
            .map_err(|_| "Could not install the desktop session.")?;
        native::finish_authentication(window).await?;
        return Ok(());
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            native::arguments(app, args)
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("KB OneMail")
                .args(["--background"])
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AuthState::default())
        .manage(native::NativeState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_auth,
            native::desktop_action,
            native::desktop_connect
        ])
        .setup(|app| {
            let navigation_app = app.handle().clone();
            let new_window_app = app.handle().clone();
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("KB OneMail")
                    .transparent(true)
                    .inner_size(1280.0, 860.0)
                    .min_inner_size(800.0, 600.0)
                    .disable_drag_drop_handler()
                    .initialization_script(INIT_SCRIPT)
                    .on_page_load(|window, payload| {
                        if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                            window
                                .state::<native::NativeState>()
                                .authenticated
                                .store(false, std::sync::atomic::Ordering::SeqCst);
                            window
                                .state::<native::NativeState>()
                                .closing
                                .store(false, std::sync::atomic::Ordering::SeqCst);
                            *window
                                .state::<native::NativeState>()
                                .lifecycle
                                .lock()
                                .unwrap() = native_policy::Lifecycle::default();
                        }
                    })
                    .on_navigation(move |url| {
                        if let Some(action) = native_policy::activation(url.as_str()) {
                            native::queue(&navigation_app, action);
                            return false;
                        }
                        if trusted(url) {
                            return native::allow_navigation(&navigation_app, url);
                        }
                        if recovery(url) {
                            return true;
                        }
                        if safe_external(url) {
                            let _ = open::that(url.as_str());
                        }
                        false
                    })
                    .on_new_window(move |url, _| {
                        if let Some(action) = native_policy::activation(url.as_str()) {
                            native::queue(&new_window_app, action);
                            return NewWindowResponse::Deny;
                        }
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
                                .set_title("Save KB OneMail attachment")
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
            native::safe_bounds(&window);
            let close = window.clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Focused(true)) {
                    native::refresh_appearance(&close);
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if !close
                        .state::<native::NativeState>()
                        .exiting
                        .load(std::sync::atomic::Ordering::SeqCst)
                    {
                        api.prevent_close();
                        native::hide(&close);
                    }
                }
            });
            install_recovery(&window);
            native::setup(app.handle())?;
            if std::env::args().any(|arg| arg == "--background") {
                native::hide(&window);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("KB OneMail desktop could not start")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app
                    .state::<native::NativeState>()
                    .exiting
                    .load(std::sync::atomic::Ordering::SeqCst)
                {
                    api.prevent_exit();
                    native::request_quit(app);
                }
            }
        });
}

fn install_recovery(window: &WebviewWindow) {
    #[cfg(windows)]
    {
        let handle = window.clone();
        let _ = window.with_webview(move |webview| unsafe {
            if let Ok(core) = webview.controller().CoreWebView2() {
                let failed = handle.clone();
                let mut token = 0;
                let _ = core.add_ProcessFailed(
                    &webview2_com::ProcessFailedEventHandler::create(Box::new(move |_, _| {
                        *failed
                            .state::<native::NativeState>()
                            .lifecycle
                            .lock()
                            .unwrap() = native_policy::Lifecycle::default();
                        let _ = failed.navigate("http://tauri.localhost/index.html".parse().unwrap());
                        Ok(())
                    })),
                    &mut token,
                );
                let failed = handle.clone();
                let _ = core.add_NavigationCompleted(
                    &webview2_com::NavigationCompletedEventHandler::create(Box::new(
                        move |_, args| {
                            if let Some(args) = args {
                                let mut success = windows::core::BOOL(0);
                                let mut status=webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
                                let _=args.WebErrorStatus(&mut status);
                                if status==webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED{return Ok(())}
                                if args.IsSuccess(&mut success).is_ok() && !success.as_bool() {
                                    *failed
                                        .state::<native::NativeState>()
                                        .lifecycle
                                        .lock()
                                        .unwrap() = native_policy::Lifecycle::default();
                                    let _ = failed
                                        .navigate("http://tauri.localhost/index.html".parse().unwrap());
                                }
                            }
                            Ok(())
                        },
                    )),
                    &mut token,
                );
            }
        });
    }
}

mod native_policy;
