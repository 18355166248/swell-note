export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return
  window.addEventListener("load", () => {
    // 仅生产 Web 构建注册，避免开发期缓存旧 chunk 干扰热更新。
    void navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Swell Note 离线外壳注册失败", error)
    })
  })
}
