import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css"; 
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { BrowserRouter as Router } from 'react-router-dom';
import { LanguageProvider } from './contexts/LanguageContext';
import { AuthProvider } from './contexts/AuthContext';

// Desabilitar todos os logs de console em produção
if (import.meta.env?.PROD) {
  const noop = () => {};
  ['log', 'debug', 'info', 'warn', 'error'].forEach((method) => {
    if (typeof console[method] === 'function') {
      console[method] = noop;
    }
  });
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <Router>
      <AuthProvider>
        <LanguageProvider>
          <App />
        </LanguageProvider>
      </AuthProvider>
    </Router>
  </ErrorBoundary>
);
