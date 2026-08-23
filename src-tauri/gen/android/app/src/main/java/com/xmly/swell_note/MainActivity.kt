package com.xmly.swell_note

import android.os.Bundle
import android.content.Context
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private external fun initNdkContext(context: Context)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // Android 系统凭据库通过 JNI 读取应用上下文，必须在 Tauri 启动 Rust 后端前初始化。
    initNdkContext(applicationContext)
    super.onCreate(savedInstanceState)
  }
}
