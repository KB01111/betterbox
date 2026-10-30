use crate::{
    native_policy::{activation, retry_delay, Appearance, Lifecycle},
    protocol::{recovery, trusted, ORIGIN},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::{oneshot, Notify};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub notifications: bool,
    pub previews: bool,
    pub launch_at_login: bool,
    #[serde(default = "default_enabled")]
    pub translucency: bool,
}
fn default_enabled() -> bool {
    true
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            notifications: true,
            previews: true,
            launch_at_login: false,
            translucency: true,
        }
    }
}
#[derive(Clone, Default, Serialize)]
pub struct UpdateState {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}
pub struct NativeState {
    pub lifecycle: Mutex<Lifecycle>,
    preferences: Mutex<Preferences>,
    appearance: Mutex<Appearance>,
    backdrop: AtomicBool,
    update: Mutex<UpdateState>,
    background: Mutex<String>,
    activations: Mutex<VecDeque<Value>>,
    quit_reply: Mutex<Option<oneshot::Sender<bool>>>,
    pub exiting: AtomicBool,
    pub authenticating: AtomicBool,
    pub authenticated: AtomicBool,
    pub closing: AtomicBool,
    installing: AtomicBool,
    updating: tokio::sync::Mutex<()>,
    polling: tokio::sync::Mutex<()>,
    pub poll: Notify,
}
impl Default for NativeState {
    fn default() -> Self {
        Self {
            lifecycle: Mutex::new(Lifecycle::default()),
            preferences: Mutex::new(Preferences::default()),
            appearance: Mutex::new(Appearance::default()),
            backdrop: AtomicBool::new(false),
            update: Mutex::new(UpdateState {
                status: "idle".into(),
                ..Default::default()
            }),
            background: Mutex::new("Starting".into()),
            activations: Mutex::new(VecDeque::new()),
            quit_reply: Mutex::new(None),
            exiting: AtomicBool::new(false),
            authenticating: AtomicBool::new(false),
            authenticated: AtomicBool::new(false),
            closing: AtomicBool::new(false),
            installing: AtomicBool::new(false),
            updating: tokio::sync::Mutex::new(()),
            polling: tokio::sync::Mutex::new(()),
            poll: Notify::new(),
        }
    }
}

