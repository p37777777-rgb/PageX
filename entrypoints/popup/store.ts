import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// 定义状态类型
interface AppState {
  count: number;
  user: {
    name: string;
    theme: 'light' | 'dark';
  } | null;

  // Actions
  increment: () => void;
  decrement: () => void;
  reset: () => void;
  setUser: (name: string) => void;
  toggleTheme: () => void;
  clearUser: () => void;
}

// 创建 store
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // 初始状态
      count: 0,
      user: null,

      // Actions
      increment: () => set((state) => ({ count: state.count + 1 })),
      decrement: () => set((state) => ({ count: state.count - 1 })),
      reset: () => set({ count: 0 }),

      setUser: (name: string) =>
        set((state) => ({
          user: { name, theme: state.user?.theme || 'light' },
        })),

      toggleTheme: () =>
        set((state) => ({
          user: state.user
            ? { ...state.user, theme: state.user.theme === 'light' ? 'dark' : 'light' }
            : null,
        })),

      clearUser: () => set({ user: null }),
    }),
    {
      name: 'app-storage', // localStorage 中的 key
      storage: createJSONStorage(() => localStorage), // 使用 localStorage
    }
  )
);

// 导出选择器（可选，用于性能优化）
export const selectCount = (state: AppState) => state.count;
export const selectUser = (state: AppState) => state.user;
export const selectTheme = (state: AppState) => state.user?.theme || 'light';
