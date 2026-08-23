use serde::Serialize;
use std::sync::{Mutex, MutexGuard};

const CREDENTIAL_SERVICE: &str = "com.xmly.swell-note.webdav";

struct CredentialStoreState {
    operation_lock: Mutex<()>,
    unavailable_reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialStoreStatus {
    available: bool,
    store: &'static str,
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
        .manage(credential_store_state)
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            credential_store_status,
            save_webdav_password,
            load_webdav_password,
            delete_webdav_password,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