fn update_config() -> Option<(&'static str, url::Url)> {
    let key = option_env!("KB_ONEMAIL_UPDATER_PUBLIC_KEY")
        .unwrap_or(include_str!("../../updater.pub"))
        .trim();
    let endpoint = url::Url::parse(option_env!("KB_ONEMAIL_UPDATER_ENDPOINT").unwrap_or(
        "https://github.com/KB01111/kb-onemail/releases/download/desktop-preview/latest.json",
    ))
    .ok()?;
    (!key.trim().is_empty()
        && endpoint.scheme() == "https"
        && endpoint.username().is_empty()
        && endpoint.password().is_none())
    .then_some((key, endpoint))
}
pub fn snapshot(app: &AppHandle) -> Value {
    let state = app.state::<NativeState>();
    let prefs = state.preferences.lock().unwrap().clone();
    json!({"version":app.package_info().version.to_string(),"notifications":prefs.notifications,"previews":prefs.previews,"translucency":prefs.translucency,"backdrop":state.backdrop.load(Ordering::SeqCst),"launchAtLogin":app.autolaunch().is_enabled().unwrap_or(false),"backgroundStatus":state.background.lock().unwrap().clone(),"update":state.update.lock().unwrap().clone(),"signedUpdates":update_config().is_some()})
}
pub fn refresh_appearance(window: &WebviewWindow) {
    let state = window.state::<NativeState>();
    let appearance = *state.appearance.lock().unwrap();
    let enabled = state.preferences.lock().unwrap().translucency;
    let active = crate::appearance::apply(window, appearance, enabled);
    state.backdrop.store(active, Ordering::SeqCst);
    if window
        .url()
        .is_ok_and(|url| trusted(&url) || recovery(&url))
    {
        let material = if active { "mica" } else { "solid" };
        let _ = window.eval(format!("if(document.documentElement)document.documentElement.dataset.desktopBackdrop='{material}'"));
    }
}
pub fn emit(window: &WebviewWindow, detail: &Value) {
    if window.url().is_ok_and(|u| trusted(&u)) {
        let _ = window.eval(format!(
            "window.dispatchEvent(new CustomEvent('kb-onemail:action',{{detail:{detail}}}))"
        ));
    }
}
pub fn queue(app: &AppHandle, action: Value) {
    let state = app.state::<NativeState>();
    if state.lifecycle.lock().unwrap().ready
        && state.authenticated.load(Ordering::SeqCst)
        && !state.closing.load(Ordering::SeqCst)
    {
        if let Some(window) = app.get_webview_window("main") {
            show(&window);
            emit(&window, &action);
        }
    } else {
        let mut pending = state.activations.lock().unwrap();
        // Bound memory for unsolicited OS protocol launches.
        if pending.len() < 32 {
            pending.push_back(action);
        }
        if let Some(window) = app.get_webview_window("main") {
            show(&window);
        }
    }
}
pub fn arguments(app: &AppHandle, args: impl IntoIterator<Item = String>) {
    let mut found = false;
    for arg in args {
        if let Some(action) = activation(&arg) {
            queue(app, action);
            found = true;
        }
    }
    if !found {
        if let Some(window) = app.get_webview_window("main") {
            show(&window);
        }
    }
}
pub fn show(window: &WebviewWindow) {
    #[cfg(windows)]
    let _ = window.with_webview(|webview| unsafe {
        use windows::core::Interface;
        if let Ok(core) = webview.controller().CoreWebView2() {
            if let Ok(core) =
                core.cast::<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3>()
            {
                let _ = core.Resume();
            }
        }
    });
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}
pub fn hide(window: &WebviewWindow) {
    let _ = window.hide();
    let state = window.state::<NativeState>();
    if !state.lifecycle.lock().unwrap().safe()
        || state.installing.load(Ordering::SeqCst)
        || state.authenticating.load(Ordering::SeqCst)
    {
        return;
    }
    #[cfg(windows)]
    {
        let target = window.clone();
        let _ = window.with_webview(move |webview| unsafe {
            use windows::core::Interface;
            if target.is_visible().unwrap_or(true)
                || !target
                    .state::<NativeState>()
                    .lifecycle
                    .lock()
                    .unwrap()
                    .safe()
            {
                return;
            }
            if let Ok(core) = webview.controller().CoreWebView2() {
                if let Ok(core) =
                    core.cast::<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3>()
                {
                    let again = core.clone();
                    let visible = target.clone();
                    let handler =
                        webview2_com::TrySuspendCompletedHandler::create(Box::new(move |_, _| {
                            if visible.is_visible().unwrap_or(true) {
                                let _ = again.Resume();
                            }
                            Ok(())
                        }));
                    let _ = core.TrySuspend(&handler);
                }
            }
        });
    }
}
pub fn safe_bounds(window: &WebviewWindow) {
    let (Ok(position), Ok(size), Ok(monitors)) = (
        window.outer_position(),
        window.outer_size(),
        window.available_monitors(),
    ) else {
        return;
    };
    if window.is_maximized().unwrap_or(false) {
        return;
    }
    let Some(monitor) = monitors.iter().min_by_key(|m| {
        let p = m.work_area().position;
        let x = position.x as i64 - p.x as i64;
        let y = position.y as i64 - p.y as i64;
        x.saturating_mul(x).saturating_add(y.saturating_mul(y))
    }) else {
        return;
    };
    let work = monitor.work_area();
    let (position, size) = crate::native_policy::clamp_bounds(
        (position.x, position.y),
        (size.width, size.height),
        (
            work.position.x,
            work.position.y,
            work.size.width,
            work.size.height,
        ),
    );
    let inner = window.inner_size().unwrap_or_default();
    let outer = window.outer_size().unwrap_or_default();
    let border = (
        outer.width.saturating_sub(inner.width),
        outer.height.saturating_sub(inner.height),
    );
    let _ = window.set_min_size(Some(tauri::PhysicalSize::new(
        400.min(work.size.width),
        300.min(work.size.height),
    )));
    let _ = window.set_size(tauri::PhysicalSize::new(
        size.0.saturating_sub(border.0).max(1),
        size.1.saturating_sub(border.1).max(1),
    ));
    let _ = window.set_position(tauri::PhysicalPosition::new(position.0, position.1));
}

