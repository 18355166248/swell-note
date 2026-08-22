#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 原生能力统一在这里注册；文件系统、SQLite 和安全存储后续都通过插件接入。
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
