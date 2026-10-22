// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Must come first: as an askpass helper this process opens no window.
    if let Some(code) = garam_lib::run_askpass_helper() {
        std::process::exit(code);
    }
    garam_lib::run()
}