#[tauri::command]
pub async fn desktop_connect(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Unknown window".into());
    }
    let url = window.url().map_err(|e| e.to_string())?;
    if !recovery(&url) {
        return Err("Recovery is not available here".into());
    }
    let response = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .get(format!("{ORIGIN}/sign-in"))
        .send()
        .await
        .map_err(|_| "Your mailbox could not be reached. Check your connection.".to_string())?;
    if !response.status().is_success() {
        return Err("The mailbox service is temporarily unavailable.".into());
    }
    window
        .navigate(ORIGIN.parse().unwrap())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn desktop_action(
    window: WebviewWindow,
    action: String,
    payload: Value,
) -> Result<Value, String> {
    if window.label() != "main"
        || !window
            .url()
            .is_ok_and(|u| trusted(&u) || (action == "state" && recovery(&u)))
    {
        return Err("This desktop request is not allowed".into());
    }
    let app = window.app_handle().clone();
    let state = app.state::<NativeState>();
    match action.as_str() {
        "state" => {}
        "appearance" => {
            *state.appearance.lock().unwrap() = Appearance::from_payload(payload)?;
            refresh_appearance(&window);
        }
        "preferences" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct Patch {
                notifications: Option<bool>,
                previews: Option<bool>,
                launch_at_login: Option<bool>,
                translucency: Option<bool>,
            }
            let patch: Patch =
                serde_json::from_value(payload).map_err(|_| "Invalid preferences")?;
            if let Some(enabled) = patch.launch_at_login {
                if enabled {
                    app.autolaunch().enable()
                } else {
                    app.autolaunch().disable()
                }
                .map_err(|e| e.to_string())?;
            }
            let saved = {
                let mut prefs = state.preferences.lock().unwrap();
                if let Some(v) = patch.notifications {
                    prefs.notifications = v
                }
                if let Some(v) = patch.previews {
                    prefs.previews = v
                }
                if let Some(v) = patch.launch_at_login {
                    prefs.launch_at_login = v
                }
                if let Some(v) = patch.translucency {
                    prefs.translucency = v;
                }
                prefs.clone()
            };
            let path = app.path().app_config_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            std::fs::write(
                path.join("native-preferences.json"),
                serde_json::to_vec(&saved).unwrap(),
            )
            .map_err(|e| e.to_string())?;
            refresh_appearance(&window);
        }
        "lifecycle" => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Status {
                busy: bool,
                dirty: bool,
            }
            let status: Status =
                serde_json::from_value(payload).map_err(|_| "Invalid lifecycle")?;
            let mut lifecycle = state.lifecycle.lock().unwrap();
            lifecycle.busy = status.busy;
            lifecycle.dirty = status.dirty;
            drop(lifecycle);
            if !window.is_visible().unwrap_or(true) {
                hide(&window);
            }
        }
        "ready" => {
            state.lifecycle.lock().unwrap().ready = true;
            let authenticated = payload
                .get("authenticated")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            state.authenticated.store(authenticated, Ordering::SeqCst);
            if !authenticated {
                return Ok(snapshot(&app));
            }
            let queued = state
                .activations
                .lock()
                .unwrap()
                .drain(..)
                .collect::<Vec<_>>();
            for item in queued {
                emit(&window, &item);
            }
            state.poll.notify_one();
            if !window.is_visible().unwrap_or(true) {
                hide(&window);
            }
        }
        "quit-response" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct Reply {
                request_id: String,
                allow: bool,
            }
            let reply: Reply =
                serde_json::from_value(payload).map_err(|_| "Invalid quit response")?;
            if state.lifecycle.lock().unwrap().pending.as_deref() != Some(reply.request_id.as_str())
            {
                return Err("Stale quit response".into());
            }
            let approved = state
                .lifecycle
                .lock()
                .unwrap()
                .approve(&reply.request_id, reply.allow);
            if approved || !reply.allow {
                if let Some(sender) = state.quit_reply.lock().unwrap().take() {
                    let _ = sender.send(approved);
                }
            }
        }
        "check-mail" => {
            state.poll.notify_one();
        }
        "reload" => {
            if state.installing.load(Ordering::SeqCst) {
                return Err("An update is being installed".into());
            }
            if approve_quit(&app).await {
                *state.lifecycle.lock().unwrap() = Lifecycle::default();
                window
                    .navigate(ORIGIN.parse().unwrap())
                    .map_err(|e| e.to_string())?;
            }
        }
        "check-updates" => {
            check_updates(&app).await;
        }
        "install-update" => {
            install_update(&app).await?;
        }
        "default-apps" => {
            open::that("ms-settings:defaultapps").map_err(|e| e.to_string())?;
        }
        _ => return Err("Unknown desktop action".into()),
    }
    Ok(snapshot(&app))
}

