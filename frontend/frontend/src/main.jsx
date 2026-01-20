import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css"; 
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { BrowserRouter as Router } from 'react-router-dom';
import { LanguageProvider } from './contexts/LanguageContext';
import axios from 'axios';

// ============================================
// INJEÇÃO GLOBAL DO TOKEN NO BOOTSTRAP
// ============================================
// Garantir que o token seja injetado globalmente no Axios ANTES de qualquer requisição
// Isso resolve problemas de inconsistência onde alguns requests não recebem o token
const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
if (token) {
  axios.defaults.headers.common['Authorization'] = `Token ${token}`;
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <Router>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </Router>
  </ErrorBoundary>
);
