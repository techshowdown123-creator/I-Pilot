import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CalibratePage } from './pages/CalibratePage';
import { GamePage } from './pages/GamePage';
import { TunePage } from './pages/TunePage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CalibratePage />} />
        <Route path="game" element={<GamePage />} />
        <Route path="tune" element={<TunePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