async fn approve_quit(app: &AppHandle) -> bool {
    if app
        .state::<NativeState>()
        .authenticating
        .load(Ordering::SeqCst)
    {
        return false;
    }
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    if window
        .url()
        .is_ok_and(|url| recovery(&url) || url.as_str() == "about:blank")
    {
        app.state::<NativeState>()
            .closing
            .store(true, Ordering::SeqCst);
        return true;
    }
    let id = crate::protocol::new_verifier().0;
    let (tx, rx) = oneshot::channel();
    {
        let state = app.state::<NativeState>();
        let mut lifecycle = state.lifecycle.lock().unwrap();
        if !lifecycle.begin_quit(id.clone()) {
            return false;
        }
        state.closing.store(true, Ordering::SeqCst);
        *state.quit_reply.lock().unwrap() = Some(tx);
    }
    show(&window);
    emit(&window, &json!({"kind":"quit-request","requestId":id}));
    let approved = tokio::time::timeout(Duration::from_secs(30), rx)
        .await
        .is_ok_and(|v| v.unwrap_or(false));
    let state = app.state::<NativeState>();
    state.lifecycle.lock().unwrap().pending = None;
    state.quit_reply.lock().unwrap().take();
    if !approved {
        unfreeze(app);
    }
    approved
}

fn unfreeze(app: &AppHandle) {
    let state = app.state::<NativeState>();
    state.closing.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("document.documentElement.inert=false");
    }
    if state.authenticated.load(Ordering::SeqCst) {
        let queued = state
            .activations
            .lock()
            .unwrap()
            .drain(..)
            .collect::<Vec<_>>();
        for item in queued {
            queue(app, item);
        }
    }
}

pub fn allow_navigation(app: &AppHandle, url: &url::Url) -> bool {
    let state = app.state::<NativeState>();
    let unsafe_navigation = {
        let lifecycle = state.lifecycle.lock().unwrap();
        lifecycle.ready && !lifecycle.safe()
    };
    if !unsafe_navigation {
        return true;
    }
    let app = app.clone();
    let url = url.clone();
    tauri::async_runtime::spawn(async move {
        if approve_quit(&app).await {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("document.documentElement.inert=true");
                *app.state::<NativeState>().lifecycle.lock().unwrap() = Lifecycle::default();
                let _ = window.navigate(url);
            }
        }
    });
    false
}

