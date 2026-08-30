export type StorageQuotaReport = {
  persisted: boolean | null
  quotaBytes: number | null
  supported: boolean
  usageBytes: number | null
  usagePercent: number | null
}

export async function inspectStorageQuota(): Promise<StorageQuotaReport> {
  const storage = navigator.storage
  if (!storage?.estimate) {
    return { persisted: null, quotaBytes: null, supported: false, usageBytes: null, usagePercent: null }
  }
  const [estimate, persisted] = await Promise.all([
    storage.estimate(),
    storage.persisted?.().catch(() => false) ?? Promise.resolve(null),
  ])
  const usageBytes = finiteNumber(estimate.usage)
  const quotaBytes = finiteNumber(estimate.quota)
  return {
    persisted,
    quotaBytes,
    supported: true,
    usageBytes,
    usagePercent: usageBytes !== null && quotaBytes && quotaBytes > 0
      ? Math.min(100, Math.round((usageBytes / quotaBytes) * 1_000) / 10)
      : null,
  }
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false
  // 浏览器通常要求该调用来自用户手势；调用方必须绑定在明确按钮上，不能启动时静默申请。
  return navigator.storage.persist()
}

function finiteNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}
