use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const CREDENTIAL_SERVICE: &str = "com.xmly.swell-note.webdav";
const SEARCH_INDEX_SCHEMA_VERSION: i64 = 1;

struct CredentialStoreState {
    operation_lock: Mutex<()>,
    unavailable_reason: Option<String>,
}

struct SearchIndexState {
    connection: Mutex<Connection>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchIndexEntry {
    content: String,
    note_id: String,
    path: String,
    tags: String,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialStoreStatus {
    available: bool,
    store: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchIndexStatus {
    cache_count: u64,
    database_size_bytes: u64,
    healthy: bool,
    indexed_notes: u64,
    schema_version: i64,
}

#[tauri::command]
fn credential_store_status(state: tauri::State<CredentialStoreState>) -> CredentialStoreStatus {
    CredentialStoreStatus {
        available: state.unavailable_reason.is_none(),
        store: native_store_name(),
    }
}

#[tauri::command]
fn save_webdav_password(
    state: tauri::State<CredentialStoreState>,
    account: String,
    password: String,
) -> Result<(), String> {
    let _guard = lock_credential_store(&state)?;
    credential_entry(&account)?
        .set_password(&password)
        .map_err(credential_error)
}

#[tauri::command]
fn load_webdav_password(
    state: tauri::State<CredentialStoreState>,
    account: String,
) -> Result<Option<String>, String> {
    let _guard = lock_credential_store(&state)?;
    match credential_entry(&account)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(error) => Err(credential_error(error)),
    }
}

#[tauri::command]
fn delete_webdav_password(
    state: tauri::State<CredentialStoreState>,
    account: String,
) -> Result<(), String> {
    let _guard = lock_credential_store(&state)?;
    match credential_entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(error) => Err(credential_error(error)),
    }
}

fn lock_credential_store(state: &CredentialStoreState) -> Result<MutexGuard<'_, ()>, String> {
    if let Some(reason) = &state.unavailable_reason {
        return Err(format!("当前设备的系统安全存储不可用：{reason}"));
    }
    // Windows 凭据管理器对同一条目并发读写的顺序没有保证，所有操作统一串行化。
    state
        .operation_lock
        .lock()
        .map_err(|_| "系统安全存储暂时被占用".to_string())
}

fn credential_entry(account: &str) -> Result<keyring_core::Entry, String> {
    let normalized_account = account.trim().to_lowercase();
    if normalized_account.is_empty() {
        return Err("坚果云账号不能为空".to_string());
    }
    keyring_core::Entry::new(CREDENTIAL_SERVICE, &normalized_account).map_err(credential_error)
}

fn credential_error(_error: keyring_core::Error) -> String {
    // 不把账号或密码拼入错误信息，避免敏感信息进入前端日志和错误上报。
    "系统安全存储操作失败".to_string()
}

#[tauri::command]
fn clear_note_search_index(
    state: tauri::State<SearchIndexState>,
    cache_id: String,
) -> Result<(), String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "搜索索引暂时被占用".to_string())?;
    connection
        .execute(
            "DELETE FROM note_search WHERE cache_id = ?1",
            params![cache_id],
        )
        .map_err(search_index_error)?;
    Ok(())
}

#[tauri::command]
fn upsert_note_search_index(
    state: tauri::State<SearchIndexState>,
    cache_id: String,
    entries: Vec<SearchIndexEntry>,
) -> Result<(), String> {
    let mut connection = state
        .connection
        .lock()
        .map_err(|_| "搜索索引暂时被占用".to_string())?;
    let transaction = connection.transaction().map_err(search_index_error)?;
    // FTS5 不支持普通 UPSERT；同一事务中先删后插，任何失败都会保留上一版完整索引。
    for entry in entries {
        transaction
            .execute(
                "DELETE FROM note_search WHERE cache_id = ?1 AND note_id = ?2",
                params![cache_id, entry.note_id],
            )
            .map_err(search_index_error)?;
        transaction
            .execute(
                "INSERT INTO note_search(cache_id, note_id, title, path, content, tags) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![cache_id, entry.note_id, entry.title, entry.path, entry.content, entry.tags],
            )
            .map_err(search_index_error)?;
    }
    transaction.commit().map_err(search_index_error)
}

#[tauri::command]
fn search_note_index(
    state: tauri::State<SearchIndexState>,
    cache_id: String,
    query: String,
    limit: u32,
) -> Result<Vec<String>, String> {
    let match_query = build_match_query(&query);
    if match_query.is_empty() {
        return Ok(Vec::new());
    }
    let connection = state
        .connection
        .lock()
        .map_err(|_| "搜索索引暂时被占用".to_string())?;
    let mut results = search_note_ids(&connection, &cache_id, &match_query, limit)?;
    if results.len() < limit as usize {
        let mut seen = results.iter().cloned().collect::<HashSet<_>>();
        for note_id in search_note_ids_like(&connection, &cache_id, &query, limit)? {
            if results.len() >= limit as usize {
                break;
            }
            if seen.insert(note_id.clone()) {
                results.push(note_id);
            }
        }
    }
    Ok(results)
}