pub async fn finish_authentication(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    let state = app.state::<NativeState>();
    state.authenticating.store(false, Ordering::SeqCst);
    let needs_save = {
        let lifecycle = state.lifecycle.lock().unwrap();
        lifecycle.ready && lifecycle.dirty
    };
    if needs_save && !approve_quit(app).await {
        return Err(
            "Your account is connected. Save your current draft and reload to finish.".into(),
        );
    }
    *state.lifecycle.lock().unwrap() = Lifecycle::default();
    window
        .navigate(ORIGIN.parse().unwrap())
        .map_err(|_| "Could not reload KB OneMail after sign-in.".into())
}
pub fn request_quit(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if app.state::<NativeState>().installing.load(Ordering::SeqCst) {
            return;
        }
        if approve_quit(&app).await {
            app.state::<NativeState>()
                .exiting
                .store(true, Ordering::SeqCst);
            app.exit(0);
        }
    });
}
pub async fn check_updates(app: &AppHandle) {
    let state = app.state::<NativeState>();
    let Ok(_guard) = state.updating.try_lock() else {
        return;
    };
    let Some((key, endpoint)) = update_config() else {
        *state.update.lock().unwrap() = UpdateState {
            status: "error".into(),
            error: Some("Signed updates are not configured in this build.".into()),
            ..Default::default()
        };
        return;
    };
    *state.update.lock().unwrap() = UpdateState {
        status: "checking".into(),
        ..Default::default()
    };
    let result = async {
        let updater = app
            .updater_builder()
            .pubkey(key)
            .endpoints(vec![endpoint])?
            .build()?;
        updater.check().await
    }
    .await;
    *state.update.lock().unwrap() = match result {
        Ok(Some(update)) => UpdateState {
            status: "available".into(),
            version: Some(update.version),
            error: None,
        },
        Ok(None) => UpdateState {
            status: "current".into(),
            ..Default::default()
        },
        Err(_) => UpdateState {
            status: "error".into(),
            error: Some("Could not check for a verified update. Try again later.".into()),
            ..Default::default()
        },
    };
}
async fn install_update(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<NativeState>();
    let _guard = state
        .updating
        .try_lock()
        .map_err(|_| "An update operation is already running")?;
    let (key, endpoint) = update_config().ok_or("Signed updates are not configured")?;
    let updater = app
        .updater_builder()
        .pubkey(key)
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater
        .check()
        .await
        .map_err(|_| "Could not verify update availability")?
    else {
        return Ok(());
    };
    let answer=rfd::AsyncMessageDialog::new().set_title("Update KB OneMail").set_description(format!("Install KB OneMail {}? Your current draft will be saved before the app closes. The downloaded update must pass signature verification.",update.version)).set_buttons(rfd::MessageButtons::OkCancel).show().await;
    if answer != rfd::MessageDialogResult::Ok {
        return Ok(());
    }
    if !approve_quit(app).await {
        return Err(
            "Update cancelled because the mailbox did not confirm it was safe to close.".into(),
        );
    }
    state.installing.store(true, Ordering::SeqCst);
    // Freeze the renderer after its save acknowledgement, before installer download.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("document.documentElement.inert=true");
    }
    let result = update.download_and_install(|_, _| {}, || {}).await;
    state.installing.store(false, Ordering::SeqCst);
    unfreeze(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("document.documentElement.inert=false");
    }
    result.map_err(|_| {
        "The update could not be verified or installed. Your current version is unchanged.".into()
    })
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    if let Err(error) = crate::notification_identity::register() {
        eprintln!("Could not register notification history identity: {error}");
    }
    if let Ok(path) = app.path().app_config_dir() {
        if let Ok(bytes) = std::fs::read(path.join("native-preferences.json")) {
            if let Ok(prefs) = serde_json::from_slice(&bytes) {
                *app.state::<NativeState>().preferences.lock().unwrap() = prefs;
            }
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        refresh_appearance(&window);
    }
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    let items = [
        ("open", "Open KB OneMail"),
        ("compose", "Compose"),
        ("settings", "Settings"),
        ("refresh", "Check mail"),
        ("quit", "Quit"),
    ]
    .into_iter()
    .map(|(id, label)| MenuItem::with_id(app, id, label, true, None::<&str>))
    .collect::<tauri::Result<Vec<_>>>()?;
    let refs = items
        .iter()
        .map(|item| item as &dyn tauri::menu::IsMenuItem<_>)
        .collect::<Vec<_>>();
    let menu = Menu::with_items(app, &refs)?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("KB OneMail")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => request_quit(app),
            "open" => {
                if let Some(w) = app.get_webview_window("main") {
                    show(&w)
                }
            }
            "refresh" => {
                app.state::<NativeState>().poll.notify_one();
                queue(app, json!({"kind":"refresh"}));
            }
            kind => queue(app, json!({"kind":kind})),
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, tauri::tray::TrayIconEvent::DoubleClick { .. }) {
                if let Some(w) = tray.app_handle().get_webview_window("main") {
                    show(&w)
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    use tauri_plugin_deep_link::DeepLinkExt;
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            if let Some(action) = activation(url.as_str()) {
                queue(&handle, action)
            }
        }
    });
    // mailto is an optional Default apps capability, never a takeover of the global protocol.
    for argument in std::env::args().skip(1) {
        if let Some(action) = activation(&argument) {
            queue(app, action);
        }
    }
    let poll_app = app.clone();
    tauri::async_runtime::spawn(async move {
        poll_loop(poll_app).await;
    });
    let update_app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            check_updates(&update_app).await;
            tokio::time::sleep(Duration::from_secs(86400 - 15)).await;
        }
    });
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MailPage {
    account_id: String,
    cursor: String,
    page_token: Option<String>,
    unread: u32,
    reset: bool,
    messages: Vec<MailMessage>,
}
#[derive(Deserialize)]
struct MailMessage {
    id: String,
    sender: String,
    subject: String,
}
#[derive(Default)]
struct MailCursor {
    cursor: Option<String>,
    page: Option<String>,
    next_cursor: Option<String>,
    seen: VecDeque<String>,
    pending: Vec<MailMessage>,
    unread: u32,
}
impl MailCursor {
    fn consume(&mut self, page: MailPage) -> Option<(Vec<MailMessage>, bool)> {
        self.unread = page.unread;
        if page.reset {
            self.pending.clear();
            self.seen.clear();
        }
        if !page.reset {
            for message in page.messages {
                if !self.seen.contains(&message.id) {
                    self.seen.push_back(message.id.clone());
                    if self.seen.len() > 2048 {
                        self.seen.pop_front();
                    }
                    if self.pending.len() < 1000 {
                        self.pending.push(message);
                    }
                }
            }
        }
        self.next_cursor = Some(page.cursor);
        self.page = page.page_token;
        if self.page.is_some() {
            return None;
        }
        let changed = self.cursor != self.next_cursor;
        self.cursor = self.next_cursor.take();
        Some((std::mem::take(&mut self.pending), changed))
    }
}
async fn poll_loop(app: AppHandle) {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(25))
        .build()
        .unwrap();
    let mut cursors = HashMap::new();
    let mut failures = 0;
    loop {
        let state = app.state::<NativeState>();
        if !online() {
            *state.background.lock().unwrap() = "Offline — mail checks paused".into();
            tokio::select! {_=tokio::time::sleep(Duration::from_secs(30))=>{},_=state.poll.notified()=>{}}
            continue;
        }
        let result = check_mail(&app, &client, &mut cursors).await;
        if let Err(message) = result {
            failures = (failures + 1).min(20);
            *state.background.lock().unwrap() = message;
        } else {
            failures = 0;
            *state.background.lock().unwrap() = "Checking every 5 minutes".into();
        }
        tokio::select! {_=tokio::time::sleep(Duration::from_secs(retry_delay(failures)))=>{},_=state.poll.notified()=>{}}
    }
}
async fn check_mail(
    app: &AppHandle,
    client: &reqwest::Client,
    cursors: &mut HashMap<String, MailCursor>,
) -> Result<(), String> {
    let state = app.state::<NativeState>();
    let _guard = state.polling.lock().await;
    let window = app
        .get_webview_window("main")
        .ok_or("Mailbox window unavailable")?;
    // Never call this on the UI thread: WebView2's cookie completion needs that thread.
    let cookies = window
        .cookies_for_url(ORIGIN.parse().unwrap())
        .map_err(|_| "Could not read session")?
        .into_iter()
        .filter(|c| {
            matches!(
                c.name(),
                "__Secure-better-auth.session_token" | "better-auth.session_token"
            )
        })
        .map(|c| format!("{}={}", c.name(), c.value()))
        .collect::<Vec<_>>()
        .join("; ");
    if cookies.is_empty() {
        cursors.clear();
        badge(&window, 0);
        return Err("Sign in to enable background mail".into());
    }
    let response = client
        .get(format!("{ORIGIN}/api/accounts"))
        .header(reqwest::header::COOKIE, &cookies)
        .send()
        .await
        .map_err(|_| "Connection unavailable — retrying")?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        cursors.clear();
        badge(&window, 0);
        return Err("Sign in to enable background mail".into());
    }
    let accounts: Value = response
        .error_for_status()
        .map_err(|_| "Account check failed")?
        .json()
        .await
        .map_err(|_| "Invalid account response")?;
    let identities = accounts["accounts"]
        .as_array()
        .ok_or("Invalid account response")?;
    let ids = identities
        .iter()
        .filter_map(|a| a["accountId"].as_str())
        .collect::<HashSet<_>>();
    cursors.retain(|id, _| ids.contains(id.as_str()));
    let mut error = None;
    // Sequential account work intentionally keeps concurrency below the server budget of three.
    for id in ids {
        let cursor = cursors.entry(id.to_string()).or_default();
        let result: Result<(), String> = async {
            for _ in 0..100 {
                let mut body = json!({"accountId":id});
                if let Some(value) = &cursor.cursor {
                    body["cursor"] = json!(value)
                }
                if let Some(value) = &cursor.page {
                    body["pageToken"] = json!(value)
                }
                let response = client
                    .post(format!("{ORIGIN}/api/native-mail"))
                    .header(reqwest::header::COOKIE, &cookies)
                    .header(reqwest::header::ORIGIN, ORIGIN)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|_| "Connection unavailable — retrying")?;
                let page: MailPage = response
                    .error_for_status()
                    .map_err(|_| "Mail check failed — retrying")?
                    .json()
                    .await
                    .map_err(|_| "Invalid mail response")?;
                if page.account_id != id
                    || page.cursor.len() > 40
                    || page.messages.len() > 10
                    || page.page_token.as_ref().is_some_and(|p| p.len() > 4096)
                {
                    return Err("Invalid mail response".into());
                }
                if let Some((pending, changed)) = cursor.consume(page) {
                    if changed
                        && state.lifecycle.lock().unwrap().ready
                        && window.is_visible().unwrap_or(false)
                        && !window.is_minimized().unwrap_or(true)
                    {
                        emit(&window, &json!({"kind":"refresh"}));
                    }
                    if !pending.is_empty() && !window.is_focused().unwrap_or(true) {
                        let prefs = state.preferences.lock().unwrap().clone();
                        if prefs.notifications {
                            notify(&pending, prefs.previews);
                        }
                    }
                    break;
                }
            }
            if cursor.page.is_some() {
                return Err("Catching up with mailbox changes".into());
            }
            Ok(())
        }
        .await;
        if let Err(message) = result {
            error = Some(message);
        }
    }
    let unread = cursors
        .values()
        .fold(0u32, |sum, cursor| sum.saturating_add(cursor.unread));
    badge(&window, unread);
    error.map_or(Ok(()), Err)
}
fn badge(window: &WebviewWindow, unread: u32) {
    let title = if unread == 0 {
        "KB OneMail".to_string()
    } else {
        format!("KB OneMail ({unread} unread)")
    };
    if !window
        .state::<NativeState>()
        .authenticating
        .load(Ordering::SeqCst)
    {
        let _ = window.set_title(&title);
    }
    if let Some(tray) = window.app_handle().tray_by_id("main") {
        let _ = tray.set_tooltip(Some(&title));
    }
    if unread == 0 {
        let _ = window.set_overlay_icon(None);
    } else {
        let mut rgba = vec![0u8; 16 * 16 * 4];
        for y in 0..16 {
            for x in 0..16 {
                if (x as i32 - 8).pow(2) + (y as i32 - 8).pow(2) <= 49 {
                    let i = (y * 16 + x) * 4;
                    rgba[i..i + 4].copy_from_slice(&[37, 99, 235, 255]);
                }
            }
        }
        let _ = window.set_overlay_icon(Some(tauri::image::Image::new_owned(rgba, 16, 16)));
    }
}
#[cfg(windows)]
fn online() -> bool {
    use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation};
    NetworkInformation::GetInternetConnectionProfile()
        .and_then(|p| p.GetNetworkConnectivityLevel())
        .map(|l| l == NetworkConnectivityLevel::InternetAccess)
        .unwrap_or(false)
}
#[cfg(not(windows))]
fn online() -> bool {
    true
}
#[cfg(windows)]
fn notify(messages: &[MailMessage], previews: bool) {
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        UI::Notifications::{ToastNotification, ToastNotificationManager},
    };
    fn xml(value: &str) -> String {
        value
            .chars()
            .filter(|c| !c.is_control())
            .take(256)
            .collect::<String>()
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }
    let first = &messages[0];
    let title = if previews {
        xml(&first.sender)
    } else {
        "New mail".into()
    };
    let body = if previews {
        format!(
            "{}{}",
            xml(&first.subject),
            if messages.len() > 1 {
                format!(" (+{} more)", messages.len() - 1)
            } else {
                String::new()
            }
        )
    } else {
        format!("{} new message(s) in KB OneMail", messages.len())
    };
    let result = (|| -> windows::core::Result<()> {
        let doc = XmlDocument::new()?;
        doc.LoadXml(&HSTRING::from(format!("<toast activationType=\"protocol\" launch=\"kb-onemail://inbox\"><visual><binding template=\"ToastGeneric\"><text>{title}</text><text>{body}</text></binding></visual><actions><action content=\"Open inbox\" activationType=\"protocol\" arguments=\"kb-onemail://inbox\"/></actions></toast>")))?;
        let toast = ToastNotification::CreateToastNotification(&doc)?;
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(
            "dev.kevinjbridgelal.betterbox",
        ))?
        .Show(&toast)
    })();
    if result.is_err() {
        eprintln!("Windows did not accept a mail notification");
    }
}
#[cfg(not(windows))]
fn notify(_messages: &[MailMessage], _previews: bool) {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn existing_desktop_preferences_keep_their_choices_when_translucency_is_added() {
        let prefs: Preferences = serde_json::from_str(
            r#"{"notifications":false,"previews":false,"launchAtLogin":true}"#,
        )
        .unwrap();
        assert!(!prefs.notifications);
        assert!(!prefs.previews);
        assert!(prefs.launch_at_login);
        assert!(prefs.translucency);
        let saved = serde_json::to_string(&Preferences {
            translucency: false,
            ..prefs
        })
        .unwrap();
        assert!(
            !serde_json::from_str::<Preferences>(&saved)
                .unwrap()
                .translucency
        );
    }
    fn page(cursor: &str, token: Option<&str>, reset: bool) -> MailPage {
        MailPage {
            account_id: "account".into(),
            cursor: cursor.into(),
            page_token: token.map(str::to_owned),
            unread: 2,
            reset,
            messages: vec![MailMessage {
                id: "message".into(),
                sender: "sender".into(),
                subject: "subject".into(),
            }],
        }
    }
    #[test]
    fn partial_history_retains_original_cursor_and_only_notifies_once_after_drain() {
        let mut cursor = MailCursor {
            cursor: Some("100".into()),
            ..Default::default()
        };
        assert!(cursor.consume(page("100", Some("page2"), false)).is_none());
        assert_eq!(cursor.cursor.as_deref(), Some("100"));
        let (messages, changed) = cursor.consume(page("200", None, false)).unwrap();
        assert!(changed);
        assert_eq!(cursor.cursor.as_deref(), Some("200"));
        assert_eq!(messages.len(), 1);
    }
    #[test]
    fn reset_never_notifies_old_messages_and_pending_summaries_are_bounded() {
        let mut cursor = MailCursor::default();
        assert!(cursor
            .consume(page("100", None, true))
            .unwrap()
            .0
            .is_empty());
        for n in 0..3000 {
            let mut p = page("100", Some("next"), false);
            p.messages[0].id = n.to_string();
            cursor.consume(p);
        }
        assert!(cursor.pending.len() <= 1000);
        assert!(cursor.seen.len() <= 2048);
    }
}
