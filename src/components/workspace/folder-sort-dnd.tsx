import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardSensorOptions,
  type KeyboardSensorProps,
  type PointerSensorOptions,
  type PointerSensorProps,
  type ScreenReaderInstructions,
} from "@dnd-kit/core"
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable"

import { reorderTopLevelPaths } from "@/services/preferences/folder-order-preferences"

// legacy dnd-kit 的传感器在拖动激活后把 move/end/keydown 监听挂到 document 上，且 DndContext
// 卸载时不会 detach 进行中的传感器实例：旧监听会一直留在 document 上，带着旧闭包响应
// 后续按键/指针事件（官方 issue 中已知的行为）。因此这里的策略是：
// 1. 每次拖动绑定一个不可复用的会话对象，失效（dead=true）后任何回调都不能复活它；
// 2. 继承内置传感器类（dnd-kit 官方自定义传感器的扩展方式），登记每个激活实例，
//    失效时主动 forceDetach 摘掉 document 监听，不让旧监听吞掉或干扰新拖动。

type DetachableSensor = { forceDetach(): void }

export type SensorRegistry = {
  forceDetachAll(): void
  register(sensor: DetachableSensor): void
  unregister(sensor: DetachableSensor): void
}

function createSensorRegistry(): SensorRegistry {
  // 不设关闭标志：失效后同一挂载内可以开始新拖动，新传感器照常登记；
  // forceDetachAll 只终止当前已登记的实例，实例在正常结束/被取消时自行注销。
  const sensors = new Set<DetachableSensor>()
  return {
    forceDetachAll() {
      for (const sensor of [...sensors]) sensor.forceDetach()
    },
    register(sensor) {
      sensors.add(sensor)
    },
    unregister(sensor) {
      sensors.delete(sensor)
    },
  }
}

type RegistryOption = { registry?: SensorRegistry }

type DetachableInternals = { detach(): void }

// dnd-kit 把传感器成员在类型上声明为 private，但运行时是普通原型方法；
// 通过受控断言触达基类的取消管线，只新增公开能力，不改变基类的正常拖动流程。
// detach 在实例上包一层：正常结束、Esc 取消、强制终止都会从注册表注销自己。
//
// 强制终止走传感器自己的 handleCancel（detach + onCancel），而不是只 detach：
// 同一挂载内失效（被拖目录消失、移动端退出管理模式）时，DndContext 内部 store 的
// activeRef 必须由 onCancel 复位，否则新拖动会被当作"另一个传感器正在实例化"而拒绝。
export class VaultPointerSensor extends PointerSensor {
  constructor(props: PointerSensorProps) {
    super(props)
    const { registry } = props.options as PointerSensorOptions & RegistryOption
    registry?.register(this)
    const internals = this as unknown as DetachableInternals
    const rawDetach = internals.detach.bind(this)
    internals.detach = () => {
      rawDetach()
      registry?.unregister(this)
    }
  }

  forceDetach() {
    ;(this as unknown as { handleCancel(): void }).handleCancel()
  }
}

export class VaultKeyboardSensor extends KeyboardSensor {
  private closed = false

  constructor(props: KeyboardSensorProps) {
    super(props)
    const { registry } = props.options as KeyboardSensorOptions & RegistryOption
    registry?.register(this)
    // 基类把 keydown 的 document 监听推迟到下一个宏任务注册（attach 内的 setTimeout，
    // 回调里才调用 listeners.add）。若在注册完成前就被强制终止，原回调仍会补挂监听
    // 形成泄漏；这里包一层 add：实例关闭后拒绝任何迟到的注册。
    const internals = this as unknown as DetachableInternals & {
      listeners: { add(eventName: string, handler: (event: Event) => void): void }
    }
    const addListener = internals.listeners.add.bind(internals.listeners)
    internals.listeners.add = (eventName, handler) => {
      if (!this.closed) addListener(eventName, handler)
    }
    const rawDetach = internals.detach.bind(this)
    internals.detach = () => {
      this.closed = true
      rawDetach()
      registry?.unregister(this)
    }
  }

  forceDetach() {
    // handleCancel 需要事件对象（内部调用 preventDefault），传入最小桩。
    ;(this as unknown as { handleCancel(event: { preventDefault(): void }): void }).handleCancel({ preventDefault() {} })
  }
}

const folderSortScreenReaderInstructions: ScreenReaderInstructions = {
  draggable: "按空格键或回车键开始拖动文件夹，用上下方向键调整位置，再按一次空格键或回车键确认，按 Esc 键取消",
}
const folderSortAnnouncements: Announcements = {
  onDragStart({ active }) {
    return `已选中文件夹 ${String(active.id)}，开始调整顺序`
  },
  onDragOver({ active, over }) {
    return over && active.id !== over.id ? `文件夹 ${String(active.id)} 当前位于 ${String(over.id)} 的位置` : undefined
  },
  onDragEnd({ active, over }) {
    return over && active.id !== over.id
      ? `已将文件夹 ${String(active.id)} 移动到 ${String(over.id)} 的位置`
      : `文件夹 ${String(active.id)} 的位置没有改变`
  },
  onDragCancel({ active }) {
    return `已取消移动文件夹 ${String(active.id)}`
  },
}

