import { useState } from 'react';
import Library from './components/Library';
import ReaderView from './components/ReaderView';
import type { BookRecord } from './reader/storage';

export default function App() {
  const [active, setActive] = useState<BookRecord | null>(null);

  return active ? (
    <ReaderView book={active} onClose={() => setActive(null)} />
  ) : (
    <Library onOpen={setActive} />
  );
}
