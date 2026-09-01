package com.xmly.swell_note

import android.os.Bundle
import android.content.Context
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  companion object {
    init {
      // initNdkContext 必须早于 Tauri/Rust 启动；先显式加载动态库，避免首次调用 JNI 时找不到实现而闪退。
      System.loadLibrary("swell_note_lib")
    }
  }

  private external fun initNdkContext(context: Context)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // Android 系统凭据库通过 JNI 读取应用上下文，必须在 Tauri 启动 Rust 后端前初始化。
    initNdkContext(applicationContext)
    super.onCreate(savedInstanceState)
  }
}
