import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";

import MainLayout from "./components/MainLayout";
import NotificationToast from "./components/NotificationToast";
import Forgot from "./pages/Auth/Forgot";
import Login from "./pages/Auth/Login";
import Register from "./pages/Auth/Register";
import Reset from "./pages/Auth/Reset";
import { DiaryDetailPage } from "./pages/DiaryDetail";
import { DiaryPage } from "./pages/DiaryList";
import Home from "./pages/Home/Home";
import Landing from "./pages/Landing/Landing";
import Profile from "./pages/Profile/Profile";
import Setting from "./pages/Profile/Setting";
import User from "./pages/Profile/User";
import Voice from "./pages/Profile/Voice";
import { startNotificationPolling, stopNotificationPolling } from "./services/NotificationService";

function DiaryListRoute() {
  const navigate = useNavigate();
  return <DiaryPage onOpenDiaryDetail={(meetingId) => navigate(`/diary/${encodeURIComponent(meetingId)}`)} />;
}

function DiaryDetailRoute() {
  const { meetingId } = useParams();
  if (!meetingId) return <Navigate to="/diary" replace />;
  return <DiaryDetailPage meetingId={meetingId} />;
}

function App() {
  const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000";
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [isNotificationEnabled, setIsNotificationEnabled] = useState(true);

  const checkSession = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/auth/session`, { credentials: "include" });
      if (response.ok) {
        setIsAuthed(true);
        return;
      }
      if (response.status === 401) setIsAuthed(false);
    } catch {
      return;
    } finally {
      setIsAuthReady(true);
    }
  }, [apiBase]);

  useEffect(() => {
    let isCancelled = false;
    const onAuthChanged = () => {
      if (!isCancelled) checkSession().catch(() => {});
    };

    checkSession().catch(() => {});
    window.addEventListener("auth-changed", onAuthChanged);
    window.addEventListener("focus", onAuthChanged);

    return () => {
      isCancelled = true;
      window.removeEventListener("auth-changed", onAuthChanged);
      window.removeEventListener("focus", onAuthChanged);
    };
  }, [checkSession]);

  useEffect(() => {
    if (!isAuthed || !isNotificationEnabled) {
      stopNotificationPolling();
      return;
    }

    startNotificationPolling(apiBase, (message, type) => {
      setNotification({ message, type });
    });

    return () => stopNotificationPolling();
  }, [apiBase, isAuthed, isNotificationEnabled]);

  useEffect(() => {
    if (!isAuthed) return;

    const loadSettings = async () => {
      try {
        const response = await fetch(`${apiBase}/users/me/settings`, { credentials: "include" });
        if (!response.ok) return;
        const data = await response.json();
        setIsNotificationEnabled(data.notification ?? true);
      } catch {
        return;
      }
    };

    loadSettings().catch(() => {});
  }, [apiBase, isAuthed]);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ notification?: boolean }>;
      if (typeof customEvent.detail?.notification === "boolean") {
        setIsNotificationEnabled(customEvent.detail.notification);
      }
    };

    window.addEventListener("settings-changed", handler);
    return () => window.removeEventListener("settings-changed", handler);
  }, []);

  if (!isAuthReady) return null;

  const requireAuth = (element: ReactElement) => (isAuthed ? element : <Navigate to="/login" replace />);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={isAuthed ? <Navigate to="/home" replace /> : <Landing />} />
        <Route path="/home" element={requireAuth(<MainLayout><Home /></MainLayout>)} />
        <Route path="/profile" element={requireAuth(<MainLayout><Profile /></MainLayout>)} />
        <Route path="/profile/user" element={requireAuth(<MainLayout><User /></MainLayout>)} />
        <Route path="/profile/voice" element={requireAuth(<MainLayout><Voice /></MainLayout>)} />
        <Route path="/profile/settings" element={requireAuth(<MainLayout><Setting /></MainLayout>)} />
        <Route path="/onboarding/google-voice" element={requireAuth(<Register mode="google-onboarding" />)} />
        <Route path="/diary" element={requireAuth(<DiaryListRoute />)} />
        <Route path="/diary/:meetingId" element={requireAuth(<DiaryDetailRoute />)} />
        <Route path="/login" element={isAuthed ? <Navigate to="/home" replace /> : <Login />} />
        <Route path="/password/forgot" element={<Forgot />} />
        <Route path="/password/reset" element={<Reset />} />
        <Route path="/register" element={isAuthed ? <Navigate to="/home" replace /> : <Register mode="register" />} />
      </Routes>

      {notification ? (
        <NotificationToast
          message={notification.message}
          type={notification.type}
          onClose={() => setNotification(null)}
        />
      ) : null}
    </BrowserRouter>
  );
}

export default App;
