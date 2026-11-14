import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { NewsDemo } from './pages/demos/NewsDemo';
import { ShopDemo } from './pages/demos/ShopDemo';
import { FormDemo } from './pages/demos/FormDemo';
import { DenseDemo } from './pages/demos/DenseDemo';
import { CanvasDemo } from './pages/demos/CanvasDemo';
import { Study } from './pages/Study';
import { Results } from './pages/Results';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="demo/news" element={<NewsDemo />} />
        <Route path="demo/shop" element={<ShopDemo />} />
        <Route path="demo/form" element={<FormDemo />} />
        <Route path="demo/dense" element={<DenseDemo />} />
        <Route path="demo/canvas" element={<CanvasDemo />} />
        <Route path="study" element={<Study />} />
        <Route path="results" element={<Results />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
