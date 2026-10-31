import { ref } from 'vue'
import type { AuthoredManual } from './types'

/** 模块自建的 localStorage 键，resetModule 时清空 */
export const AUTHORED_STORAGE_KEY = 'lingyue-manuals-authored-v1'

function readStorage(): AuthoredManual[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(AUTHORED_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is AuthoredManual =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as AuthoredManual).id === 'string' &&
        typeof (item as AuthoredManual).title === 'string',
    )
  } catch {
    return []
  }
}

function writeStorage(list: AuthoredManual[]) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(AUTHORED_STORAGE_KEY, JSON.stringify(list))
}

const authored = ref<AuthoredManual[]>(readStorage())
const resetEpoch = ref(0)

export function useAuthoredStore() {
  function upsert(doc: AuthoredManual) {
    const index = authored.value.findIndex((item) => item.id === doc.id)
    if (index >= 0) {
      authored.value.splice(index, 1, doc)
    } else {
      authored.value.unshift(doc)
    }
    writeStorage(authored.value)
  }

  function remove(id: string) {
    authored.value = authored.value.filter((item) => item.id !== id)
    writeStorage(authored.value)
  }

  function getById(id: string): AuthoredManual | undefined {
    return authored.value.find((item) => item.id === id)
  }

  function clearAll() {
    authored.value = []
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(AUTHORED_STORAGE_KEY)
    }
    resetEpoch.value += 1
  }

  return { authored, resetEpoch, upsert, remove, getById, clearAll }
}
