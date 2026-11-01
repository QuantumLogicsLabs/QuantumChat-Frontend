import { Navigate, Route, Routes } from 'react-router-dom';
import JoinInvite from './components/JoinInvite.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import ScreenTimeTracker from './components/ScreenTimeTracker.jsx';
import { ToastProvider } from './components/ToastProvider.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ChatLockProvider } from './context/ChatLockContext.jsx';
import { NotificationSettingsProvider } from './context/NotificationSettingsContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { VaultProvider } from './context/VaultContext.jsx';
import Activity from './pages/Activity.jsx';
import BirthdayCalendar from './pages/BirthdayCalendar.jsx';
import Chat from './pages/Chat.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import Landing from './pages/Landing.jsx';
import LinkDevice from './pages/LinkDevice.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import VerifyEmail from './pages/VerifyEmail.jsx';

function ProtectedChat() {
  return (
    <ProtectedRoute>
      <Chat />
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ThemeProvider>
       <AuthProvider>
          <VaultProvider>
             <ChatLockProvider>
            <NotificationSettingsProvider>
              <ScreenTimeTracker />
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/register" element={<Register />} />
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/verify-email" element={<VerifyEmail />} />
                <Route path="/link-device" element={<LinkDevice />} />
                <Route
                  path="/join/:code"
                  element={
                    <ProtectedRoute>
                      <JoinInvite />
                    </ProtectedRoute>
                  }
                />
                <Route path="/chat" element={<ProtectedChat />} />
                <Route path="/chat/activity" element={<ProtectedRoute><Activity /></ProtectedRoute>} />
                <Route path="/chat/birthdays" element={<ProtectedRoute><BirthdayCalendar /></ProtectedRoute>} />
                <Route path="/chat/settings" element={<ProtectedChat />} />
                <Route path="/chat/settings/:tab" element={<ProtectedChat />} />
                <Route path="/chat/g/:groupId" element={<ProtectedChat />} />
                <Route path="/chat/live/:streamId" element={<ProtectedChat />} />
                <Route path="/chat/:peerId" element={<ProtectedChat />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </NotificationSettingsProvider>
            </ChatLockProvider>
          </VaultProvider>
        </AuthProvider>
      </ThemeProvider>
    </ToastProvider>
  );
}
