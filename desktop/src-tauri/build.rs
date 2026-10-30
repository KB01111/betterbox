fn main() {
    println!("cargo:rerun-if-env-changed=KB_ONEMAIL_UPDATER_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=KB_ONEMAIL_UPDATER_ENDPOINT");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_auth",
            "desktop_action",
            "desktop_connect",
        ]),
    ))
    .expect("build desktop capabilities");
}
