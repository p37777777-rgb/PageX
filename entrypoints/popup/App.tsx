import reactLogo from '@/assets/react.svg';
import wxtLogo from '/wxt.svg';
import './App.css';
import { useAppStore, selectCount } from './store';

function App() {
  // 使用 zustand store
  // 方法1: 获取整个 store
  // const { count, increment, decrement, reset } = useAppStore();

  // 方法2: 使用选择器（推荐，性能更好）
  const count = useAppStore(selectCount);
  const increment = useAppStore((state) => state.increment);
  const decrement = useAppStore((state) => state.decrement);
  const reset = useAppStore((state) => state.reset);

  const user = useAppStore((state) => state.user);
  const setUser = useAppStore((state) => state.setUser);
  const toggleTheme = useAppStore((state) => state.toggleTheme);

  return (
    <>
      <div>
        <a href="https://wxt.dev" target="_blank">
          <img src={wxtLogo} className="logo" alt="WXT logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>WXT + React + Zustand</h1>

      {user && (
        <div className="user-info">
          <p>欢迎, {user.name}!</p>
          <p>主题: {user.theme}</p>
          <button onClick={toggleTheme}>切换主题</button>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button onClick={decrement}>-</button>
          <button onClick={increment}>+</button>
          <button onClick={reset}>重置</button>
        </div>
        <p>count is {count}</p>

        {!user && (
          <button onClick={() => setUser('用户')}>设置用户</button>
        )}

        <p>
          使用 Zustand 进行状态管理，数据会持久化到 localStorage
        </p>
      </div>
      <p className="read-the-docs">
        Click on the WXT and React logos to learn more
      </p>
    </>
  );
}

export default App;