#[tauri::command]
fn get_search_index_status(
    state: tauri::State<SearchIndexState>,
) -> Result<SearchIndexStatus, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "搜索索引暂时被占用".to_string())?;
    search_index_status(&connection).map_err(search_index_error)
}

#[tauri::command]
fn rebuild_note_search_index(
    state: tauri::State<SearchIndexState>,
) -> Result<SearchIndexStatus, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "搜索索引暂时被占用".to_string())?;
    // Markdown 与 IndexedDB 快照才是事实来源；索引异常时清空可重建数据，比尝试保留损坏页更安全。
    connection
        .execute_batch("DROP TABLE IF EXISTS note_search;")
        .map_err(search_index_error)?;
    initialize_search_index(&connection).map_err(search_index_error)?;
    // VACUUM 失败不能让索引表处于缺失状态，因此必须在重建成功之后再压缩数据库。
    connection.execute_batch("VACUUM;").map_err(search_index_error)?;
    search_index_status(&connection).map_err(search_index_error)
}

fn build_match_query(query: &str) -> String {
    query
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .map(|token| format!("\"{}\"*", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn search_note_ids(
    connection: &Connection,
    cache_id: &str,
    match_query: &str,
    limit: u32,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT note_id FROM note_search WHERE note_search MATCH ?1 AND cache_id = ?2 ORDER BY rank LIMIT ?3")
        .map_err(search_index_error)?;
    let rows = statement
        .query_map(params![match_query, cache_id, limit], |row| row.get(0))
        .map_err(search_index_error)?;
    rows.collect::<Result<Vec<String>, _>>()
        .map_err(search_index_error)
}

fn search_note_ids_like(
    connection: &Connection,
    cache_id: &str,
    query: &str,
    limit: u32,
) -> Result<Vec<String>, String> {
    let pattern = format!("%{}%", query.to_lowercase());
    let mut statement = connection
        .prepare(
            "SELECT note_id FROM note_search
             WHERE cache_id = ?1 AND (
               lower(title) LIKE ?2 OR lower(path) LIKE ?2 OR lower(content) LIKE ?2 OR lower(tags) LIKE ?2
             ) LIMIT ?3",
        )
        .map_err(search_index_error)?;
    let rows = statement
        .query_map(params![cache_id, pattern, limit], |row| row.get(0))
        .map_err(search_index_error)?;
    rows.collect::<Result<Vec<String>, _>>()
        .map_err(search_index_error)
}

fn search_index_error(_error: rusqlite::Error) -> String {
    // 查询内容和本地路径不进入跨层错误信息，避免搜索词被意外记录到前端日志。
    "SQLite 搜索索引操作失败".to_string()
}

fn initialize_search_index(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;",
    )?;
    let current_version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if current_version > SEARCH_INDEX_SCHEMA_VERSION {
        return Err(rusqlite::Error::InvalidQuery);
    }
    if current_version < 1 {
        // 每个迁移只负责从上一版本前进一级，未来扩展字段时可继续追加版本分支。
        connection.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS note_search USING fts5(
           cache_id UNINDEXED,
           note_id UNINDEXED,
           title,
           path,
           content,
           tags,
           tokenize = 'unicode61'
         );
         PRAGMA user_version = 1;",
        )?;
    }
    Ok(())
}

fn search_index_status(connection: &Connection) -> Result<SearchIndexStatus, rusqlite::Error> {
    let check: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    let schema_version = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let indexed_notes: i64 =
        connection.query_row("SELECT count(*) FROM note_search", [], |row| row.get(0))?;
    let cache_count: i64 = connection.query_row(
        "SELECT count(DISTINCT cache_id) FROM note_search",
        [],
        |row| row.get(0),
    )?;
    let page_count: i64 = connection.query_row("PRAGMA page_count", [], |row| row.get(0))?;
    let page_size: i64 = connection.query_row("PRAGMA page_size", [], |row| row.get(0))?;
    Ok(SearchIndexStatus {
        cache_count: cache_count.max(0) as u64,
        database_size_bytes: page_count.max(0).saturating_mul(page_size.max(0)) as u64,
        healthy: check.eq_ignore_ascii_case("ok") && schema_version == SEARCH_INDEX_SCHEMA_VERSION,
        indexed_notes: indexed_notes.max(0) as u64,
        schema_version,
    })
}

fn open_search_index(path: &Path) -> Result<Connection, rusqlite::Error> {
    match try_open_search_index(path) {
        Ok(connection) => Ok(connection),
        Err(_) => {
            // 搜索库不保存用户正文的唯一副本；保留损坏文件用于排查后创建空索引，启动不应被缓存损坏阻断。
            archive_corrupt_search_index(path);
            try_open_search_index(path)
        }
    }
}

fn try_open_search_index(path: &Path) -> Result<Connection, rusqlite::Error> {
    let connection = Connection::open(path)?;
    initialize_search_index(&connection)?;
    if !search_index_status(&connection)?.healthy {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(connection)
}

fn archive_corrupt_search_index(path: &Path) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let backup_path = PathBuf::from(format!("{}.corrupt-{timestamp}", path.display()));
    let _ = fs::rename(path, backup_path);
    for suffix in ["-wal", "-shm"] {
        let _ = fs::remove_file(PathBuf::from(format!("{}{suffix}", path.display())));
    }
}

fn initialize_native_credential_store() -> Result<(), keyring_core::Error> {
    #[cfg(target_os = "macos")]
    keyring_core::set_default_store(apple_native_keyring_store::keychain::Store::new()?);
    #[cfg(target_os = "ios")]
    keyring_core::set_default_store(apple_native_keyring_store::protected::Store::new()?);
    #[cfg(target_os = "windows")]
    keyring_core::set_default_store(windows_native_keyring_store::Store::new()?);
    #[cfg(target_os = "linux")]
    keyring_core::set_default_store(zbus_secret_service_keyring_store::Store::new()?);
    #[cfg(target_os = "android")]
    keyring_core::set_default_store(android_native_keyring_store::Store::new()?);
    Ok(())
}

fn native_store_name() -> &'static str {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return "Apple Keychain";
    #[cfg(target_os = "windows")]
    return "Windows Credential Manager";
    #[cfg(target_os = "android")]
    return "Android Keystore";
    #[cfg(target_os = "linux")]
    return "Secret Service";
    #[allow(unreachable_code)]
    "System Credential Store"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 安全存储初始化失败不能阻断笔记启动；前端会降级为每次手动输入应用密码。
    let credential_store_state = CredentialStoreState {
        operation_lock: Mutex::new(()),
        unavailable_reason: initialize_native_credential_store()
            .err()
            .map(|error| error.to_string()),
    };
    tauri::Builder::default()
        .setup(|app| {
            let data_directory = app.path().app_data_dir()?;
            fs::create_dir_all(&data_directory)?;
            let connection = open_search_index(&data_directory.join("note-search.sqlite3"))?;
            app.manage(SearchIndexState {
                connection: Mutex::new(connection),
            });
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .manage(credential_store_state)
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            credential_store_status,
            save_webdav_password,
            load_webdav_password,
            delete_webdav_password,
            clear_note_search_index,
            upsert_note_search_index,
            search_note_index,
            get_search_index_status,
            rebuild_note_search_index,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_fts_index_supports_cache_isolation_and_prefix_search() {
        let connection = Connection::open_in_memory().expect("open sqlite");
        initialize_search_index(&connection).expect("initialize fts");
        connection
            .execute(
                "INSERT INTO note_search(cache_id, note_id, title, path, content, tags) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["vault-a", "note-1", "周报", "工作/周报.md", "本周完成 SQLite 索引", "工作"],
            )
            .expect("insert note");
        connection
            .execute(
                "INSERT INTO note_search(cache_id, note_id, title, path, content, tags) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["vault-b", "note-2", "周报", "其他/周报.md", "不应跨库命中", "工作"],
            )
            .expect("insert other vault");

        let ids = search_note_ids(&connection, "vault-a", &build_match_query("SQLite"), 20)
            .expect("search notes");
        assert_eq!(ids, vec!["note-1"]);
        let substring_ids = search_note_ids_like(&connection, "vault-a", "完成", 20)
            .expect("search chinese substring");
        assert_eq!(substring_ids, vec!["note-1"]);
    }

    #[test]
    fn sqlite_index_reports_health_and_can_rebuild() {
        let connection = Connection::open_in_memory().expect("open sqlite");
        initialize_search_index(&connection).expect("initialize fts");
        connection
            .execute(
                "INSERT INTO note_search(cache_id, note_id, title, path, content, tags) VALUES ('a', '1', '标题', 'a.md', '正文', '')",
                [],
            )
            .expect("insert note");
        let status = search_index_status(&connection).expect("read status");
        assert!(status.healthy);
        assert_eq!(status.indexed_notes, 1);
        assert_eq!(status.cache_count, 1);
        assert_eq!(status.schema_version, SEARCH_INDEX_SCHEMA_VERSION);
    }
}

/// Tauri Mobile 当前不会为第三方 Android 凭据库初始化 ndk-context；
/// MainActivity 会在启动 Rust 后端前调用此 JNI 入口。
#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_xmly_swell_1note_MainActivity_initNdkContext(
    env: jni::JNIEnv,
    _class: jni::objects::JObject,
    context: jni::objects::JObject,
) {
    use std::ffi::c_void;
    use std::sync::OnceLock;

    use jni::objects::GlobalRef;

    static CONTEXT: OnceLock<Option<GlobalRef>> = OnceLock::new();
    CONTEXT.get_or_init(|| match env.new_global_ref(&context) {
        Ok(reference) => {
            let vm = env.get_java_vm().expect("Android Java VM unavailable");
            unsafe {
                ndk_context::initialize_android_context(
                    vm.get_java_vm_pointer() as *mut c_void,
                    reference.as_obj().as_raw() as _,
                );
            }
            Some(reference)
        }
        Err(_) => None,
    });
}
