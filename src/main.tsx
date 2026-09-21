import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// 这里刻意不使用 <StrictMode>：开发模式下它会重复挂载 effect，
// 导致 pdf.js 的 canvas 和epub.js 的 iframe 各自渲染两份。
createRoot(document.getElementById('root')!).render(<App />);
