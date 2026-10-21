use std::env;
use std::path::PathBuf;

fn main() {
    // tauri-build normally embeds the Windows manifest only into the app
    // binary. Test executables then lack Common Controls v6 and crash on
    // start with STATUS_ENTRYPOINT_NOT_FOUND, so embed it ourselves into
    // every binary the crate links, tests included.
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    tauri_build::try_build(attributes).expect("failed to run tauri-build");

    if env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
}
