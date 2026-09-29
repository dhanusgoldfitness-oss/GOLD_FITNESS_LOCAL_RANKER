import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth';
import { PageLoading, ToastProvider } from './components/ui';
import Layout, { ThemeInit } from './components/Layout';
import { Forgot, Login, Register, Reset } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import GoogleBusiness from './pages/GoogleBusiness';
import Audit from './pages/Audit';
import Optimization from './pages/Optimization';
import Reviews from './pages/Reviews';
import Posts from './pages/Posts';
import Photos from './pages/Photos';
import Plan from './pages/Plan';
import SettingsPage from './pages/Settings';
import Keywords from './pages/Keywords';
import RankChecker from './pages/RankChecker';
import Competitors from './pages/Competitors';
import Performance from './pages/Performance';
import Reports from './pages/Reports';
import AiImages from './pages/AiImages';
import Leads from './pages/Leads';
import Automations from './pages/Automations';
import WhatsApp from './pages/WhatsApp';
import Admin from './pages/Admin';
import ModuleStatus from './pages/ModuleStatus';
import { Categories, Customers, Expenses, Services } from './pages/Crud';
import { BillingSettings, Invoices, TallyExport } from './pages/Billing';

function Protected() {
  const { session, loading } = useAuth();
  if (loading) return <PageLoading />;
  return session ? <Layout /> : <Navigate to="/login" replace />;
}

// Modules whose providers are not built/connected yet: they show their real status from the API.
const pending: [string, string, string, string][] = [
  ['ai-mode', 'ai_mode', 'AI Mode', 'Conversational assistant for your local SEO.'],
  ['ai-video', 'ai_video', 'AI Video', 'Generate short promo videos.'],
  ['social', 'ai_video', 'Social Post', 'Connect social accounts and publish.'],
];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeInit />
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<Forgot />} />
            <Route path="/reset-password" element={<Reset />} />
            <Route element={<Protected />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/google-business" element={<GoogleBusiness />} />
              <Route path="/optimization" element={<Optimization />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/posts" element={<Posts />} />
              <Route path="/reviews" element={<Reviews />} />
              <Route path="/photos" element={<Photos />} />
              <Route path="/keywords" element={<Keywords />} />
              <Route path="/rank-checker" element={<RankChecker />} />
              <Route path="/competitors" element={<Competitors />} />
              <Route path="/performance" element={<Performance />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/ai-images" element={<AiImages />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/automations" element={<Automations />} />
              <Route path="/whatsapp" element={<WhatsApp />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/services" element={<Services />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/tally-export" element={<TallyExport />} />
              <Route path="/billing-settings" element={<BillingSettings />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin" element={<Admin />} />
              {pending.map(([path, key, title, desc]) => <Route key={path} path={`/${path}`} element={<ModuleStatus moduleKey={key} title={title} description={desc} />} />)}
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