// 只在落点有效且顺序变化时产出新列表，否则不落盘。
function resolveFolderDragOrder(paths: string[], event: DragEndEvent) {
  const { active, over } = event
  if (!over) return null
  return reorderTopLevelPaths(paths, String(active.id), String(over.id))
}

// accessibility.restoreFocus 默认开启，拖动结束后焦点会回到发起拖动的手柄上。
const folderSortAccessibility = {
  announcements: folderSortAnnouncements,
  screenReaderInstructions: folderSortScreenReaderInstructions,
}

type FolderDragSession = {
  // 被拖目录：目录从列表中消失时按它判断会话是否还有效。
  activeId: string
  // 失效标记：一旦置 true 这个会话对象永久失效，切回同一库或开始新拖动都不会复活它。
  dead: boolean
  // 发起拖动时的库身份。
  key: string
}

export type FolderSortDndContextProps = {
  children: ReactNode
  // 移动端的 DndContext 常驻（管理模式只切换行渲染），退出管理模式时用 enabled=false
  // 让进行中的拖动永久失效；桌面只在管理模式渲染本组件，卸载本身就触发失效。
  enabled?: boolean
  folderOrderKey: string
  onCommit: (nextOrder: string[]) => void
  sortableFolderPaths: string[]
}

// 桌面与移动端共用的目录排序拖动上下文。调用方必须以 folderOrderKey 为 key：
// 切库即整体重挂载，旧实例的会话与传感器在卸载清理中被永久终止。
export function FolderSortDndContext({
  children,
  enabled = true,
  folderOrderKey,
  onCommit,
  sortableFolderPaths,
}: FolderSortDndContextProps) {
  // 每次挂载一套全新的注册表与会话 ref：旧挂载周期里被终止的传感器和会话不可能被新挂载复活。
  const [registry] = useState(createSensorRegistry)
  const sensors = useSensors(
    useSensor(VaultPointerSensor, { activationConstraint: { distance: 6 }, registry }),
    useSensor(VaultKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, registry }),
  )
  const sessionRef = useRef<FolderDragSession | null>(null)
  // 最新 props 镜像：旧传感器泄漏回调触发时，提交前用当前值做最终校验。
  const latestRef = useRef({ folderOrderKey, onCommit, sortableFolderPaths })
  latestRef.current = { folderOrderKey, onCommit, sortableFolderPaths }

  // 永久失效当前会话并主动终止所有已激活传感器（摘掉 document 监听，包括键盘
  // 传感器尚未注册的迟到 keydown），旧监听不再吞掉或干扰新拖动和正常键盘操作。
  const invalidateSession = useCallback(() => {
    const session = sessionRef.current
    if (session) session.dead = true
    sessionRef.current = null
    registry.forceDetachAll()
  }, [registry])

  // 卸载即失效：切库（key 重挂载）、桌面退出管理模式、布局切换都经过这里。
  useEffect(() => invalidateSession, [invalidateSession])

  // 移动端退出管理模式：组件不卸载，靠 enabled 驱动失效。
  useEffect(() => {
    if (!enabled) invalidateSession()
  }, [enabled, invalidateSession])

  // 被拖目录从列表中消失（被删除、刷新后目录结构变化）：立即失效并终止传感器。
  useEffect(() => {
    const session = sessionRef.current
    if (session && !sortableFolderPaths.includes(session.activeId)) invalidateSession()
  }, [sortableFolderPaths, invalidateSession])

  const handleDragStart = (event: DragStartEvent) => {
    sessionRef.current = { activeId: String(event.active.id), dead: false, key: folderOrderKey }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const session = sessionRef.current
    sessionRef.current = null
    // 校验的是本次拖动自己发起时创建的会话对象，不是共享 ref 的最新值：
    // 失效后的旧会话 dead=true，永远不会因为切回同一库或新拖动开始而重新通过。
    if (!session || session.dead) return
    const latest = latestRef.current
    if (session.key !== latest.folderOrderKey) return
    const nextOrder = resolveFolderDragOrder(latest.sortableFolderPaths, event)
    if (nextOrder) latest.onCommit(nextOrder)
  }

  // 正常确认（end）与取消（cancel）都会清理本次会话；cancel 只是不产生提交。
  const handleDragCancel = () => {
    sessionRef.current = null
  }

  return (
    <DndContext
      accessibility={folderSortAccessibility}
      collisionDetection={closestCenter}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      {children}
    </DndContext>
  )
}
