import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowLeft,
  HelpCircle,
  Info,
  Menu,
  MessageSquare,
  Mic,
  Phone,
  Pin,
  Plus,
  Search,
  Send,
  Settings2,
  Smile,
  Square,
  Users,
  Video,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import client, { muteChat, unmuteChat } from "../api/client.js";
import ChatShell from "../components/chat/ChatShell.jsx";
import ConversationPane from "../components/chat/ConversationPane.jsx";
import InfoPanel from "../components/chat/InfoPanel.jsx";
import ChatEmptyState from "../components/chat/ChatEmptyState.jsx";
import ComposerPlusSheet from "../components/chat/ComposerPlusSheet.jsx";
import MessageActionSheet from "../components/chat/MessageActionSheet.jsx";
import SwipeableMessage from "../components/chat/SwipeableMessage.jsx";
import {
  chatPathForSelection,
  selectionFromParams,
} from "../utils/chatRoutes.js";
import { streamQuantumAI } from "../api/aiClient.js";
import { connectSocket, getSocket } from "../api/socket.js";
import {
  sealMessage,
  unsealMessage,
  sealBytes,
  secretboxSeal,
  pickRandom,
} from "../crypto/keys.js";
import {
  formatKeyFile,
  downloadKeyFile,
  parseKeyFile,
} from "../crypto/keyFile.js";
import {
  getCurrentKeySet,
  findSecretKeyForPublicKey,
} from "../crypto/keyStorage.js";
import {
  normalizeAttachment,
  pickRecorderMimeType,
  attachmentIdOf,
} from "../crypto/voiceCache.js";
import { playReceiveSound, playSendSound } from "../utils/sounds.js";
import { enablePushNotifications } from "../utils/pushNotifications.js";
import {
  conversationKeyForGroup,
  conversationKeyForUser,
  getConversationActivity,
  isUnreadConversation,
  markConversationRead,
  setConversationActivity,
} from "../utils/readState.js";
import {
  encodePoll,
  encodeEvent,
  encodeAnnouncement,
  encodeGroupFile,
  extractMentions,
  isGroupAdmin,
} from "../utils/groupPayload.js";
import CreateGroupModal from "../components/CreateGroupModal.jsx";
import GroupSettingsModal from "../components/GroupSettingsModal.jsx";
import UserProfileModal from "../components/UserProfileModal.jsx";
import UserAvatar from "../components/UserAvatar.jsx";
import EmojiPicker from "../components/EmojiPicker.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import SettingsModal from "../components/SettingsModal.jsx";
import DateSeparator from "../components/DateSeparator.jsx";
import MessageSearch from "../components/MessageSearch.jsx";
import DragDropOverlay from "../components/DragDropOverlay.jsx";
import TypingIndicator from "../components/TypingIndicator.jsx";
import ForwardModal from "../components/ForwardModal.jsx";
import CameraCapture from "../components/CameraCapture.jsx";
import ImageLightbox from "../components/ImageLightbox.jsx";
import AIAssistantPanel from "../components/AIAssistantPanel.jsx";
import CallOverlay from "../components/CallOverlay.jsx";
import MeetingOverlay from "../components/MeetingOverlay.jsx";
import useWebRTCCall from "../hooks/useWebRTCCall.js";
import useMeetingCall from "../hooks/useMeetingCall.js";
import { useToast } from "../components/ToastProvider.jsx";
import {
  getHiddenChatIds,
  hideChat,
  unhideChat,
} from "../utils/hiddenChats.js";
import {
  getMutedChatKeys,
  getArchivedChatKeys,
  toggleMuteChat,
  toggleArchiveChat,
  isChatMuted,
  getInfoPanelOpen,
  setInfoPanelOpen,
  getLastQuickReaction,
  setLastQuickReaction,
} from "../utils/chatPrefs.js";
import {
  deleteMessageForMe,
  getDeletedForMeIds,
  getPinnedIds,
  getStarredIds,
  togglePinnedMessage,
  toggleStarredMessage,
} from "../utils/messageExtras.js";
import { useNotificationSettings } from "../context/NotificationSettingsContext.jsx";
import {
  shouldNotify,
  playNotificationSound,
  buildNotificationText,
  showNotificationPopup,
} from "../utils/notificationDispatch.js";
import { updateFaviconBadge } from "../utils/faviconBadge.js";

const MAX_VOICE_SECONDS = 60;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

function isRecentlyActive(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < ACTIVE_WINDOW_MS;
}

function formatLastSeen(iso) {
  if (!iso) return "never logged in";
  if (isRecentlyActive(iso)) return "online";
  return `last seen ${new Date(iso).toLocaleString()}`;
}

function formatVoiceTimer(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function memberId(m) {
  return String(m?.id || m?._id || m);
}

// Check if two ISO dates fall on the same calendar day
function isSameDay(d1, d2) {
  const a = new Date(d1);
  const b = new Date(d2);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function Chat() {
  const {
    user,
    logout,
    regenerateKeys,
    importKeys,
    hasLocalKeyring,
    keyringNeedsResync,
    keyringSync,
    updateSessionUser,
  } = useAuth();
  const { showToast } = useToast();
  const { settings: notifSettings } = useNotificationSettings();
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const isSettingsRoute = location.pathname.startsWith("/chat/settings");
  const settingsTab = params.tab || "profile";

  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(null); // { type: 'dm'|'group', id, ... }
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [importError, setImportError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [sendingVoice, setSendingVoice] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [hiddenChatIds, setHiddenChatIds] = useState(() =>
    getHiddenChatIds(user?.id),
  );
  const [mutedKeys, setMutedKeys] = useState(() => getMutedChatKeys(user?.id));
  const [archivedKeys, setArchivedKeys] = useState(() =>
    getArchivedChatKeys(user?.id),
  );
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [activityTick, setActivityTick] = useState(0);
  const [friendCandidates, setFriendCandidates] = useState([]);
  const [friendCandidatesLoading, setFriendCandidatesLoading] = useState(false);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [myFriends, setMyFriends] = useState([]);
  const [myFriendsLoading, setMyFriendsLoading] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [contactLookupResult, setContactLookupResult] = useState(null);
  const [contactLookupLoading, setContactLookupLoading] = useState(false);
  const [contactLookupError, setContactLookupError] = useState("");
  // Custom UI feature states
  const [searchOpen, setSearchOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [groupTypingNames, setGroupTypingNames] = useState([]);
  const [onlineUserIds, setOnlineUserIds] = useState(() => new Set());
  const [deletedForMeIds, setDeletedForMeIds] = useState(() =>
    getDeletedForMeIds(user?.id),
  );
  const [starredIds, setStarredIds] = useState(() => getStarredIds(user?.id));
  const [pinnedIds, setPinnedIds] = useState([]);
  const [forwardMessage, setForwardMessage] = useState(null);
  const [forwardBusy, setForwardBusy] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [extrasTick, setExtrasTick] = useState(0);
  const [uploads, setUploads] = useState([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [disappearSeconds, setDisappearSeconds] = useState(0);
  const [allowForward, setAllowForward] = useState(true);
  const [forwardUntilSeconds, setForwardUntilSeconds] = useState(0);
  const [gallery, setGallery] = useState(null);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [profileUserId, setProfileUserId] = useState(null);
  const [groupComposerMenu, setGroupComposerMenu] = useState(null);
  const [pollDraft, setPollDraft] = useState(null);
  const [eventDraft, setEventDraft] = useState(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [pendingAnnouncement, setPendingAnnouncement] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [emailBannerDismissed, setEmailBannerDismissed] = useState(false);
  const [composerHelpOpen, setComposerHelpOpen] = useState(false);
  const [composerPlusOpen, setComposerPlusOpen] = useState(false);
  const [infoPanelOpen, setInfoPanelOpenState] = useState(() =>
    getInfoPanelOpen(),
  );
  const [actionSheetMessage, setActionSheetMessage] = useState(null);
  const [callMinimized, setCallMinimized] = useState(false);
  const [isMobileShell, setIsMobileShell] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 768px)").matches
      : false,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const sync = () => setIsMobileShell(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    const cores = navigator.hardwareConcurrency || 4;
    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      cores <= 4;
    document.body.classList.toggle("low-fx", reduced);
    return () => document.body.classList.remove("low-fx");
  }, []);

  const messageListRef = useRef(null);
  const bottomRef = useRef(null);
  const typingPeerTimeoutRef = useRef(null);
  const loadingOlderRef = useRef(false);
  const oldestCreatedAtRef = useRef(null);
  const loadOlderMessagesRef = useRef(null);
  const fileInputRef = useRef(null);
  const keyFileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const selectedRef = useRef(null);
  const messagesRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordChunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const recordStartedAtRef = useRef(0);
  const notifiedCallIdRef = useRef(null);
  const dragCountRef = useRef(0);
  const typingTimeoutRef = useRef(null);
  const imageSrcMapRef = useRef(new Map());
  const aiAbortRef = useRef(null);
  const usersRef = useRef([]);
  const groupsRef = useRef([]);
  const storiesRailRef = useRef(null);
  selectedRef.current = selected;
  messagesRef.current = messages;
  usersRef.current = users;
  groupsRef.current = groups;

  const webrtc = useWebRTCCall({
    userId: user?.id,
    resolvePeerPublicKeys: async (peerId) => {
      const peer =
        (selectedRef.current?.type === "dm" &&
          String(selectedRef.current.id) === String(peerId) &&
          selectedRef.current.peer) ||
        usersRef.current.find((u) => String(u.id) === String(peerId));
      return peer?.publicKeys || [];
    },
onMissed: (call) => {
      showToast("Call ended or declined", "info");
      if (notifSettings?.callNotifications?.missedCallReminders === false) return;
      if (!shouldNotify(notifSettings, { kind: "call" })) return;
      const caller =
        users.find((u) => String(u.id) === String(call?.peerId))?.displayName ||
        users.find((u) => String(u.id) === String(call?.peerId))?.username ||
        "Someone";
      showNotificationPopup(
        { title: caller, body: "Missed call" },
        notifSettings,
        () => {},
      );
    },
    onEnd: async (info) => {
      try {
        if (info.role !== "caller") return;
        const peerId = String(info.peerId);
        const peer = usersRef.current.find((u) => String(u.id) === peerId);
        const myKey = pickRandom(getCurrentKeySet(user.id));
        const recipientKeys = (peer?.publicKeys || []).filter(Boolean);
        if (!myKey?.publicKey || recipientKeys.length === 0) return;
        const payload = JSON.stringify({
          __type: "call",
          callId: info.callId,
          video: info.video,
          role: info.role,
          answered: !!info.answered,
          durationSeconds: Number(info.durationSeconds) || 0,
          reason: info.reason || null,
          endedAt: new Date().toISOString(),
        });
        const forRecipient = sealMessage(payload, pickRandom(recipientKeys));
        const forSender = sealMessage(payload, myKey.publicKey);
        const { data } = await client.post("/messages", {
          to: peerId,
          forRecipient,
          forSender,
        });
        recordActivityFromMessage(data.data);
        setMessages((prev) => {
          const id = String(data.data.id || data.data._id);
          if (prev.some((m) => String(m.id || m._id) === id)) return prev;
          return [...prev, decorate(data.data)];
        });
        playSendSound();
        setTimeout(() => scrollToBottom("smooth"), 50);
      } catch (err) {
        /* ignore send errors */
      }
    },
  });
  useEffect(() => {
    const call = webrtc.call;
    if (!call || call.role !== "callee" || call.status !== "incoming") return;
    if (notifiedCallIdRef.current === call.callId) return;
    notifiedCallIdRef.current = call.callId;

    const enabled = call.video
      ? notifSettings?.callNotifications?.videoCallEnabled !== false
      : notifSettings?.callNotifications?.voiceCallEnabled !== false;
    if (!enabled || !shouldNotify(notifSettings, { kind: "call" })) return;

    const caller =
      users.find((u) => String(u.id) === String(call.peerId))?.displayName ||
      users.find((u) => String(u.id) === String(call.peerId))?.username ||
      "Someone";

    playNotificationSound(notifSettings);
    showNotificationPopup(
      { title: caller, body: call.video ? "Incoming video call" : "Incoming voice call" },
      notifSettings,
      () => {
        // Clicking the popup just focuses the tab — CallOverlay is already
        // rendered globally whenever webrtc.call is set, so no navigation needed.
      },
    );

    if (notifSettings?.callNotifications?.vibrateOnCall && navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
  }, [webrtc.call, users, notifSettings]);

  const meetingCall = useMeetingCall({
    userId: user?.id,
    resolveGroupMembers: async (groupId) => {
      const group =
        (selectedRef.current?.type === "group" &&
          String(selectedRef.current.id) === String(groupId) &&
          selectedRef.current.group) ||
        groupsRef.current.find((g) => String(g.id) === String(groupId));
      if (!group) return null;
      return { groupName: group.name, members: group.members || [] };
    },
    onEnd: async (info) => {
      try {
        if (info.role !== "host") return;
        const group = groupsRef.current.find(
          (g) => String(g.id) === String(info.groupId),
        );
        if (!group) return;
        const payload = JSON.stringify({
          __type: "meeting",
          meetingId: info.meetingId,
          video: info.video,
          participantCount: info.participantCount,
          durationSeconds: Number(info.durationSeconds) || 0,
          reason: info.reason || null,
          endedAt: new Date().toISOString(),
        });
        const isPublic = group.visibility === "public";
        const body = { kind: "text" };
        if (isPublic) {
          body.content = payload;
        } else {
          body.envelopes = sealGroupEnvelopes(payload, group);
        }
        const { data } = await client.post(
          `/groups/${group.id}/messages`,
          body,
        );
        recordActivityFromMessage(data.data);
        setMessages((prev) => {
          const id = String(data.data.id || data.data._id);
          if (prev.some((m) => String(m.id || m._id) === id)) return prev;
          return [...prev, decorate(data.data)];
        });
        playSendSound();
        setTimeout(() => scrollToBottom("smooth"), 50);
      } catch (err) {
        /* ignore send errors */
      }
    },
  });

  const bumpActivity = useCallback(() => setActivityTick((n) => n + 1), []);

  const scrollToBottom = useCallback((behavior = "smooth") => {
    if (messageListRef.current) {
      const el = messageListRef.current;
      el.scrollTo({
        top: el.scrollHeight,
        behavior,
      });
    }
    setHasUnread(false);
  }, []);

  const handleScroll = useCallback(() => {
    if (!messageListRef.current) return;
    const el = messageListRef.current;
    const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 150;
    if (!isUp) {
      setHasUnread(false);
    }
    if (el.scrollTop < 80 && hasMoreMessages && !loadingOlderRef.current) {
      loadOlderMessagesRef.current?.();
    }
  }, [hasMoreMessages]);

  const resolveMySecretKey = useCallback(
    (targetPublicKeyHex) =>
      findSecretKeyForPublicKey(user.id, targetPublicKeyHex),
    [user],
  );

  const decorate = useCallback(
    (raw) => {
      const isMine = String(raw.from) === String(user.id);
      let text = null;
      let hasEnvelope = false;

      if (
        raw.group &&
        typeof raw.content === "string" &&
        raw.content.length > 0
      ) {
        text = raw.content;
        hasEnvelope = true;
      } else if (raw.group && Array.isArray(raw.envelopes)) {
        const mine = raw.envelopes.find(
          (e) => String(e.user) === String(user.id),
        );
        hasEnvelope = Boolean(mine?.targetPublicKey);
        if (mine?.targetPublicKey) {
          const mySecretKey = resolveMySecretKey(mine.targetPublicKey);
          text = mySecretKey ? unsealMessage(mine, mySecretKey) : null;
        }
      } else {
        const envelope = isMine ? raw.forSender : raw.forRecipient;
        hasEnvelope = Boolean(envelope?.targetPublicKey);
        if (envelope?.targetPublicKey) {
          const mySecretKey = resolveMySecretKey(envelope.targetPublicKey);
          text = mySecretKey ? unsealMessage(envelope, mySecretKey) : null;
        }
      }

      const reactions = (raw.reactions || []).map((r) => {
        if (r.emoji && !r.forRecipient && !r.forSender) {
          return { ...r, user: String(r.user), emoji: r.emoji };
        }
        const mineReaction = String(r.user) === String(user.id);
        const reactionEnvelope = mineReaction ? r.forSender : r.forRecipient;
        if (!reactionEnvelope?.targetPublicKey) {
          return { ...r, user: String(r.user), emoji: null };
        }
        const sk = resolveMySecretKey(reactionEnvelope.targetPublicKey);
        return {
          ...r,
          user: String(r.user),
          emoji: sk ? unsealMessage(reactionEnvelope, sk) : null,
        };
      });

      return {
        ...raw,
        id: raw.id || raw._id,
        attachment: normalizeAttachment(raw.attachment),
        text: hasEnvelope ? text : null,
        reactions,
        replyTo: raw.replyTo
          ? (() => {
              const parent = raw.replyTo;
              const parentMine = String(parent.from) === String(user.id);
              let parentText = null;
              if (
                parent.group &&
                typeof parent.content === "string" &&
                parent.content.length > 0
              ) {
                parentText = parent.content;
              } else if (parent.group && Array.isArray(parent.envelopes)) {
                const mine = parent.envelopes.find(
                  (e) => String(e.user) === String(user.id),
                );
                if (mine?.targetPublicKey) {
                  const sk = resolveMySecretKey(mine.targetPublicKey);
                  parentText = sk ? unsealMessage(mine, sk) : null;
                }
              } else {
                const env = parentMine ? parent.forSender : parent.forRecipient;
                if (env?.targetPublicKey) {
                  const sk = resolveMySecretKey(env.targetPublicKey);
                  parentText = sk ? unsealMessage(env, sk) : null;
                }
              }
              return {
                id: parent.id || parent._id,
                from: parent.from,
                text: parentText,
              };
            })()
          : null,
      };
    },
    [user, resolveMySecretKey],
  );

  const recordActivityFromMessage = useCallback(
    (raw) => {
      const at = raw.createdAt || new Date().toISOString();
      const from = raw.from;
      let key;
      if (raw.group) {
        key = conversationKeyForGroup(
          typeof raw.group === "object" ? raw.group.id || raw.group._id : raw.group,
        );
      } else {
        const otherId =
          String(raw.from) === String(user.id) ? raw.to : raw.from;
        if (!otherId) return;
        key = conversationKeyForUser(otherId);
      }
      const prev = getConversationActivity(user.id, key);
      if (
        prev?.at === at &&
        String(prev?.from || "") === String(from || "")
      ) {
        return;
      }
      setConversationActivity(user.id, key, { at, from });
      bumpActivity();
    },
    [user.id, bumpActivity],
  );

  const loadDirectory = useCallback(() => {
    if (!hasLocalKeyring) return;
    setLoadingUsers(true);

    const usersReq = client
      .get("/users")
      .then((res) => setUsers(res.data.data || []))
      .catch((err) =>
        showToast(err.response?.data?.error || "Failed to load users", "error"),
      );

    const groupsReq = client
      .get("/groups")
      .then((res) => setGroups(res.data.data || []))
      .catch(() => setGroups([]));

    Promise.allSettled([usersReq, groupsReq]).finally(() =>
      setLoadingUsers(false),
    );
  }, [hasLocalKeyring]);
  const loadFriendDiscover = useCallback(
    async (q) => {
      setFriendCandidatesLoading(true);
      try {
        const { data } = await client.get("/users/discover", {
          params: q?.trim() ? { q: q.trim() } : undefined,
        });
        setFriendCandidates(data.data || []);
      } catch (err) {
        showToast(
          err.response?.data?.error || "Failed to load people",
          "error",
        );
      } finally {
        setFriendCandidatesLoading(false);
      }
    },
    [showToast],
  );

  const loadFriendRequests = useCallback(async () => {
    try {
      const { data } = await client.get("/users/friend-requests");
      setIncomingRequests(data.data?.incoming || []);
    } catch {
      // non-fatal
    }
  }, []);

  const loadMyFriends = useCallback(async () => {
    setMyFriendsLoading(true);
    try {
      const { data } = await client.get("/users/friends");
      setMyFriends(data.data || []);
    } catch {
      setMyFriends([]);
    } finally {
      setMyFriendsLoading(false);
    }
  }, []);

  const handleLookupContact = useCallback(async () => {
    const raw = contactQuery.trim();
    setContactLookupError("");
    setContactLookupResult(null);
    if (!raw) {
      setContactLookupError("Enter an email or phone number");
      return;
    }

    const looksEmail = raw.includes("@");
    const looksPhone = /^[\d\s+\-().]{7,}$/.test(raw);
    if (!looksEmail && !looksPhone) {
      setContactLookupError("Enter a valid email or phone number");
      return;
    }

    setContactLookupLoading(true);
    try {
      const params = looksEmail
        ? { email: raw.toLowerCase() }
        : { phone: raw };
      const { data } = await client.get("/users/lookup", { params });
      if (!data.data) {
        setContactLookupError(
          looksEmail
            ? "No verified account found for that email"
            : "No account found for that phone number",
        );
        return;
      }
      setContactLookupResult(data.data);
    } catch (err) {
      setContactLookupError(
        err.response?.data?.error || "Lookup failed — try again",
      );
    } finally {
      setContactLookupLoading(false);
    }
  }, [contactQuery]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);
useEffect(() => {
  if (!user?.id || !Array.isArray(user.mutedChats)) return;
  const now = Date.now();
  const serverMutedKeys = user.mutedChats
    .filter((m) => m.expiresAt == null || new Date(m.expiresAt).getTime() > now)
    .map((m) => String(m.conversationKey));
  const serverSet = new Set(serverMutedKeys);

  // Server is the source of truth once user.mutedChats has loaded — fully replace,
  // not merge, so unmutes actually take effect (not just adds).
  setMutedKeys(serverMutedKeys);

  // Reconcile chatPrefs.js localStorage both ways too, since isChatMuted() elsewhere
  // (socket handlers, sound-on-message checks) reads directly from localStorage, not from state.
  const localSet = new Set(getMutedChatKeys(user.id).map(String));
  serverSet.forEach((key) => {
    if (!localSet.has(key)) toggleMuteChat(user.id, key);
  });
  localSet.forEach((key) => {
    if (!serverSet.has(key)) toggleMuteChat(user.id, key);
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [user?.id, user?.mutedChats]);
  useEffect(() => {
    if (filter !== "friends") return;
    loadFriendDiscover(search);
    loadFriendRequests();
    loadMyFriends();
  }, [filter, search, loadFriendDiscover, loadFriendRequests, loadMyFriends]);
  // Socket routing and listener hooks
  useEffect(() => {
    if (!hasLocalKeyring) return;
    connectSocket();
    const socket = getSocket();
    if (!socket) return undefined;

    function isCurrentConversation(raw) {
      const current = selectedRef.current;
      if (!current) return false;
      if (raw.group) {
        return (
          current.type === "group" && String(current.id) === String(raw.group)
        );
      }
      const otherId = String(raw.from) === String(user.id) ? raw.to : raw.from;
      return current.type === "dm" && String(current.id) === String(otherId);
    }

    function handleIncoming(raw) {
      if (raw.group) {
        // group messages
      } else {
        const otherId =
          String(raw.from) === String(user.id) ? raw.to : raw.from;
        const blocked = (user.blockedUsers || []).map(String);
        if (blocked.includes(String(otherId))) return;
      }

      recordActivityFromMessage(raw);
      if (!isCurrentConversation(raw)) return;

     if (String(raw.from) !== String(user.id)) {
        const convKey = raw.group
          ? conversationKeyForGroup(raw.group)
          : conversationKeyForUser(
              String(raw.from) === String(user.id) ? raw.to : raw.from,
            );
        const muted = isChatMuted(user.id, convKey);
        const isCurrentlyOpen = isCurrentConversation(raw);
        const isMention = Array.isArray(raw.mentionedUserIds)
          ? raw.mentionedUserIds.map(String).includes(String(user.id))
          : false;
        const notifyOk =
          !muted &&
          shouldNotify(notifSettings, {
            kind: raw.group ? "group" : "dm",
            isMention,
          });

        if (notifyOk) {
          playNotificationSound(notifSettings);

          // Only pop a browser notification if this conversation isn't the one
          // currently open and focused — matches standard chat-app behavior.
          if (!isCurrentlyOpen || document.visibilityState === "hidden") {
            const senderName =
              users.find((u) => String(u.id) === String(raw.from))?.displayName ||
              users.find((u) => String(u.id) === String(raw.from))?.username ||
              "Someone";
            const groupName = raw.group
              ? groups.find((g) => String(g.id) === String(raw.group))?.name
              : null;
            const { title, body } = buildNotificationText(
              {
                senderName,
                messageText: raw.group ? raw.content : null, // DM text stays encrypted here; see note below
                isGroup: Boolean(raw.group),
                groupName,
              },
              notifSettings,
            );
            showNotificationPopup({ title, body }, notifSettings, () => {
              const target = raw.group
                ? { key: convKey, type: "group", id: raw.group }
                : { key: convKey, type: "dm", id: String(raw.from) === String(user.id) ? raw.to : raw.from };
              handleSelectConversation(target);
            });
          }
        }

        if (selectedRef.current?.key) {
          markConversationRead(
            user.id,
            selectedRef.current.key,
            raw.createdAt || new Date().toISOString(),
          );
          bumpActivity();
        }
      }

      setMessages((prev) => {
        const id = String(raw.id || raw._id);
        if (prev.some((m) => String(m.id || m._id) === id)) return prev;

        let next;
        // Replace the oldest optimistic bubble in this conversation (FIFO)
        // so own sends don't double when the socket arrives before HTTP.
        if (String(raw.from) === String(user.id)) {
          let replaced = false;
          const confirmed = decorate(raw);
          next = [];
          for (const m of prev) {
            if (
              !replaced &&
              m._pending &&
              String(m.from) === String(user.id) &&
              (raw.group
                ? String(m.group || "") === String(raw.group)
                : String(m.to || "") === String(raw.to))
            ) {
              next.push({
                ...confirmed,
                text: m.text ?? confirmed.text,
                _pending: undefined,
                _status: undefined,
              });
              replaced = true;
              continue;
            }
            next.push(m);
          }
          if (!replaced) next.push(confirmed);
        } else {
          next = [...prev, decorate(raw)];
        }

        if (messageListRef.current) {
          const el = messageListRef.current;
          const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 150;
          if (isUp) {
            setHasUnread(true);
          } else {
            setTimeout(() => scrollToBottom("smooth"), 50);
          }
        }
        return next;
      });

      if (String(raw.from) !== String(user.id) && !raw.group) {
        const socket = getSocket();
        socket?.emit("message:delivered", { messageId: raw.id || raw._id });
      }
    }

    function handleDeleted(payload) {
      const id = String(payload?.id || "");
      if (!id) return;
      setMessages((prev) => prev.filter((m) => String(m.id || m._id) !== id));
    }

    function handleExpired(payload) {
      const id = String(payload?.id || "");
      if (!id) return;
      setMessages((prev) => prev.filter((m) => String(m.id || m._id) !== id));
    }

    function handleReaction(raw) {
      const id = String(raw?.id || raw?._id || "");
      if (!id) return;
      if (!isCurrentConversation(raw)) return;
      setMessages((prev) =>
        prev.map((m) => (String(m.id || m._id) === id ? decorate(raw) : m)),
      );
    }

    function handleEdited(raw) {
      const id = String(raw?.id || raw?._id || "");
      if (!id) return;
      if (!isCurrentConversation(raw)) return;
      setMessages((prev) =>
        prev.map((m) => (String(m.id || m._id) === id ? decorate(raw) : m)),
      );
    }

    function handleGroupNew(group) {
      setGroups((prev) => {
        if (prev.some((g) => String(g.id) === String(group.id))) {
          return prev.map((g) =>
            String(g.id) === String(group.id) ? group : g,
          );
        }
        return [group, ...prev];
      });
    }
    async function handleFriendRequestNew() {
      loadFriendRequests();
      showToast("New friend request", "info");
    }
    async function handleFriendRequestAccepted() {
      try {
        const { data } = await client.get("/users/me");
        if (data?.data) updateSessionUser(data.data);
      } catch {
        // non-fatal
      }

      loadDirectory();
      loadFriendRequests();
      loadMyFriends();
      loadFriendDiscover();
    }
    async function handleFriendRemoved() {
      try {
        const { data } = await client.get("/users/me");
        if (data?.data) updateSessionUser(data.data);
      } catch {
        // non-fatal
      }
      loadDirectory();
      loadMyFriends();
    }

    function handleGroupUpdated(payload) {
      if (!payload?.id) return;
      setGroups((prev) => {
        if (prev.some((g) => String(g.id) === String(payload.id))) {
          return prev.map((g) =>
            String(g.id) === String(payload.id) ? payload : g,
          );
        }
        return [payload, ...prev];
      });
      const current = selectedRef.current;
      if (
        current?.type === "group" &&
        String(current.id) === String(payload.id)
      ) {
        const memberCount = (payload.members || []).length;
        const desc = (payload.description || "").trim();
        setSelected((prev) =>
          prev
            ? {
                ...prev,
                group: payload,
                title: payload.name || prev.title,
                subtitle: desc
                  ? desc.slice(0, 60) + (desc.length > 60 ? "…" : "")
                  : `${memberCount} member${memberCount === 1 ? "" : "s"}`,
              }
            : prev,
        );
        setPinnedIds((payload.pinnedMessageIds || []).map(String));
      }
    }

    function handleGroupDeleted({ id } = {}) {
      if (!id) return;
      setGroups((prev) => prev.filter((g) => String(g.id) !== String(id)));
      const current = selectedRef.current;
      if (current?.type === "group" && String(current.id) === String(id)) {
        setSelected(null);
        setMessages([]);
        setShowGroupSettings(false);
        if (location.pathname !== "/chat") navigate("/chat");
      }
    }

    function handlePollUpdate(raw) {
      const id = String(raw?.id || raw?._id || "");
      if (!id) return;
      if (!isCurrentConversation(raw)) return;
      setMessages((prev) =>
        prev.map((m) =>
          String(m.id || m._id) === id
            ? { ...decorate(raw), pollVotes: raw.pollVotes || [] }
            : m,
        ),
      );
    }

    function handleMentionNew({ from } = {}) {
      const username =
        String(from) === String(user.id)
          ? user.username
          : users.find((u) => String(u.id) === String(from))?.username;
      showToast(`${username || "Someone"} mentioned you`);
    }

    function handleTypingStart({ from, groupId } = {}) {
      const current = selectedRef.current;
      if (!current) return;
      if (
        groupId &&
        current.type === "group" &&
        String(groupId) === String(current.id)
      ) {
        if (String(from) === String(user.id)) return;
        const name =
          users.find((u) => String(u.id) === String(from))?.username ||
          (current.group?.members || []).find(
            (m) => String(m.id || m._id) === String(from),
          )?.username ||
          "Someone";
        setGroupTypingNames((prev) =>
          prev.includes(name) ? prev : [...prev, name].slice(-3),
        );
        clearTimeout(typingPeerTimeoutRef.current);
        typingPeerTimeoutRef.current = setTimeout(
          () => setGroupTypingNames([]),
          3000,
        );
        return;
      }
      if (current.type !== "dm") return;
      if (String(from) !== String(current.id)) return;
      setPeerTyping(true);
      clearTimeout(typingPeerTimeoutRef.current);
      typingPeerTimeoutRef.current = setTimeout(
        () => setPeerTyping(false),
        3000,
      );
    }

    function handleTypingStop({ from, groupId } = {}) {
      const current = selectedRef.current;
      if (!current) return;
      if (
        groupId &&
        current.type === "group" &&
        String(groupId) === String(current.id)
      ) {
        const name = users.find((u) => String(u.id) === String(from))?.username;
        if (name) setGroupTypingNames((prev) => prev.filter((n) => n !== name));
        return;
      }
      if (current.type !== "dm") return;
      if (String(from) !== String(current.id)) return;
      setPeerTyping(false);
    }

    function handlePresenceSnapshot({ onlineUserIds: ids } = {}) {
      setOnlineUserIds(new Set((ids || []).map(String)));
    }

    function handlePresenceUpdate({ userId, online, lastLoginAt } = {}) {
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (online) next.add(String(userId));
        else next.delete(String(userId));
        return next;
      });
      if (!online && lastLoginAt) {
        setUsers((prev) =>
          prev.map((u) =>
            String(u.id) === String(userId) ? { ...u, lastLoginAt } : u,
          ),
        );
      }
    }

    function handleMessageStatus(payload) {
      if (!payload) return;
      if (payload.bulk && payload.conversationWith) {
        const peer = String(payload.conversationWith);
        setMessages((prev) =>
          prev.map((m) =>
            String(m.to) === peer || String(m.from) === peer
              ? {
                  ...m,
                  deliveredAt: m.deliveredAt || payload.readAt,
                  readAt:
                    String(m.from) === String(user.id)
                      ? payload.readAt || m.readAt
                      : m.readAt,
                }
              : m,
          ),
        );
        return;
      }
      const id = String(payload.id || "");
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) =>
          String(m.id || m._id) === id
            ? {
                ...m,
                deliveredAt: payload.deliveredAt || m.deliveredAt,
                readAt: payload.readAt || m.readAt,
                _status: undefined,
              }
            : m,
        ),
      );
    }

    socket.on("message:new", handleIncoming);
    socket.on("message:deleted", handleDeleted);
    socket.on("message:expired", handleExpired);
    socket.on("message:reaction", handleReaction);
    socket.on("message:edited", handleEdited);
    socket.on("group:new", handleGroupNew);
    socket.on("group:updated", handleGroupUpdated);
    socket.on("group:deleted", handleGroupDeleted);
    socket.on("message:poll", handlePollUpdate);
    socket.on("mention:new", handleMentionNew);
    socket.on("typing:start", handleTypingStart);
    socket.on("typing:stop", handleTypingStop);
    socket.on("presence:snapshot", handlePresenceSnapshot);
    socket.on("presence:update", handlePresenceUpdate);
    socket.on("message:status", handleMessageStatus);
    socket.on("friend:request:new", handleFriendRequestNew);
    socket.on("friend:request:accepted", handleFriendRequestAccepted);
    socket.on("friend:removed", handleFriendRemoved);
    return () => {
      socket.off("message:new", handleIncoming);
      socket.off("message:deleted", handleDeleted);
      socket.off("message:expired", handleExpired);
      socket.off("message:reaction", handleReaction);
      socket.off("message:edited", handleEdited);
      socket.off("group:new", handleGroupNew);
      socket.off("group:updated", handleGroupUpdated);
      socket.off("group:deleted", handleGroupDeleted);
      socket.off("message:poll", handlePollUpdate);
      socket.off("mention:new", handleMentionNew);
      socket.off("typing:start", handleTypingStart);
      socket.off("typing:stop", handleTypingStop);
      socket.off("presence:snapshot", handlePresenceSnapshot);
      socket.off("presence:update", handlePresenceUpdate);
      socket.off("message:status", handleMessageStatus);
      socket.off("friend:request:new", handleFriendRequestNew);
      socket.off("friend:request:accepted", handleFriendRequestAccepted);
      socket.off("friend:removed", handleFriendRemoved);
      clearTimeout(typingPeerTimeoutRef.current);
    };
  }, [
    hasLocalKeyring,
    user,
    users,
    groups,
    decorate,
    scrollToBottom,
    recordActivityFromMessage,
    bumpActivity,
    showToast,
    notifSettings,
  ]);

  const selectedKey = selected?.key;
  const selectedType = selected?.type;
  const selectedId = selected?.id;
  const decorateRef = useRef(decorate);
  decorateRef.current = decorate;
  const recordActivityRef = useRef(recordActivityFromMessage);
  recordActivityRef.current = recordActivityFromMessage;
  const scrollToBottomRef = useRef(scrollToBottom);
  scrollToBottomRef.current = scrollToBottom;
  const bumpActivityRef = useRef(bumpActivity);
  bumpActivityRef.current = bumpActivity;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const loadedThreadKeyRef = useRef(null);

  useEffect(() => {
    if (!selectedKey || !selectedId || !hasLocalKeyring) return undefined;

    const threadKey = selectedKey;
    const threadType = selectedType;
    const threadId = selectedId;
    const switching = loadedThreadKeyRef.current !== threadKey;
    loadedThreadKeyRef.current = threadKey;

    setDisappearSeconds(0);
    let cancelled = false;
    setPeerTyping(false);
    setHasMoreMessages(false);
    oldestCreatedAtRef.current = null;

    if (switching) {
      if (threadType === "group") {
        setPinnedIds(
          (selectedRef.current?.group?.pinnedMessageIds || []).map(String),
        );
      } else {
        setPinnedIds(getPinnedIds(user.id, threadKey));
      }
      // Only flash skeletons when opening a different conversation — not on
      // sidebar activity / URL-sync object identity churn.
      setLoadingMessages(true);
      setMessages([]);
    }

    const endpoint =
      threadType === "group"
        ? `/groups/${threadId}/messages`
        : `/messages/${threadId}`;

    client
      .get(endpoint, { params: { limit: 80, markRead: 1 } })
      .then((res) => {
        if (cancelled) return;
        const next = (res.data.data || []).map((raw) => decorateRef.current(raw));
        setHasMoreMessages(Boolean(res.data.meta?.hasMore));
        oldestCreatedAtRef.current = next[0]?.createdAt || null;
        if (next.length) {
          recordActivityRef.current(next[next.length - 1]);
        }
        setMessages(next);
        markConversationRead(user.id, threadKey);
        bumpActivityRef.current();
        if (threadType === "dm") {
          client.post(`/messages/${threadId}/read`).catch(() => {});
        }
        setTimeout(() => scrollToBottomRef.current("auto"), 50);
      })
      .catch((err) =>
        showToastRef.current(
          err.response?.data?.error || "Failed to load messages",
          "error",
        ),
      )
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedKey, selectedType, selectedId, hasLocalKeyring, user.id]);

  // Vercel's serverless API cannot keep a Socket.IO connection alive.
  // When no socket is connected, sync the open conversation frequently so
  // both participants see new messages without manually reloading the page.
  useEffect(() => {
    if (!selectedKey || !selectedId || !hasLocalKeyring) return undefined;

    let cancelled = false;
    let inFlight = false;
    const threadType = selectedType;
    const threadId = selectedId;
    const threadKey = selectedKey;
    const endpoint =
      threadType === "group"
        ? `/groups/${threadId}/messages`
        : `/messages/${threadId}`;

    async function syncOpenConversation() {
      if (
        cancelled ||
        inFlight ||
        document.visibilityState === "hidden" ||
        getSocket()?.connected
      ) {
        return;
      }

      inFlight = true;
      try {
        const { data } = await client.get(endpoint, {
          params: { limit: 80, markRead: 1 },
        });
        if (cancelled) return;

        const latest = (data.data || []).map((raw) => decorateRef.current(raw));
        const currentIds = new Set(
          messagesRef.current.map((message) =>
            String(message.id || message._id),
          ),
        );
        const receivedNewMessage = latest.some(
          (message) =>
            !currentIds.has(String(message.id || message._id)) &&
            String(message.from) !== String(user.id),
        );

        setMessages((current) => {
          const existingIds = new Set(
            current.map((message) => String(message.id || message._id)),
          );
          const latestById = new Map(
            latest.map((message) => [
              String(message.id || message._id),
              message,
            ]),
          );

          let changed = false;
          const merged = current.map((message) => {
            const id = String(message.id || message._id);
            const next = latestById.get(id);
            if (!next) return message;
            if (
              next.text === message.text &&
              next.readAt === message.readAt &&
              next.deliveredAt === message.deliveredAt &&
              next.editedAt === message.editedAt &&
              (next.reactions || []).length === (message.reactions || []).length
            ) {
              return message;
            }
            changed = true;
            return next;
          });
          for (const message of latest) {
            const id = String(message.id || message._id);
            if (!existingIds.has(id)) {
              merged.push(message);
              changed = true;
            }
          }
          if (!changed) return current;
          merged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          return merged;
        });

        const last = latest.at(-1);
        if (last) {
          recordActivityRef.current(last);
          markConversationRead(user.id, threadKey);
        }
        if (receivedNewMessage) {
          if (!isChatMuted(user.id, threadKey)) playReceiveSound();
          setTimeout(() => scrollToBottomRef.current("smooth"), 50);
        }
      } catch {
        // Keep retrying; a temporary network failure should not require reload.
      } finally {
        inFlight = false;
      }
    }

    const timer = window.setInterval(syncOpenConversation, 1200);
    const syncWhenVisible = () => {
      if (document.visibilityState === "visible") syncOpenConversation();
    };
    window.addEventListener("focus", syncOpenConversation);
    document.addEventListener("visibilitychange", syncWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", syncOpenConversation);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  }, [selectedKey, selectedType, selectedId, hasLocalKeyring, user.id]);

  const loadOlderMessages = useCallback(async () => {
    if (
      !selected ||
      !hasMoreMessages ||
      loadingOlderRef.current ||
      !oldestCreatedAtRef.current
    )
      return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const el = messageListRef.current;
    const prevHeight = el?.scrollHeight || 0;
    const endpoint =
      selected.type === "group"
        ? `/groups/${selected.id}/messages`
        : `/messages/${selected.id}`;
    try {
      const { data } = await client.get(endpoint, {
        params: { limit: 40, before: oldestCreatedAtRef.current, markRead: 0 },
      });
      const older = (data.data || []).map(decorate);
      setHasMoreMessages(Boolean(data.meta?.hasMore));
      if (older.length) {
        oldestCreatedAtRef.current = older[0].createdAt;
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => String(m.id || m._id)));
          const merged = [
            ...older.filter((m) => !ids.has(String(m.id || m._id))),
            ...prev,
          ];
          return merged;
        });
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight;
        });
      }
    } catch {
      // ignore
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [selected, hasMoreMessages, decorate]);

  loadOlderMessagesRef.current = loadOlderMessages;

  // Keep auto-scroll only when near bottom for new messages — avoid jump on older loads.
  // Scroll the list container itself. scrollIntoView() on bottomRef defaults to
  // block:'start', which pins the sentinel to the top and clips the last bubble.
  useEffect(() => {
    if (loadingOlder) return;
    const el = messageListRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (!nearBottom) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, [messages, loadingOlder]);

  const canChat = hasLocalKeyring;
  const isGroupChat = selected?.type === "group";

  useEffect(() => {
    if (!canChat) return;
    enablePushNotifications().catch(() => {});
  }, [canChat]);

  const usernameById = useMemo(() => {
    const map = new Map();
    for (const u of users) map.set(String(u.id), u.username);
    map.set(String(user.id), user.username);
    for (const g of groups) {
      for (const m of g.members || []) {
        const id = memberId(m);
        if (m.username) map.set(id, m.username);
      }
    }
    return map;
  }, [users, groups, user]);

  const conversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hidden = new Set(hiddenChatIds);
    const items = [];

    const muted = new Set(mutedKeys.map(String));
    const archived = new Set(archivedKeys.map(String));

    for (const u of users) {
      const key = conversationKeyForUser(u.id);
      const activity = getConversationActivity(user.id, key);
      const unread = isUnreadConversation(
        user.id,
        key,
        activity?.at,
        activity?.from,
      );
      const online =
        onlineUserIds.has(String(u.id)) &&
        (u.privacy?.online || "everyone") !== "nobody";
      items.push({
        key,
        type: "dm",
        id: u.id,
        title: u.displayName || u.username || "Unknown user",
        subtitle: null,
        searchText:
          `${u.displayName || ""} ${u.username || ""} ${u.email || ""}`.toLowerCase(),
        lastLoginAt: u.lastLoginAt,
        unread,
        sortAt: activity?.at || u.lastLoginAt || "",
        peer: u,
        muted: muted.has(String(key)),
        archived: archived.has(String(key)),
        online,
      });
    }

    for (const g of groups) {
      const key = conversationKeyForGroup(g.id);
      const activity = getConversationActivity(user.id, key);
      const unread = isUnreadConversation(
        user.id,
        key,
        activity?.at,
        activity?.from,
      );
      const memberCount = (g.members || []).length;
      const desc = (g.description || "").trim();
      items.push({
        key,
        type: "group",
        id: g.id,
        title: g.name,
        subtitle: desc
          ? desc.slice(0, 48) + (desc.length > 48 ? "…" : "")
          : `${memberCount} member${memberCount === 1 ? "" : "s"}`,
        searchText: `${g.name || ""} ${g.description || ""}`.toLowerCase(),
        lastLoginAt: g.updatedAt,
        unread,
        sortAt: activity?.at || g.updatedAt || g.createdAt || "",
        group: g,
        muted: muted.has(String(key)),
        archived: archived.has(String(key)),
        online: false,
      });
    }

    items.sort((a, b) => {
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
      return String(b.sortAt).localeCompare(String(a.sortAt));
    });

    return items.filter((c) => {
      if (c.type === "dm" && !q && hidden.has(String(c.id))) return false;
      if (filter === "archived") {
        if (!archived.has(String(c.key))) return false;
      } else if (archived.has(String(c.key))) {
        return false;
      }
      if (filter === "discover") return false;
      if (filter === "groups" && c.type !== "group") return false;
      if (filter === "unread" && !c.unread) return false;
      if (q && !(c.searchText || "").includes(q)) return false;
      return true;
    });
  }, [
    users,
    groups,
    user.id,
    search,
    filter,
    activityTick,
    hiddenChatIds,
    mutedKeys,
    archivedKeys,
    onlineUserIds,
  ]);

  // Update browser tab unread count prefix (must run after conversations is defined)
// Update browser tab unread count prefix (must run after conversations is defined)
  useEffect(() => {
    const totalUnread = conversations.reduce(
      (acc, c) => acc + (c.unread ? 1 : 0),
      0,
    );
    const showBadge = notifSettings?.badgeCount !== "hidden";
    const prefix = showBadge && totalUnread > 0 ? `(${totalUnread}) ` : "";
    document.title = selected
      ? `${prefix}${selected.title} — QuantumChat`
      : `${prefix}QuantumChat`;
    updateFaviconBadge(showBadge && totalUnread > 0);
  }, [selected, activityTick, conversations, notifSettings?.badgeCount]);

  // URL deep-link sync — restore selection from /chat/:peerId or /chat/g/:groupId
  useEffect(() => {
    if (isSettingsRoute) {
      setShowSettings(true);
      return;
    }
    if (!params.peerId && !params.groupId) return;
    const fromUrl = selectionFromParams(params, conversations);
    if (!fromUrl) return;
    if (
      selected &&
      selected.type === fromUrl.type &&
      String(selected.id) === String(fromUrl.id)
    ) {
      if (fromUrl.peer || fromUrl.group?.name) {
        setSelected((prev) => {
          if (!prev) return fromUrl;
          const samePeer =
            String(prev.peer?.id || "") === String(fromUrl.peer?.id || "") &&
            prev.peer?.displayName === fromUrl.peer?.displayName &&
            prev.peer?.lastLoginAt === fromUrl.peer?.lastLoginAt &&
            prev.peer?.hasAvatar === fromUrl.peer?.hasAvatar;
          const sameGroup =
            String(prev.group?.id || prev.group?._id || "") ===
              String(fromUrl.group?.id || fromUrl.group?._id || "") &&
            prev.group?.name === fromUrl.group?.name &&
            prev.group?.updatedAt === fromUrl.group?.updatedAt &&
            String(prev.group?.pinnedMessageIds || "") ===
              String(fromUrl.group?.pinnedMessageIds || "");
          if (
            prev.title === fromUrl.title &&
            prev.subtitle === fromUrl.subtitle &&
            samePeer &&
            sameGroup
          ) {
            return prev;
          }
          return { ...prev, ...fromUrl };
        });
      }
      return;
    }
    applyConversationSelection(fromUrl, { syncUrl: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.peerId, params.groupId, conversations, isSettingsRoute]);

  function applyConversationSelection(c, { syncUrl = true } = {}) {
    if (!c) {
      setSelected(null);
      setMessages([]);
      if (syncUrl && !isSettingsRoute) navigate("/chat");
      return;
    }
    if (c.type === "dm" && hiddenChatIds.includes(String(c.id))) {
      setHiddenChatIds(unhideChat(user.id, c.id));
    }
    setSelected(c);
    setError("");
    setDraft("");
    setReplyTo(null);
    setEditingMessage(null);
    setShowEmojiPicker(false);
    setSearchOpen(false);
    setSidebarOpen(false);
    setGallery(null);
    setGroupComposerMenu(null);
    setMentionOpen(false);
    setPendingAnnouncement(false);
    setShowGroupSettings(false);
    setProfileUserId(null);
    setPeerTyping(false);
    setGroupTypingNames([]);
    imageSrcMapRef.current = new Map();
    markConversationRead(user.id, c.key);
    bumpActivity();
    const socket = getSocket();
    if (socket && c.type === "group") {
      socket.emit("group:join", { groupId: c.id });
    }
    if (syncUrl) {
      const next = chatPathForSelection(c);
      if (location.pathname !== next) navigate(next);
    }
  }

  function handleSelectConversation(c) {
    applyConversationSelection(c, { syncUrl: true });
  }

  function handleBackToList() {
    applyConversationSelection(null, { syncUrl: true });
  }

  function toggleInfoPanel() {
    setInfoPanelOpenState((open) => {
      const next = !open;
      setInfoPanelOpen(next);
      return next;
    });
  }

  async function handleCreateGroup({
    name,
    memberIds,
    visibility,
    joinPolicy,
  }) {
    const { data } = await client.post("/groups", {
      name,
      memberIds,
      visibility,
      joinPolicy,
    });
    const group = data.data;
    setGroups((prev) => {
      if (prev.some((g) => String(g.id) === String(group.id))) return prev;
      return [group, ...prev];
    });
    handleSelectConversation({
      key: conversationKeyForGroup(group.id),
      type: "group",
      id: group.id,
      title: group.name,
      subtitle: `${(group.members || []).length} members`,
      group,
    });
  }

  async function handleDiscoverJoin(item) {
    if (!item?.id) return;
    try {
      if (item.joinPolicy === "request") {
        await client.post(`/groups/${item.id}/join-requests`);
        showToast("Join request sent", "success");
        return { pending: true };
      }
      const { data } = await client.post(`/groups/${item.id}/join`);
      const group = data.data;
      setGroups((prev) => {
        if (prev.some((g) => String(g.id) === String(group.id))) {
          return prev.map((g) =>
            String(g.id) === String(group.id) ? group : g,
          );
        }
        return [group, ...prev];
      });
      setFilter("all");
      handleSelectConversation({
        key: conversationKeyForGroup(group.id),
        type: "group",
        id: group.id,
        title: group.name,
        subtitle: `${(group.members || []).length} members`,
        group,
      });
      showToast(`Joined ${group.name}`, "success");
      return { joined: true, group };
    } catch (err) {
      showToast(
        err.response?.data?.error || err.message || "Could not join group",
        "error",
      );
      throw err;
    }
  }
  async function handleSendFriendRequest(userId) {
    try {
      const { data } = await client.post("/users/friend-requests", { to: userId });
      if (data?.data?.status === "accepted") {
        if (data?.data?.me) updateSessionUser(data.data.me);
        showToast("You are now friends", "success");
        loadMyFriends();
      } else {
        showToast("Friend request sent", "success");
      }
      loadFriendDiscover(search);
      loadFriendRequests();
      setContactLookupResult((prev) =>
        prev && String(prev.id) === String(userId)
          ? {
              ...prev,
              requestStatus:
                data?.data?.status === "accepted" ? "friends" : "pending_sent",
              requestId: data?.data?.id || data?.data?.requestId || prev.requestId,
            }
          : prev,
      );
    } catch (err) {
      showToast(err.response?.data?.error || "Failed to send request", "error");
    }
  }

  async function handleCancelFriendRequest(requestId) {
    try {
      await client.delete(`/users/friend-requests/${requestId}`);
      loadFriendDiscover(search);
      setContactLookupResult((prev) =>
        prev && String(prev.requestId) === String(requestId)
          ? { ...prev, requestStatus: "none", requestId: null }
          : prev,
      );
    } catch (err) {
      showToast(
        err.response?.data?.error || "Failed to cancel request",
        "error",
      );
    }
  }

  async function handleAcceptFriendRequest(requestId) {
    try {
      const { data } = await client.post(
        `/users/friend-requests/${requestId}/accept`,
      );
      if (data?.data?.me) {
        updateSessionUser(data.data.me);
      } else {
        try {
          const meRes = await client.get("/users/me");
          if (meRes.data?.data) updateSessionUser(meRes.data.data);
        } catch {
          // non-fatal
        }
      }
      showToast("Friend request accepted", "success");
      setIncomingRequests((prev) =>
        prev.filter((r) => String(r.id) !== String(requestId)),
      );
      loadDirectory();
      loadFriendDiscover(search);
      loadMyFriends();
      setContactLookupResult((prev) =>
        prev && String(prev.requestId) === String(requestId)
          ? { ...prev, requestStatus: "friends", requestId: null }
          : prev,
      );
    } catch (err) {
      showToast(
        err.response?.data?.error || "Failed to accept request",
        "error",
      );
    }
  }

  async function handleDeclineFriendRequest(requestId) {
    try {
      await client.post(`/users/friend-requests/${requestId}/decline`);
      setIncomingRequests((prev) =>
        prev.filter((r) => String(r.id) !== String(requestId)),
      );
      loadFriendDiscover(search);
      setContactLookupResult((prev) =>
        prev && String(prev.requestId) === String(requestId)
          ? { ...prev, requestStatus: "none", requestId: null }
          : prev,
      );
    } catch (err) {
      showToast(
        err.response?.data?.error || "Failed to decline request",
        "error",
      );
    }
  }
  function sealGroupEnvelopes(plaintext, group) {
    const members = group.members || [];
    const envelopes = [];
    for (const member of members) {
      const id = memberId(member);
      let publicKey;
      if (String(id) === String(user.id)) {
        publicKey = pickRandom(getCurrentKeySet(user.id))?.publicKey;
      } else {
        const keys = (member.publicKeys || []).filter(Boolean);
        publicKey = pickRandom(keys);
      }
      if (!publicKey) {
        throw new Error(`Missing encryption keys for ${member.username || id}`);
      }
      envelopes.push({ user: id, ...sealMessage(plaintext, publicKey) });
    }
    return envelopes;
  }

  function buildForwardPolicy() {
    if (allowForward && forwardUntilSeconds <= 0) return undefined;
    const policy = { allowForward };
    if (allowForward && forwardUntilSeconds > 0) {
      policy.forwardUntil = new Date(
        Date.now() + forwardUntilSeconds * 1000,
      ).toISOString();
    }
    return policy;
  }

  function mergeConfirmedMessage(prev, { tempId, serverRaw, displayText }) {
    const serverId = String(serverRaw.id || serverRaw._id);
    const confirmed = {
      ...decorate(serverRaw),
      ...(displayText != null ? { text: displayText } : {}),
      _pending: undefined,
      _status: undefined,
    };
    let sawServer = false;
    const next = [];
    for (const m of prev) {
      const mid = String(m.id || m._id);
      if (tempId && mid === String(tempId)) {
        if (!sawServer) {
          next.push(confirmed);
          sawServer = true;
        }
        continue;
      }
      if (mid === serverId) {
        if (!sawServer) {
          next.push(confirmed);
          sawServer = true;
        }
        continue;
      }
      next.push(m);
    }
    if (!sawServer) next.push(confirmed);
    return next;
  }

  async function sendGroupPayload(
    plaintext,
    { kind, mentionedUserIds, tempId, displayText, replyToId } = {},
  ) {
    if (!selected || selected.type !== "group") {
      throw new Error("No group selected");
    }
    const group =
      selected.group ||
      groups.find((g) => String(g.id) === String(selected.id));
    if (!group) {
      throw new Error("Group not found");
    }
    const isPublic = group.visibility === "public";
    const payload = { kind: kind || "text" };
    if (isPublic) {
      payload.content = plaintext;
    } else {
      payload.envelopes = sealGroupEnvelopes(plaintext, group);
    }
    if (mentionedUserIds?.length) payload.mentionedUserIds = mentionedUserIds;
    const reply = replyToId ?? (replyTo ? replyTo.id || replyTo._id : null);
    if (reply) payload.replyTo = reply;
    if (disappearSeconds > 0) payload.expiresInSeconds = disappearSeconds;
    const forwardPolicy = buildForwardPolicy();
    if (forwardPolicy) payload.forwardPolicy = forwardPolicy;
    const { data } = await client.post(
      `/groups/${selected.id}/messages`,
      payload,
    );
    recordActivityFromMessage(data.data);
    setMessages((prev) =>
      mergeConfirmedMessage(prev, {
        tempId,
        serverRaw: data.data,
        displayText: displayText ?? plaintext,
      }),
    );
    return data.data;
  }

  async function saveEncryptedAINote(text) {
    if (!selected || !text?.trim()) return;
    try {
      if (selected.type === "group") {
        await sendGroupPayload(text, { kind: "ai_note" });
      } else {
        const peer =
          selected.peer ||
          users.find(
            (candidate) => String(candidate.id) === String(selected.id),
          );
        const myKey = pickRandom(getCurrentKeySet(user.id));
        const recipientKeys = (peer?.publicKeys || []).filter(Boolean);
        if (!myKey?.publicKey || !recipientKeys.length)
          throw new Error("Missing encryption keys");
        const { data } = await client.post("/messages", {
          to: selected.id,
          forRecipient: sealMessage(text, pickRandom(recipientKeys)),
          forSender: sealMessage(text, myKey.publicKey),
          kind: "ai_note",
        });
        setMessages((current) => [...current, decorate(data.data)]);
      }
      showToast("Encrypted AI note saved", "success");
    } catch (err) {
      showToast(
        err.response?.data?.error || err.message || "Could not save AI note",
        "error",
      );
    }
  }

  function handleHideChat(u) {
    const peerId = String(u.id);
    setHiddenChatIds(hideChat(user.id, peerId));
    if (selected?.type === "dm" && String(selected.id) === peerId) {
      applyConversationSelection(null);
    }
  }

  function handleBlockUser(u) {
    setConfirmDialog({
      type: "block",
      user: u,
      title: `Block ${u.username}?`,
      message:
        "They’ll be removed from your list and you won’t be able to message each other. Chat history is kept.",
      confirmLabel: "Block",
      danger: true,
    });
  }

  async function executeBlockUser(u) {
    try {
      setConfirmBusy(true);
      const { data } = await client.post(`/users/${u.id}/block`);
      updateSessionUser(data.data);
      setUsers((prev) =>
        prev.filter((peer) => String(peer.id) !== String(u.id)),
      );
      setHiddenChatIds(hideChat(user.id, u.id));
      if (selected?.type === "dm" && String(selected.id) === String(u.id)) {
        applyConversationSelection(null);
      }
      setError("");
      setConfirmDialog(null);
    } catch (err) {
      showToast(err.response?.data?.error || "Failed to block user", "error");
      setConfirmDialog(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  // Keydown to trigger search (Ctrl+K)
  useEffect(() => {
    function handleGlobalKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  function handleSearchResult(messageId) {
    setSearchOpen(false);
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.style.animation = "none";
      el.offsetHeight; // trigger reflow
      el.style.animation = "msgIn 400ms ease both";
    }
  }

  // Textarea composition handlers
  function handleDraftChange(e) {
    const value = e.target.value;
    setDraft(value);

    if (selected?.type === "group") {
      const atMatch = value.match(/(^|\s)@([a-zA-Z0-9_.-]{0,32})$/);
      if (atMatch) {
        setMentionQuery(atMatch[2].toLowerCase());
        setMentionOpen(true);
      } else {
        setMentionOpen(false);
        setMentionQuery("");
      }
    } else {
      setMentionOpen(false);
      setMentionQuery("");
    }

    if (!selected || selected.peer?.isSystemUser) return;
    const socket = getSocket();
    if (!socket) return;

    if (selected.type === "dm") {
      socket.emit("typing:start", { to: selected.id });
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit("typing:stop", { to: selected.id });
      }, 2000);
    } else if (selected.type === "group") {
      socket.emit("typing:start", { groupId: selected.id });
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit("typing:stop", { groupId: selected.id });
      }, 2000);
    }
  }

  function insertMention(username) {
    setDraft((prev) =>
      prev.replace(/@([a-zA-Z0-9_.-]{0,32})$/, `@${username} `),
    );
    setMentionOpen(false);
    setMentionQuery("");
    textareaRef.current?.focus();
  }

  function handleTextareaInput(e) {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  function handleTextareaKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  async function sendPrivateQuantumAIMessage(text) {
    const peer =
      selected.peer ||
      users.find((candidate) => String(candidate.id) === String(selected.id));
    const myKeys = getCurrentKeySet(user.id);
    const myKey = pickRandom(myKeys);
    const quantumAIKey = pickRandom((peer?.publicKeys || []).filter(Boolean));
    if (!myKey?.publicKey || !quantumAIKey)
      throw new Error("Missing QuantumAI encryption keys");

    const { data: storedPrompt } = await client.post("/messages", {
      to: selected.id,
      forRecipient: sealMessage(text, quantumAIKey),
      forSender: sealMessage(text, myKey.publicKey),
    });
    setMessages((current) => [...current, decorate(storedPrompt.data)]);

    const assistantMessageId = `quantum-ai-assistant-${Date.now()}`;
    setMessages((current) => [
      ...current,
      {
        id: assistantMessageId,
        from: selected.id,
        to: user.id,
        text: "",
        createdAt: new Date().toISOString(),
        quantumAI: true,
      },
    ]);
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiBusy(true);
    try {
      let finalPayload;
      const recentContext = messages
        .filter((message) => message.text)
        .slice(-20)
        .map(
          (message) =>
            `${String(message.from) === String(user.id) ? "User" : "QuantumAI"}: ${message.text}`,
        );
      await streamQuantumAI({
        message: text,
        context: recentContext,
        link: { quantumChatPeerId: user.id },
        ephemeral: true,
        signal: controller.signal,
        onChunk: (chunk) =>
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? { ...message, text: `${message.text || ""}${chunk}` }
                : message,
            ),
          ),
        onDone: (payload) => {
          finalPayload = payload;
        },
      });
      if (!finalPayload?.content?.trim()) {
        throw new Error("QuantumAI returned an empty response");
      }
      if (
        finalPayload.receipt &&
        finalPayload.requestId &&
        finalPayload.contentHash
      ) {
        const { data: storedAnswer } = await client.post(
          "/messages/quantum-ai-response",
          {
            content: finalPayload.content,
            contentHash: finalPayload.contentHash,
            requestId: finalPayload.requestId,
            receipt: finalPayload.receipt,
            model: finalPayload.model,
          },
        );
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? decorate(storedAnswer.data)
              : message,
          ),
        );
      } else {
        // Stream succeeded but AI backend could not sign a receipt (missing shared secret).
        // Keep the visible reply so chat is usable; history won't be sealed until secrets match.
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  text: finalPayload.content,
                  kind: "ai",
                }
              : message,
          ),
        );
        showToast(
          "QuantumAI replied, but QUANTUM_AI_SERVICE_SECRET is missing/mismatched — reply was not sealed into chat history",
          "info",
        );
      }
    } catch (err) {
      let fallback = "QuantumAI failed to respond.";

      if (err?.name === "AbortError") {
        fallback = "Request cancelled.";
      } else if (err.message?.includes("empty response")) {
        fallback = "QuantumAI returned no reply.";
      } else if (err.message?.includes("signed response")) {
        fallback = "Invalid AI response.";
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                text: message.text?.trim() || fallback,
                failed: true,
              }
            : message,
        ),
      );

      showToast(
        err instanceof Error ? err.message : "QuantumAI failed to respond",
        "error",
      );
      throw err;
    }
  }

  async function invokeGroupQuantumAI(prompt, group) {
    const quantumAI = (group.members || []).find(
      (member) => member.systemRole === "quantum_ai",
    );
    if (!group.quantumAI?.enabled || !quantumAI) {
      showToast("A group admin must add and enable QuantumAI first", "error");
      return;
    }
    const maxContext = Math.min(group.quantumAI.maxContextMessages ?? 5, 20);
    const context = messages
      .filter((message) => message.text && message.kind !== "ai")
      .slice(-maxContext)
      .map((message) => message.text);

    setAiBusy(true);
    let finalPayload;
    const controller = new AbortController();
    aiAbortRef.current = controller;
    try {
      await streamQuantumAI({
        message:
          prompt.replace(/@QuantumAI\b/gi, "").trim() ||
          "Help with this conversation.",
        context,
        link: { groupId: selected.id },
        ephemeral: true,
        signal: controller.signal,
        onDone: (payload) => {
          finalPayload = payload;
        },
      });
      if (!finalPayload?.content?.trim()) {
        throw new Error("QuantumAI returned an empty group response");
      }
      if (
        finalPayload.receipt &&
        finalPayload.contentHash &&
        finalPayload.requestId
      ) {
        const { data } = await client.post(
          `/groups/${selected.id}/quantum-ai-response`,
          {
            content: finalPayload.content,
            contentHash: finalPayload.contentHash,
            requestId: finalPayload.requestId,
            receipt: finalPayload.receipt,
            model: finalPayload.model,
          },
        );
        setMessages((current) => {
          const id = String(data.data.id || data.data._id);
          return current.some(
            (message) => String(message.id || message._id) === id,
          )
            ? current
            : [...current, decorate(data.data)];
        });
      } else {
        showToast(
          "QuantumAI replied, but QUANTUM_AI_SERVICE_SECRET is missing/mismatched — group reply was not sealed",
          "info",
        );
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        showToast(
          err instanceof Error ? err.message : "QuantumAI group reply failed",
          "error",
        );
      }
    } finally {
      setAiBusy(false);
      aiAbortRef.current = null;
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!draft.trim() || !selected) return;
    if (
      aiBusy &&
      (selected.peer?.systemRole === "quantum_ai" ||
        /@QuantumAI\b/i.test(draft))
    ) {
      showToast("QuantumAI is already responding", "error");
      return;
    }

    const socket = getSocket();
    if (socket && selected.type === "dm")
      socket.emit("typing:stop", { to: selected.id });
    clearTimeout(typingTimeoutRef.current);

    try {
      if (
        selected.type === "dm" &&
        selected.peer?.systemRole === "quantum_ai"
      ) {
        const prompt = draft.trim();
        setDraft("");
        await sendPrivateQuantumAIMessage(prompt);
        playSendSound();
        setTimeout(() => scrollToBottom("smooth"), 50);
        return;
      }

      if (editingMessage) {
        if (selected.type === "group") {
          const group =
            selected.group ||
            groups.find((g) => String(g.id) === String(selected.id));
          if (!group) {
            showToast("Group not found", "error");
            return;
          }
          const editBody =
            group.visibility === "public"
              ? { content: draft }
              : { envelopes: sealGroupEnvelopes(draft, group) };
          const { data } = await client.patch(
            `/messages/${editingMessage.id || editingMessage._id}`,
            editBody,
          );
          setMessages((prev) =>
            prev.map((m) =>
              String(m.id || m._id) ===
              String(editingMessage.id || editingMessage._id)
                ? decorate(data.data)
                : m,
            ),
          );
        } else {
          const peer =
            selected.peer ||
            users.find((u) => String(u.id) === String(selected.id));
          const myKey = pickRandom(getCurrentKeySet(user.id));
          const recipientKeys = (peer?.publicKeys || []).filter(Boolean);
          if (!myKey?.publicKey || recipientKeys.length === 0) {
            showToast("Missing encryption keys for this conversation", "error");
            return;
          }
          const forRecipient = sealMessage(draft, pickRandom(recipientKeys));
          const forSender = sealMessage(draft, myKey.publicKey);
          const { data } = await client.patch(
            `/messages/${editingMessage.id || editingMessage._id}`,
            {
              forRecipient,
              forSender,
            },
          );
          setMessages((prev) =>
            prev.map((m) =>
              String(m.id || m._id) ===
              String(editingMessage.id || editingMessage._id)
                ? decorate(data.data)
                : m,
            ),
          );
        }
        setEditingMessage(null);
        setDraft("");
        setReplyTo(null);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        return;
      }

      if (selected.type === "group") {
        const group =
          selected.group ||
          groups.find((g) => String(g.id) === String(selected.id));
        if (!group) {
          showToast("Group not found", "error");
          return;
        }
        const asAnnouncement =
          pendingAnnouncement || draft.trim().startsWith("/announce");
        const bodyText = asAnnouncement
          ? draft.trim().replace(/^\/announce\s*/i, "")
          : draft;
        const plaintext = asAnnouncement
          ? encodeAnnouncement(bodyText)
          : bodyText;
        const mentionedUserIds = extractMentions(bodyText, group.members || []);
        const kind = asAnnouncement ? "announcement" : "text";
        const tempId = `tmp-${crypto.randomUUID()}`;
        const replySnapshot = replyTo;
        const draftSnapshot = draft;

        setDraft("");
        setReplyTo(null);
        setMentionOpen(false);
        setPendingAnnouncement(false);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        setMessages((prev) => [
          ...prev,
          {
            id: tempId,
            _id: tempId,
            from: user.id,
            group: selected.id,
            text: plaintext,
            kind,
            createdAt: new Date().toISOString(),
            _status: "sending",
            _pending: true,
            replyTo: replySnapshot
              ? {
                  id: replySnapshot.id || replySnapshot._id,
                  from: replySnapshot.from,
                  text: replySnapshot.text,
                }
              : null,
          },
        ]);
        playSendSound();
        markConversationRead(user.id, selected.key);
        bumpActivity();
        setTimeout(() => scrollToBottom("smooth"), 50);

        try {
          await sendGroupPayload(plaintext, {
            kind,
            mentionedUserIds,
            tempId,
            displayText: plaintext,
            replyToId: replySnapshot
              ? replySnapshot.id || replySnapshot._id
              : null,
          });
          if (!asAnnouncement && /(^|\s)@QuantumAI\b/i.test(bodyText)) {
            await invokeGroupQuantumAI(bodyText, group);
          }
        } catch (err) {
          setMessages((prev) =>
            prev.filter((m) => String(m.id || m._id) !== tempId),
          );
          setDraft(draftSnapshot);
          setReplyTo(replySnapshot);
          throw err;
        }
      } else {
        const peer =
          selected.peer ||
          users.find((u) => String(u.id) === String(selected.id));
        const myKey = pickRandom(getCurrentKeySet(user.id));
        const recipientKeys = (peer?.publicKeys || []).filter(Boolean);
        if (!myKey?.publicKey || recipientKeys.length === 0) {
          showToast("Missing encryption keys for this conversation", "error");
          return;
        }
        const draftSnapshot = draft;
        const replySnapshot = replyTo;
        const tempId = `tmp-${crypto.randomUUID()}`;
        const plaintext = draft;

        setDraft("");
        setReplyTo(null);
        setMentionOpen(false);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        setMessages((prev) => [
          ...prev,
          {
            id: tempId,
            _id: tempId,
            from: user.id,
            to: selected.id,
            text: plaintext,
            createdAt: new Date().toISOString(),
            _status: "sending",
            _pending: true,
            replyTo: replySnapshot
              ? {
                  id: replySnapshot.id || replySnapshot._id,
                  from: replySnapshot.from,
                  text: replySnapshot.text,
                }
              : null,
          },
        ]);
        playSendSound();
        markConversationRead(user.id, selected.key);
        bumpActivity();
        setTimeout(() => scrollToBottom("smooth"), 50);

        try {
          const forRecipient = sealMessage(plaintext, pickRandom(recipientKeys));
          const forSender = sealMessage(plaintext, myKey.publicKey);
          const body = { to: selected.id, forRecipient, forSender };
          if (replySnapshot) body.replyTo = replySnapshot.id || replySnapshot._id;
          if (disappearSeconds > 0) body.expiresInSeconds = disappearSeconds;
          const forwardPolicy = buildForwardPolicy();
          if (forwardPolicy) body.forwardPolicy = forwardPolicy;
          const { data } = await client.post("/messages", body);
          recordActivityFromMessage(data.data);
          setMessages((prev) =>
            mergeConfirmedMessage(prev, {
              tempId,
              serverRaw: data.data,
              displayText: plaintext,
            }),
          );
        } catch (err) {
          setMessages((prev) =>
            prev.filter((m) => String(m.id || m._id) !== tempId),
          );
          setDraft(draftSnapshot);
          setReplyTo(replySnapshot);
          throw err;
        }
      }
    } catch (err) {
      showToast(
        err.response?.data?.error || err.message || "Failed to send message",
        "error",
      );
    }
  }

  async function sendAttachmentFile(file, { plainBytes, quiet } = {}) {
    if (
      !file ||
      !selected ||
      (selected.type !== "dm" && selected.type !== "group")
    )
      return;

    if (file.size > MAX_FILE_SIZE) {
      showToast(
        `File too large (${formatFileSize(file.size)}). Maximum size is ${formatFileSize(MAX_FILE_SIZE)}.`,
        "error",
      );
      return;
    }

    const uploadId = crypto.randomUUID();
    const controller = new AbortController();
    setUploads((prev) => [
      ...prev,
      { id: uploadId, name: file.name, progress: 0, controller },
    ]);

    try {
      if (selected.type === "group") {
        const fileBytes =
          plainBytes || new Uint8Array(await file.arrayBuffer());
        const sealed = secretboxSeal(fileBytes);
        const formData = new FormData();
        formData.append(
          "file",
          new Blob([sealed.cipherBytes], {
            type: file.type || "application/octet-stream",
          }),
          file.name,
        );
        formData.append("groupId", selected.id);
        formData.append("secretboxNonce", sealed.nonce);

        const uploadRes = await client.post("/attachments", formData, {
          signal: controller.signal,
          onUploadProgress: (event) => {
            if (!event.total) return;
            const progress = Math.min(
              100,
              Math.round((event.loaded / event.total) * 100),
            );
            setUploads((prev) =>
              prev.map((u) => (u.id === uploadId ? { ...u, progress } : u)),
            );
          },
        });
        const attachment = uploadRes.data.data;
        const plaintext = encodeGroupFile({
          attachmentId: attachment.id,
          key: sealed.key,
          nonce: sealed.nonce,
          filename: attachment.filename || file.name,
          mimetype:
            attachment.mimetype || file.type || "application/octet-stream",
          size: attachment.size || file.size,
        });
        await sendGroupPayload(plaintext, { kind: "file" });
        playSendSound();
        if (!quiet) showToast("File sent successfully", "success", 3000);
        setTimeout(() => scrollToBottom("smooth"), 50);
        return;
      }

      const peer =
        selected.peer ||
        users.find((u) => String(u.id) === String(selected.id));
      const myKey = pickRandom(getCurrentKeySet(user.id));
      const recipientKeys = (peer?.publicKeys || []).filter(Boolean);
      if (!myKey?.publicKey || recipientKeys.length === 0) {
        showToast("Missing encryption keys for this conversation", "error");
        return;
      }
      const recipientPublicKey = pickRandom(recipientKeys);
      const fileBytes = plainBytes || new Uint8Array(await file.arrayBuffer());
      const forRecipientFile = sealBytes(fileBytes, recipientPublicKey);
      const forSenderFile = sealBytes(fileBytes, myKey.publicKey);

      const formData = new FormData();
      formData.append(
        "file",
        new Blob([forRecipientFile.cipherBytes], {
          type: file.type || "application/octet-stream",
        }),
        file.name,
      );
      formData.append(
        "senderFile",
        new Blob([forSenderFile.cipherBytes], {
          type: file.type || "application/octet-stream",
        }),
        file.name,
      );
      formData.append("recipientId", selected.id);
      formData.append("nonce", forRecipientFile.nonce);
      formData.append(
        "ephemeralPublicKey",
        forRecipientFile.ephemeralPublicKey,
      );
      formData.append("targetPublicKey", forRecipientFile.targetPublicKey);
      formData.append("forSenderNonce", forSenderFile.nonce);
      formData.append(
        "forSenderEphemeralPublicKey",
        forSenderFile.ephemeralPublicKey,
      );
      formData.append(
        "forSenderTargetPublicKey",
        forSenderFile.targetPublicKey,
      );

      const uploadRes = await client.post("/attachments", formData, {
        signal: controller.signal,
        onUploadProgress: (event) => {
          if (!event.total) return;
          const progress = Math.min(
            100,
            Math.round((event.loaded / event.total) * 100),
          );
          setUploads((prev) =>
            prev.map((u) => (u.id === uploadId ? { ...u, progress } : u)),
          );
        },
      });
      const attachmentId = uploadRes.data.data.id;

      const forRecipient = sealMessage("", recipientPublicKey);
      const forSender = sealMessage("", myKey.publicKey);
      const msgBody = {
        to: selected.id,
        forRecipient,
        forSender,
        attachmentId,
      };
      if (disappearSeconds > 0) msgBody.expiresInSeconds = disappearSeconds;
      const forwardPolicy = buildForwardPolicy();
      if (forwardPolicy) msgBody.forwardPolicy = forwardPolicy;
      const { data } = await client.post("/messages", msgBody);
      recordActivityFromMessage(data.data);
      setMessages((prev) => {
        const id = String(data.data.id || data.data._id);
        if (prev.some((m) => String(m.id || m._id) === id)) return prev;
        return [...prev, decorate(data.data)];
      });
      playSendSound();
      if (!quiet) showToast("File sent successfully", "success", 3000);
      setTimeout(() => scrollToBottom("smooth"), 50);
    } catch (err) {
      if (err?.code === "ERR_CANCELED" || err?.name === "CanceledError") {
        showToast("Upload cancelled", "info", 2500);
        return;
      }
      throw err;
    } finally {
      setUploads((prev) => prev.filter((u) => u.id !== uploadId));
    }
  }

  function cancelUpload(uploadId) {
    setUploads((prev) => {
      const item = prev.find((u) => u.id === uploadId);
      item?.controller?.abort();
      return prev;
    });
  }

  async function sendAttachmentFiles(filesOrFile) {
    const list = Array.isArray(filesOrFile)
      ? filesOrFile
      : filesOrFile
        ? [filesOrFile]
        : [];
    const files = list.filter(Boolean);
    if (
      !files.length ||
      !selected ||
      (selected.type !== "dm" && selected.type !== "group")
    )
      return;

    let ok = 0;
    let failed = 0;
    for (const file of files) {
      try {
        await sendAttachmentFile(file, { quiet: files.length > 1 });
        ok += 1;
      } catch (err) {
        failed += 1;
        showToast(
          err.response?.data?.error ||
            err.message ||
            `Failed to send ${file.name}`,
          "error",
        );
      }
    }
    if (files.length > 1 && ok > 0) {
      showToast(
        `${ok} file${ok === 1 ? "" : "s"} sent${failed ? `, ${failed} failed` : ""}`,
        failed ? "error" : "success",
        3500,
      );
    }
  }

  async function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (
      !files.length ||
      !selected ||
      (selected.type !== "dm" && selected.type !== "group")
    )
      return;
    await sendAttachmentFiles(files);
  }

  function handlePaste(e) {
    if (
      !selected ||
      (selected.type !== "dm" && selected.type !== "group") ||
      sendingVoice ||
      recording
    )
      return;
    const items = e.clipboardData?.items;
    if (!items?.length) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          const named =
            file.name && file.name !== "image.png"
              ? file
              : new File([file], `paste-${Date.now()}.png`, {
                  type: file.type || "image/png",
                });
          imageFiles.push(named);
        }
      }
    }
    if (!imageFiles.length) return;
    e.preventDefault();
    sendAttachmentFiles(imageFiles).catch((err) => {
      showToast(err.message || "Paste upload failed", "error");
    });
  }

  // Drag and drop events
  function handleDragEnter(e) {
    e.preventDefault();
    dragCountRef.current += 1;
    if (dragCountRef.current === 1) setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    dragCountRef.current -= 1;
    if (dragCountRef.current === 0) setIsDragging(false);
  }

  function handleDragOver(e) {
    e.preventDefault();
  }

  function handleDrop(e) {
    e.preventDefault();
    dragCountRef.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) {
      sendAttachmentFiles(files).catch((err) => {
        showToast(err.message || "File drop failed", "error");
      });
    }
  }

  function handleImageReady(id, src, filename) {
    if (!id || !src) return;
    imageSrcMapRef.current.set(String(id), { src, alt: filename || "Image" });
  }

  function handleImagePreview(id) {
    const items = [];
    for (const m of messages) {
      const attId = attachmentIdOf(m.attachment);
      if (!attId) continue;
      const entry = imageSrcMapRef.current.get(String(attId));
      if (entry) items.push({ id: String(attId), ...entry });
    }
    if (!items.length) {
      const fallback = imageSrcMapRef.current.get(String(id));
      if (fallback) {
        setGallery({ items: [{ id: String(id), ...fallback }], index: 0 });
      }
      return;
    }
    const index = Math.max(
      0,
      items.findIndex((it) => it.id === String(id)),
    );
    setGallery({ items, index: index < 0 ? 0 : index });
  }

  function clearRecordingResources({ keepChunks = false } = {}) {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    if (!keepChunks) recordChunksRef.current = [];
    setRecordSeconds(0);
    setRecording(false);
  }

  async function startVoiceRecording() {
    if (
      !selected ||
      (selected.type !== "dm" && selected.type !== "group") ||
      recording ||
      sendingVoice
    )
      return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      showToast("Voice notes are not supported in this browser", "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordChunksRef.current = [];
      recordStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) recordChunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        clearRecordingResources();
        showToast("Voice recording failed", "error");
      };

      recorder.onstop = async () => {
        const chunks = recordChunksRef.current.slice();
        const type = (recorder.mimeType || mimeType || "audio/webm").split(
          ";",
        )[0];
        clearRecordingResources();
        if (!chunks.length) {
          showToast("No audio captured — try again", "error");
          return;
        }

        const blob = new Blob(chunks, { type: type || "audio/webm" });
        if (blob.size < 256) {
          showToast("Recording too short — hold a bit longer", "error");
          return;
        }

        const ext = type.includes("mp4")
          ? "m4a"
          : type.includes("ogg")
            ? "ogg"
            : "webm";
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, {
          type: type || "audio/webm",
        });
        const plainBytes = new Uint8Array(await blob.arrayBuffer());

        setSendingVoice(true);
        try {
          await sendAttachmentFile(file, { plainBytes });
        } catch (err) {
          showToast(
            err.response?.data?.error || "Failed to send voice note",
            "error",
          );
        } finally {
          setSendingVoice(false);
        }
      };

      recorder.start(200);
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        const elapsed = Math.floor(
          (Date.now() - recordStartedAtRef.current) / 1000,
        );
        setRecordSeconds(elapsed);
        if (elapsed >= MAX_VOICE_SECONDS) {
          stopVoiceRecording();
        }
      }, 200);
    } catch {
      clearRecordingResources();
      showToast("Microphone permission is required for voice notes", "error");
    }
  }

  function stopVoiceRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      clearRecordingResources();
      return;
    }
    try {
      if (recorder.state === "recording") recorder.requestData();
    } catch {
      // ignore
    }
    recorder.stop();
  }

  function cancelVoiceRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = () => clearRecordingResources();
      try {
        recorder.stop();
      } catch {
        clearRecordingResources();
      }
      return;
    }
    clearRecordingResources();
  }

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (mediaStreamRef.current)
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function handleDeleteMessage(messageId) {
    if (!messageId) return;
    setConfirmDialog({
      type: "delete",
      messageId,
      title: "Delete message?",
      message:
        "This removes the message for everyone. It will disappear for both of you with no trace.",
      confirmLabel: "Delete",
      danger: true,
    });
  }

  function handleDeleteForMe(messageId) {
    setDeletedForMeIds(deleteMessageForMe(user.id, messageId));
    setExtrasTick((n) => n + 1);
    showToast("Message removed for you", "success");
  }

  function handleCopyMessage(message) {
    if (!message?.text) return;
    navigator.clipboard?.writeText(message.text).then(
      () => showToast("Copied to clipboard", "success"),
      () => showToast("Could not copy message", "error"),
    );
  }

  function handleStarMessage(messageId) {
    setStarredIds(toggleStarredMessage(user.id, messageId));
    setExtrasTick((n) => n + 1);
  }

  async function handlePinMessage(messageId) {
    if (!selected?.key) return;
    if (selected.type === "group") {
      const pinned = (selected.group?.pinnedMessageIds || []).map(String);
      const isPinned = pinned.includes(String(messageId));
      try {
        const { data } = isPinned
          ? await client.delete(`/groups/${selected.id}/pins/${messageId}`)
          : await client.post(`/groups/${selected.id}/pins/${messageId}`);
        const group = data.data;
        setGroups((prev) =>
          prev.map((g) => (String(g.id) === String(group.id) ? group : g)),
        );
        setSelected((prev) =>
          prev ? { ...prev, group, title: group.name || prev.title } : prev,
        );
        setPinnedIds((group.pinnedMessageIds || []).map(String));
        setExtrasTick((n) => n + 1);
      } catch (err) {
        showToast(err.response?.data?.error || "Failed to update pin", "error");
      }
      return;
    }
    setPinnedIds(togglePinnedMessage(user.id, selected.key, messageId));
    setExtrasTick((n) => n + 1);
  }

  async function handleVotePoll(messageId, optionIndex) {
    if (!messageId || optionIndex == null || selected?.type !== "group") return;
    try {
      const { data } = await client.post(
        `/groups/messages/${messageId}/poll-vote`,
        { optionIndex },
      );
      setMessages((prev) =>
        prev.map((m) =>
          String(m.id || m._id) === String(messageId)
            ? { ...decorate(data.data), pollVotes: data.data.pollVotes || [] }
            : m,
        ),
      );
    } catch (err) {
      showToast(err.response?.data?.error || "Failed to vote", "error");
    }
  }

  function handleJumpToReply(replyId) {
    if (!replyId) return;
    handleSearchResult(String(replyId));
  }

  async function handleForwardToConversation(target) {
    if (!forwardMessage?.text || !target || target.type !== "dm") return;
    setForwardBusy(true);
    try {
      const originalId = forwardMessage.id || forwardMessage._id;
      if (originalId) {
        try {
          const check = await client.get(
            `/messages/${originalId}/forward-check`,
          );
          if (check.data?.data?.allowed === false) {
            showToast(
              check.data.data.reason ||
                "Forwarding not allowed for this message",
              "error",
            );
            return;
          }
        } catch (checkErr) {
          const reason =
            checkErr.response?.data?.data?.reason ||
            checkErr.response?.data?.error ||
            "Forwarding not allowed for this message";
          if (
            checkErr.response?.status === 403 ||
            checkErr.response?.status === 404
          ) {
            showToast(reason, "error");
            return;
          }
          // Network / unexpected: still attempt send; server will enforce.
        }
      }

      const peer =
        target.peer || users.find((u) => String(u.id) === String(target.id));
      const myKey = pickRandom(getCurrentKeySet(user.id));
      const recipientKeys = (peer?.publicKeys || []).filter(Boolean);
      if (!myKey?.publicKey || recipientKeys.length === 0) {
        showToast("Missing encryption keys for this conversation", "error");
        return;
      }
      const forRecipient = sealMessage(
        forwardMessage.text,
        pickRandom(recipientKeys),
      );
      const forSender = sealMessage(forwardMessage.text, myKey.publicKey);
      const { data } = await client.post("/messages", {
        to: target.id,
        forRecipient,
        forSender,
        forwardedFrom: {
          username: user.username,
          messageId: originalId,
        },
      });
      if (selected?.key === target.key) {
        setMessages((prev) => {
          const id = String(data.data.id || data.data._id);
          if (prev.some((m) => String(m.id || m._id) === id)) return prev;
          return [...prev, decorate(data.data)];
        });
      }
      showToast(`Forwarded to ${target.title}`, "success");
      setForwardMessage(null);
    } catch (err) {
      showToast(
        err.response?.data?.error || "Failed to forward message",
        "error",
      );
    } finally {
      setForwardBusy(false);
    }
  }

  async function executeDeleteMessage(messageId) {
    try {
      setConfirmBusy(true);
      await client.delete(`/messages/${messageId}`);
      setMessages((prev) =>
        prev.filter((m) => String(m.id || m._id) !== String(messageId)),
      );
      setConfirmDialog(null);
    } catch (err) {
      showToast(
        err.response?.data?.error || "Failed to delete message",
        "error",
      );
      setConfirmDialog(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  function closeConfirmDialog() {
    if (confirmBusy) return;
    setConfirmDialog(null);
  }

  async function handleConfirmDialog() {
    if (!confirmDialog) return;
    if (confirmDialog.type === "block") {
      await executeBlockUser(confirmDialog.user);
      return;
    }
    if (confirmDialog.type === "delete") {
      await executeDeleteMessage(confirmDialog.messageId);
      return;
    }
    if (confirmDialog.type === "regenerate-keys") {
      await handleGenerateKeys();
    }
  }

  async function handleReactMessage(messageId, emoji) {
    if (!messageId || !emoji || !selected) return;
    try {
      const existing = messages.find(
        (m) => String(m.id || m._id) === String(messageId),
      );
      const myReaction = (existing?.reactions || []).find(
        (r) => String(r.user) === String(user.id),
      );
      if (myReaction?.emoji === emoji) {
        const { data } = await client.post(`/messages/${messageId}/reactions`, {
          clear: true,
        });
        setMessages((prev) =>
          prev.map((m) =>
            String(m.id || m._id) === String(messageId)
              ? decorate(data.data)
              : m,
          ),
        );
        return;
      }

      const myKey = pickRandom(getCurrentKeySet(user.id));
      let recipientKeys = [];
      if (selected.type === "group") {
        const group =
          selected.group ||
          groups.find((g) => String(g.id) === String(selected.id));
        const targetId =
          String(existing?.from) === String(user.id)
            ? (group?.members || [])
                .map((m) => String(m.id || m._id))
                .find((id) => id !== String(user.id))
            : existing?.from;
        const member = (group?.members || []).find(
          (m) => String(m.id || m._id) === String(targetId),
        );
        recipientKeys = (member?.publicKeys || []).filter(Boolean);
      } else {
        const peer =
          selected.peer ||
          users.find((u) => String(u.id) === String(selected.id));
        recipientKeys = (peer?.publicKeys || []).filter(Boolean);
      }
      if (!myKey?.publicKey || recipientKeys.length === 0) {
        showToast("Missing encryption keys for this conversation", "error");
        return;
      }
      const forRecipient = sealMessage(emoji, pickRandom(recipientKeys));
      const forSender = sealMessage(emoji, myKey.publicKey);
      const { data } = await client.post(`/messages/${messageId}/reactions`, {
        forRecipient,
        forSender,
      });
      setMessages((prev) =>
        prev.map((m) =>
          String(m.id || m._id) === String(messageId) ? decorate(data.data) : m,
        ),
      );
    } catch (err) {
      showToast(err.response?.data?.error || "Failed to add reaction", "error");
    }
  }

  function insertEmoji(emoji) {
    setDraft((prev) => `${prev}${emoji}`);
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  }

  async function handleGenerateKeys() {
    try {
      const { keySet } = await regenerateKeys();
      const content = formatKeyFile({
        username: user.username,
        email: user.email,
        secretKeys: keySet.map((k) => k.secretKey),
      });
      downloadKeyFile(content);
      showToast("New keys generated and synchronized successfully", "success");
      setError("");
    } catch (err) {
      setError(
        err.response?.data?.error || err.message || "Failed to generate keys",
      );
      showToast("Failed to generate keys", "error");
    }
  }

  function requestGenerateKeys() {
    const isResync = keyringNeedsResync;
    setConfirmDialog({
      type: "regenerate-keys",
      title: isResync
        ? "Regenerate & resync encryption keys?"
        : "Generate new encryption keys?",
      message: isResync
        ? "Your local keyring does not match the public keys stored on the server. Regenerating publishes a fresh 5-key pool to the server and saves matching secrets on this device. Sealed stories and messages encrypted with the old pool will stay unreadable."
        : "This creates a new 5-key pool on this device and publishes it to the server. Save the downloaded keys.txt backup. Messages and sealed stories encrypted with any previous keys will stay unreadable.",
      confirmLabel: isResync ? "Regenerate & resync" : "Generate new keys",
      danger: true,
    });
  }

  async function handleImportKeyFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const secretKeys = parseKeyFile(text);
      await importKeys(secretKeys);
      setImportError("");
      showToast("Encryption key file imported successfully", "success");
    } catch (err) {
      setImportError(err.message || "Failed to import keys.txt");
      showToast(err.message || "Key import failed", "error");
    }
  }

  function handleLogout() {
    setLogoutConfirmOpen(true);
  }

  function confirmLogout() {
    setLogoutConfirmOpen(false);
    logout();
  }

  async function handleStartCall(video) {
    if (!selected || selected.type !== "dm") return;
    try {
      await webrtc.startCall({
        peerId: selected.id,
        peerName: title,
        video,
      });
    } catch (err) {
      showToast(
        err.response?.data?.error ||
          err.message ||
          "Could not start the call. Check your connection and try again.",
        "error",
      );
    }
  }

  async function handleStartMeeting(video) {
    if (!selected || selected.type !== "group") return;
    try {
      await meetingCall.startMeeting({
        groupId: selected.id,
        video,
      });
    } catch (err) {
      showToast(
        err.response?.data?.error ||
          err.message ||
          "Could not start the meeting. Check your connection and try again.",
        "error",
      );
    }
  }

  const title = useMemo(() => {
    if (!selected) return "Select a conversation";
    return selected.title || (selected.type === "group" ? "Group" : "Chat");
  }, [selected]);

  const headerSubtitle = useMemo(() => {
    if (!selected) return null;
    if (selected.type === "group") {
      if (groupTypingNames.length) {
        return groupTypingNames.length === 1
          ? `${groupTypingNames[0]} is typing…`
          : `${groupTypingNames.slice(0, 2).join(", ")} typing…`;
      }
      const group =
        selected.group ||
        groups.find((g) => String(g.id) === String(selected.id));
      const desc = (group?.description || "").trim();
      const publicHint =
        group?.visibility === "public" ? "Public · not encrypted" : null;
      if (desc) {
        const short = desc.length > 72 ? `${desc.slice(0, 72)}…` : desc;
        return publicHint ? `${publicHint} · ${short}` : short;
      }
      const count = (group?.members || []).length;
      const base = count ? `${count} members` : "Group chat";
      return publicHint ? `${publicHint} · ${base}` : base;
    }
    const peer =
      selected.peer || users.find((u) => String(u.id) === String(selected.id));
    if (peer?.systemRole === "quantum_ai")
      return aiBusy ? "generating…" : "AI Assistant";
    const onlineAllowed = (peer?.privacy?.online || "everyone") !== "nobody";
    if (peerTyping) return "typing…";
    if (onlineAllowed && onlineUserIds.has(String(selected.id)))
      return "online";
    return formatLastSeen(peer?.lastLoginAt);
  }, [
    selected,
    groups,
    users,
    onlineUserIds,
    peerTyping,
    groupTypingNames,
    aiBusy,
  ]);

  const activeGroup = useMemo(() => {
    if (!selected || selected.type !== "group") return null;
    return (
      selected.group ||
      groups.find((g) => String(g.id) === String(selected.id)) ||
      null
    );
  }, [selected, groups]);

  const canPostInGroup = useMemo(() => {
    if (!activeGroup) return true;
    if (!activeGroup.onlyAdminsCanPost) return true;
    return isGroupAdmin(activeGroup, user.id);
  }, [activeGroup, user.id]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionOpen || !activeGroup) return [];
    const q = mentionQuery || "";
    return (activeGroup.members || [])
      .filter((m) => {
        const id = memberId(m);
        if (String(id) === String(user.id)) return false;
        const name = (m.username || "").toLowerCase();
        return !q || name.startsWith(q);
      })
      .slice(0, 6);
  }, [mentionOpen, mentionQuery, activeGroup, user.id]);

  async function submitPollDraft(e) {
    e?.preventDefault?.();
    if (!pollDraft || !selected || selected.type !== "group") return;
    const options = (pollDraft.options || [])
      .map((o) => o.trim())
      .filter(Boolean);
    if (!pollDraft.question.trim() || options.length < 2) {
      showToast("Poll needs a question and at least 2 options", "error");
      return;
    }
    try {
      await sendGroupPayload(
        encodePoll({ question: pollDraft.question, options }),
        { kind: "poll" },
      );
      setPollDraft(null);
      playSendSound();
      setTimeout(() => scrollToBottom("smooth"), 50);
    } catch (err) {
      showToast(
        err.response?.data?.error || err.message || "Failed to create poll",
        "error",
      );
    }
  }

  async function submitEventDraft(e) {
    e?.preventDefault?.();
    if (!eventDraft || !selected || selected.type !== "group") return;
    if (!eventDraft.title.trim()) {
      showToast("Event needs a title", "error");
      return;
    }
    try {
      await sendGroupPayload(encodeEvent(eventDraft), { kind: "event" });
      setEventDraft(null);
      playSendSound();
      setTimeout(() => scrollToBottom("smooth"), 50);
    } catch (err) {
      showToast(
        err.response?.data?.error || err.message || "Failed to create event",
        "error",
      );
    }
  }

  function mergeUpdatedGroup(group) {
    if (!group?.id) return;
    setGroups((prev) =>
      prev.map((g) => (String(g.id) === String(group.id) ? group : g)),
    );
    setSelected((prev) => {
      if (
        !prev ||
        prev.type !== "group" ||
        String(prev.id) !== String(group.id)
      )
        return prev;
      const memberCount = (group.members || []).length;
      const desc = (group.description || "").trim();
      return {
        ...prev,
        group,
        title: group.name || prev.title,
        subtitle: desc
          ? desc.slice(0, 60) + (desc.length > 60 ? "…" : "")
          : `${memberCount} member${memberCount === 1 ? "" : "s"}`,
      };
    });
    setPinnedIds((group.pinnedMessageIds || []).map(String));
  }

  function handleLeftOrDeletedGroup(groupId) {
    setGroups((prev) => prev.filter((g) => String(g.id) !== String(groupId)));
    if (selected?.type === "group" && String(selected.id) === String(groupId)) {
      applyConversationSelection(null);
    }
    setShowGroupSettings(false);
    setProfileUserId(null);
  }

  const headerOnline = useMemo(() => {
    if (!selected || selected.type !== "dm") return false;
    const peer =
      selected.peer || users.find((u) => String(u.id) === String(selected.id));
    if ((peer?.privacy?.online || "everyone") === "nobody") return false;
    if (onlineUserIds.has(String(selected.id))) return true;
    return isRecentlyActive(peer?.lastLoginAt);
  }, [selected, users, onlineUserIds]);

  const visibleMessages = useMemo(() => {
    const deleted = new Set(deletedForMeIds.map(String));
    return messages.filter((m) => !deleted.has(String(m.id || m._id)));
  }, [messages, deletedForMeIds, extrasTick]);

  const pinnedMessages = useMemo(() => {
    const set = new Set(pinnedIds.map(String));
    return visibleMessages.filter((m) => set.has(String(m.id || m._id)));
  }, [visibleMessages, pinnedIds]);

  // Build message list with date separators
  const messagesWithSeparators = useMemo(() => {
    const items = [];
    visibleMessages.forEach((m, i) => {
      const prev = visibleMessages[i - 1];
      if (!prev || !isSameDay(prev.createdAt, m.createdAt)) {
        const d = new Date(m.createdAt);
        const dayKey = Number.isNaN(d.getTime())
          ? `sep-${i}`
          : `sep-${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        items.push({
          type: "separator",
          date: m.createdAt,
          key: dayKey,
        });
      }
      items.push({ type: "message", data: m, key: m.id || m._id });
    });
    return items;
  }, [visibleMessages]);

  // Floating chat bubbles for empty state
  const floatingBubbles = useMemo(() => {
    const sizes = [28, 22, 32, 18, 26];
    return sizes.map((size, i) => (
      <div key={i} className="chat-empty-floater">
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    ));
  }, []);

  return (
    <ChatShell
      threadOpen={Boolean(selected)}
      infoOpen={infoPanelOpen && Boolean(selected)}
      aiOpen={aiPanelOpen}
    >
      <ConversationPane
        user={user}
        canChat={canChat}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        onSettings={() => {
          setShowSettings(true);
          navigate("/chat/settings");
        }}
        onLogout={handleLogout}
        storiesRailRef={storiesRailRef}
        users={users}
        onStoriesError={setError}
         notifSettings={notifSettings}
        search={search}
        onSearchChange={setSearch}
        conversations={conversations}
        filter={filter}
        onFilterChange={setFilter}
        selectedKey={selected?.key}
        onSelect={handleSelectConversation}
        onCreateGroup={() => setShowCreateGroup(true)}
        onDiscoverJoin={handleDiscoverJoin}
        onHide={handleHideChat}
        onBlock={handleBlockUser}
        onMute={(c) => {
  const wasMuted = mutedKeys.map(String).includes(String(c.key));
  setMutedKeys(toggleMuteChat(user.id, c.key));
  const payload = c.type === "group" ? { groupId: c.id } : { peerId: c.id };
  const request = wasMuted
    ? unmuteChat(payload)
    : muteChat({ ...payload, duration: "always" });
  request.catch(() => {
    // Local toggle already reflects the change; server sync failed silently.
    // It will resync from server data on next login/session refresh.
  });
}}
        onArchive={(c) => {
          setArchivedKeys(toggleArchiveChat(user.id, c.key));
        }}
        loadingUsers={loadingUsers}
        friendCandidates={friendCandidates}
        friendCandidatesLoading={friendCandidatesLoading}
        incomingRequests={incomingRequests}
        myFriends={myFriends}
        myFriendsLoading={myFriendsLoading}
        contactQuery={contactQuery}
        onContactQueryChange={(value) => {
          setContactQuery(value);
          setContactLookupError("");
          if (contactLookupResult) setContactLookupResult(null);
        }}
        contactLookupResult={contactLookupResult}
        contactLookupLoading={contactLookupLoading}
        contactLookupError={contactLookupError}
        onLookupContact={handleLookupContact}
        onSendFriendRequest={handleSendFriendRequest}
        onCancelFriendRequest={handleCancelFriendRequest}
        onAcceptFriendRequest={handleAcceptFriendRequest}
        onDeclineFriendRequest={handleDeclineFriendRequest}
        onOpenFriend={(friend) => {
          const key = conversationKeyForUser(friend.id);
          handleSelectConversation({
            key,
            type: "dm",
            id: friend.id,
            title: friend.displayName || friend.username || "Friend",
            subtitle: null,
            peer: friend,
            muted: isChatMuted(user.id, key),
            archived: false,
            online: onlineUserIds.has(String(friend.id)),
          });
        }}
      />

      <main
        className="chat-main"
        onDragEnter={
          canChat &&
          selected &&
          (selected.type === "dm" || selected.type === "group")
            ? handleDragEnter
            : undefined
        }
        onDragLeave={
          canChat &&
          selected &&
          (selected.type === "dm" || selected.type === "group")
            ? handleDragLeave
            : undefined
        }
        onDragOver={
          canChat &&
          selected &&
          (selected.type === "dm" || selected.type === "group")
            ? handleDragOver
            : undefined
        }
        onDrop={
          canChat &&
          selected &&
          (selected.type === "dm" || selected.type === "group")
            ? handleDrop
            : undefined
        }
      >
        {!canChat && (
          <div className="key-unlock">
            <div className="key-unlock-card">
              <div className="key-unlock-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h2 className="key-unlock-title">Unlock your encryption keys</h2>
              <p className="key-unlock-copy">
                This browser does not have keys for{" "}
                <strong>
                  {user?.username || user?.email || "this account"}
                </strong>{" "}
                yet. Import your <strong>keys.txt</strong> once — they stay on
                this device, so you will not be asked again on the next login.
                Keys from another account will be rejected.
              </p>
              {importError && <div className="auth-error">{importError}</div>}
              <div className="key-unlock-actions">
                <button
                  type="button"
                  className="key-unlock-primary"
                  onClick={() => keyFileInputRef.current?.click()}
                >
                  Import keys.txt for this account
                </button>
                <input
                  ref={keyFileInputRef}
                  type="file"
                  accept=".txt,text/plain"
                  hidden
                  onChange={handleImportKeyFile}
                />
                <button
                  type="button"
                  className="key-unlock-secondary"
                  onClick={requestGenerateKeys}
                >
                  Lost your keys? Generate new set
                </button>
              </div>
              <p className="key-unlock-hint">
                Generating new keys keeps you chatting, but messages encrypted
                with your old keys stay unreadable.
              </p>
            </div>
          </div>
        )}

        {canChat && (
          <>
            {keyringNeedsResync && (
              <div className="email-verify-banner key-sync-banner">
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    flex: 1,
                  }}
                >
                  <span>
                    Your local encryption keys do not match the public keys
                    stored on the server ({keyringSync?.localMatchCount ?? 0}/
                    {keyringSync?.serverKeys?.length ?? 5} matched). Sealed
                    stories and new messages may fail to decrypt until you
                    resync.
                  </span>
                  <button
                    type="button"
                    className="email-verify-banner-btn"
                    onClick={requestGenerateKeys}
                  >
                    Regenerate &amp; resync keys
                  </button>
                </div>
              </div>
            )}
            {user && !user.emailVerified && !emailBannerDismissed && (
              <div className="email-verify-banner email-verify-banner-dismissible">
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <span>Verify your email</span>
                  <button
                    type="button"
                    className="email-verify-banner-btn"
                    onClick={async () => {
                      try {
                        const { data } = await client.post(
                          "/auth/resend-verification",
                        );
                        const verifyUrl = data?.data?.verifyUrl;
                        showToast(
                          verifyUrl
                            ? `Verification link: ${verifyUrl}`
                            : "Verification email sent",
                          verifyUrl ? "info" : "success",
                        );
                      } catch (err) {
                        showToast(
                          err.response?.data?.error ||
                            "Could not resend verification",
                          "error",
                        );
                      }
                    }}
                  >
                    Resend
                  </button>
                </div>
                <button
                  type="button"
                  className="email-verify-banner-dismiss"
                  onClick={() => setEmailBannerDismissed(true)}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <header className="chat-header">
              <div className="chat-header-left">
                <button
                  type="button"
                  className="mobile-back-btn"
                  onClick={handleBackToList}
                  aria-label="Back to conversations"
                >
                  <ArrowLeft size={20} strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  className="mobile-menu-btn"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open conversation sidebar"
                >
                  <Menu size={20} strokeWidth={2} aria-hidden="true" />
                </button>
                {selected ? (
                  <div
                    className={`chat-header-peer${selected.type === "group" || selected.type === "dm" ? " clickable" : ""}`}
                    role={
                      selected.type === "group" || selected.type === "dm"
                        ? "button"
                        : undefined
                    }
                    tabIndex={
                      selected.type === "group" || selected.type === "dm"
                        ? 0
                        : undefined
                    }
                    onClick={
                      selected.type === "group"
                        ? () => setShowGroupSettings(true)
                        : selected.type === "dm"
                          ? () => setProfileUserId(selected.id)
                          : undefined
                    }
                    onKeyDown={
                      selected.type === "group" || selected.type === "dm"
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              if (selected.type === "group")
                                setShowGroupSettings(true);
                              else setProfileUserId(selected.id);
                            }
                          }
                        : undefined
                    }
                    title={
                      selected.type === "dm"
                        ? "View profile"
                        : selected.type === "group"
                          ? "Group settings"
                          : undefined
                    }
                  >
                    {selected.type === "group" ? (
                      <span className="avatar group-avatar chat-header-avatar">
                        <Users size={18} strokeWidth={2} aria-hidden="true" />
                      </span>
                    ) : (
                      <span className="chat-header-avatar-wrap">
                        <UserAvatar
                          userId={selected.id}
                          name={title}
                          hasAvatar={Boolean(
                            (
                              selected.peer ||
                              users.find(
                                (u) => String(u.id) === String(selected.id),
                              )
                            )?.hasAvatar,
                          )}
                          className="chat-header-avatar"
                        />
                        {headerOnline && (
                          <span className="online-dot" aria-hidden="true" />
                        )}
                      </span>
                    )}
                    <div className="chat-header-text">
                      <span className="chat-header-title">{title}</span>
                      {headerSubtitle && (
                        <span
                          className={`chat-header-status ${headerOnline ? "status-online" : ""}`}
                        >
                          {headerSubtitle}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <span className="chat-header-title muted">{title}</span>
                )}
              </div>
              <div className="chat-header-actions">
                {selected?.type === "dm" &&
                  !selected?.peer?.isSystemUser &&
                  selected?.peer?.systemRole !== "quantum_ai" && (
                    <>
                      <button
                        className="icon-btn"
                        type="button"
                        title="Voice call"
                        aria-label="Voice call"
                        onClick={() => handleStartCall(false)}
                      >
                        <Phone size={18} strokeWidth={2} aria-hidden="true" />
                      </button>
                      <button
                        className="icon-btn"
                        type="button"
                        title="Video call"
                        aria-label="Video call"
                        onClick={() => handleStartCall(true)}
                      >
                        <Video size={18} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </>
                  )}
                {selected?.type === "group" && (
                  <>
                    <button
                      className="icon-btn"
                      type="button"
                      title="Start voice meeting"
                      aria-label="Start voice meeting"
                      onClick={() => handleStartMeeting(false)}
                    >
                      <Phone size={18} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-btn"
                      type="button"
                      title="Start video meeting"
                      aria-label="Start video meeting"
                      onClick={() => handleStartMeeting(true)}
                    >
                      <Video size={18} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </>
                )}
                {aiBusy && (
                  <button
                    className="icon-btn active"
                    type="button"
                    onClick={() => aiAbortRef.current?.abort()}
                    title="Stop QuantumAI"
                  >
                    <Square size={17} />
                  </button>
                )}
                <button
                  className={`icon-btn accent${aiPanelOpen ? " active" : ""}`}
                  type="button"
                  onClick={() => setAiPanelOpen((open) => !open)}
                  title="Open QuantumAI"
                  aria-label="Open QuantumAI"
                  aria-pressed={aiPanelOpen}
                >
                  <MessageSquare size={18} strokeWidth={2} aria-hidden="true" />
                </button>
                {selected?.type === "group" && (
                  <button
                    className="icon-btn"
                    onClick={() => setShowGroupSettings(true)}
                    title="Group settings"
                    aria-label="Group settings"
                  >
                    <Settings2 size={18} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
                {selected && (
                  <button
                    className={`icon-btn${searchOpen ? " active" : ""}`}
                    onClick={() => setSearchOpen(!searchOpen)}
                    title="Search messages (Ctrl+K)"
                    aria-label="Search messages"
                    aria-pressed={searchOpen}
                  >
                    <Search size={18} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
                {selected && (
                  <button
                    className={`icon-btn${infoPanelOpen ? " active" : ""}`}
                    onClick={toggleInfoPanel}
                    title="Chat details"
                    aria-label="Chat details"
                    aria-pressed={infoPanelOpen}
                  >
                    <Info size={18} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </div>
            </header>

            {searchOpen && selected && (
              <MessageSearch
                messages={visibleMessages.map((m) => ({
                  id: m.id || m._id,
                  text: m.text,
                  timestamp: m.createdAt,
                }))}
                onResultSelect={handleSearchResult}
                isOpen={searchOpen}
                onClose={() => setSearchOpen(false)}
              />
            )}

            {!selected ? (
              <ChatEmptyState
                variant="welcome"
                title="Pick a conversation"
                copy="Choose someone from the sidebar, open Friends to connect, or start a new group. Messages stay end-to-end encrypted on your device."
                actionLabel="New group"
                onAction={() => setShowCreateGroup(true)}
              />
            ) : (
              <>
                {pinnedMessages.length > 0 && (
                  <div className="pinned-messages-bar">
                    {pinnedMessages.slice(0, 3).map((m) => (
                      <button
                        key={m.id || m._id}
                        type="button"
                        className="pinned-message-chip"
                        onClick={() => handleSearchResult(m.id || m._id)}
                      >
                        <Pin size={12} />
                        <span>
                          {m.text ||
                            (m.attachment ? "Attachment" : "Pinned message")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {isDragging && (
                  <DragDropOverlay
                    isVisible={true}
                    onFileDrop={sendAttachmentFiles}
                  />
                )}

                {uploads.length > 0 && (
                  <div className="upload-progress-panel" aria-live="polite">
                    {uploads.map((u) => (
                      <div key={u.id} className="upload-progress-row">
                        <div className="upload-progress-meta">
                          <span className="upload-progress-name" title={u.name}>
                            Encrypting & uploading {u.name}
                          </span>
                          <span className="upload-progress-pct">
                            {u.progress}%
                          </span>
                        </div>
                        <div className="upload-progress-track">
                          <div
                            className="upload-progress-fill"
                            style={{ width: `${u.progress}%` }}
                          />
                        </div>
                        <button
                          type="button"
                          className="upload-progress-cancel"
                          onClick={() => cancelUpload(u.id)}
                          aria-label={`Cancel upload of ${u.name}`}
                        >
                          <X size={14} strokeWidth={2} />
                          Cancel
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <AnimatePresence mode="wait">
                  <motion.div
                    key={selected.key}
                    className="message-list"
                    ref={messageListRef}
                    onScroll={handleScroll}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {loadingOlder && (
                      <div className="load-older-hint">
                        Loading earlier messages…
                      </div>
                    )}
                    {hasMoreMessages && !loadingOlder && (
                      <button
                        type="button"
                        className="load-older-btn"
                        onClick={loadOlderMessages}
                      >
                        Load earlier messages
                      </button>
                    )}
                    {loadingMessages ? (
                      <>
                        <div className="skeleton-message-bubble theirs skeleton" />
                        <div className="skeleton-message-bubble mine skeleton" />
                        <div
                          className="skeleton-message-bubble theirs skeleton"
                          style={{ width: "45%" }}
                        />
                        <div
                          className="skeleton-message-bubble mine skeleton"
                          style={{ width: "35%" }}
                        />
                      </>
                    ) : messagesWithSeparators.length === 0 ? (
                      <div className="thread-empty-state" role="status">
                        <MessageSquare
                          size={22}
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                        <p className="thread-empty-title">No messages yet</p>
                        <p className="thread-empty-copy">
                          Say hello — your message is sealed before it leaves
                          this device.
                        </p>
                      </div>
                    ) : (
                      messagesWithSeparators.map((item, index) => {
                        if (item.type === "separator") {
                          return (
                            <DateSeparator key={item.key} date={item.date} />
                          );
                        }

                        const m = item.data;
                        const prevMsg =
                          index > 0 &&
                          messagesWithSeparators[index - 1].type === "message"
                            ? messagesWithSeparators[index - 1].data
                            : null;
                        const isGrouped =
                          prevMsg &&
                          String(prevMsg.from) === String(m.from) &&
                          new Date(m.createdAt) - new Date(prevMsg.createdAt) <
                            120000;
                        const mid = String(m.id || m._id);

                        return (
                          <div
                            key={item.key}
                            id={`msg-${mid}`}
                            className="message-item"
                          >
                            <SwipeableMessage
                              message={m}
                              isMine={String(m.from) === String(user.id)}
                              onReply={(msg) => {
                                setEditingMessage(null);
                                setReplyTo(msg);
                              }}
                              onLongPress={(msg) => setActionSheetMessage(msg)}
                              onDoubleTap={(msg) => {
                                const emoji = getLastQuickReaction();
                                const mid = msg.id || msg._id;
                                if (mid) {
                                  setLastQuickReaction(emoji);
                                  handleReactMessage(mid, emoji);
                                }
                              }}
                              currentUserId={user.id}
                              resolveSecretKey={resolveMySecretKey}
                              grouped={isGrouped}
                              starred={starredIds.map(String).includes(mid)}
                              pinned={pinnedIds.map(String).includes(mid)}
                              showReadReceipts={
                                user.privacy?.readReceipts !== false
                              }
                              senderLabel={
                                isGroupChat
                                  ? usernameById.get(String(m.from)) || "Member"
                                  : undefined
                              }
                              replyPreview={
                                m.replyTo
                                  ? {
                                      label:
                                        usernameById.get(
                                          String(m.replyTo.from),
                                        ) || "Message",
                                      text: m.replyTo.text || "[encrypted]",
                                    }
                                  : null
                              }
                              onDelete={handleDeleteMessage}
                              onDeleteForMe={handleDeleteForMe}
                              onReact={(id, emoji) => {
                                if (emoji) setLastQuickReaction(emoji);
                                handleReactMessage(id, emoji);
                              }}
                              onCopy={handleCopyMessage}
                              onForward={setForwardMessage}
                              onStar={handleStarMessage}
                              onPin={handlePinMessage}
                              onVotePoll={
                                isGroupChat ? handleVotePoll : undefined
                              }
                              onJumpToReply={handleJumpToReply}
                              onImagePreview={handleImagePreview}
                              onImageReady={handleImageReady}
                              onOpenStory={(storyId) =>
                                storiesRailRef.current?.openStoryById(storyId)
                              }
                              onEdit={
                                m.text &&
                                !String(m.text).trim().startsWith('{"__qc')
                                  ? (msg) => {
                                      setReplyTo(null);
                                      setEditingMessage(msg);
                                      setDraft(msg.text || "");
                                    }
                                  : undefined
                              }
                            />
                          </div>
                        );
                      })
                    )}
                    <TypingIndicator
                      isTyping={peerTyping && selected.type === "dm"}
                      username={selected.title}
                    />
                    <div ref={bottomRef} />
                  </motion.div>
                </AnimatePresence>

                {hasUnread && (
                  <button
                    className="scroll-bottom-pill"
                    onClick={() => scrollToBottom("smooth")}
                    aria-label="Scroll to bottom to view new messages"
                  >
                    <span>New messages</span>
                    <ArrowDown size={16} strokeWidth={2.5} aria-hidden="true" />
                  </button>
                )}

                {recording ? (
                  <div className="composer composer-recording">
                    <button
                      type="button"
                      className="attach-button voice-cancel-btn"
                      onClick={cancelVoiceRecording}
                      aria-label="Cancel voice note"
                    >
                      <X size={20} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <div className="voice-recording-status">
                      <span className="voice-recording-dot" />
                      <span>Recording {formatVoiceTimer(recordSeconds)}</span>
                      <span className="voice-recording-hint">
                        max {MAX_VOICE_SECONDS}s
                      </span>
                    </div>
                    <button
                      type="button"
                      className="send-button voice-stop-btn"
                      onClick={stopVoiceRecording}
                      aria-label="Send voice note"
                    >
                      <Square
                        size={16}
                        fill="currentColor"
                        strokeWidth={0}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                ) : !canPostInGroup ? (
                  <div className="composer-shell">
                    <div
                      className="composer-hint"
                      style={{ justifyContent: "center", padding: "14px" }}
                    >
                      Only admins can post in this group
                    </div>
                  </div>
                ) : (
                  <div className="composer-shell">
                    {showEmojiPicker && (
                      <EmojiPicker
                        onPick={insertEmoji}
                        onClose={() => setShowEmojiPicker(false)}
                      />
                    )}
                    {(replyTo || editingMessage) && (
                      <div className="composer-context">
                        <div className="composer-context-copy">
                          <strong>
                            {editingMessage ? "Editing message" : "Replying to"}
                          </strong>
                          <span>
                            {editingMessage
                              ? editingMessage.text || ""
                              : replyTo?.text || "[encrypted message]"}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="composer-context-close"
                          aria-label="Cancel"
                          onClick={() => {
                            setReplyTo(null);
                            setEditingMessage(null);
                            setPendingAnnouncement(false);
                            if (editingMessage) setDraft("");
                          }}
                        >
                          <X size={16} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                    {pendingAnnouncement && !replyTo && !editingMessage && (
                      <div className="composer-context">
                        <div className="composer-context-copy">
                          <strong>Announcement</strong>
                          <span>Next send will post as an announcement</span>
                        </div>
                        <button
                          type="button"
                          className="composer-context-close"
                          aria-label="Cancel announcement mode"
                          onClick={() => setPendingAnnouncement(false)}
                        >
                          <X size={16} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                    {mentionOpen && mentionSuggestions.length > 0 && (
                      <div
                        className="composer-context"
                        style={{
                          flexDirection: "column",
                          alignItems: "stretch",
                          gap: 4,
                        }}
                      >
                        {mentionSuggestions.map((m) => (
                          <button
                            key={memberId(m)}
                            type="button"
                            className="composer-context-close"
                            style={{
                              width: "100%",
                              justifyContent: "flex-start",
                              borderRadius: 8,
                              padding: "6px 10px",
                              fontSize: 13,
                            }}
                            onClick={() => insertMention(m.username)}
                          >
                            @{m.username}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="composer-tools-bar qc-composer-tools-slim">
                      <button
                        type="button"
                        className={`composer-tools-btn ${composerHelpOpen ? "active" : ""}`}
                        onClick={() => setComposerHelpOpen((v) => !v)}
                        aria-label="Keyboard shortcuts"
                      >
                        <HelpCircle size={16} />
                      </button>
                      {composerHelpOpen && (
                        <div className="composer-help-popover">
                          <span>
                            <kbd>Enter</kbd> send
                          </span>
                          <span>
                            <kbd>Shift</kbd>+<kbd>Enter</kbd> new line
                          </span>
                          <span>
                            <kbd>Ctrl</kbd>+<kbd>V</kbd> paste image
                          </span>
                        </div>
                      )}
                    </div>
                    <form
                      className="composer"
                      onSubmit={handleSend}
                      style={{ position: "relative" }}
                    >
                      <button
                        type="button"
                        className={`attach-button ${composerPlusOpen ? "active" : ""}`}
                        onClick={() => setComposerPlusOpen(true)}
                        aria-label="More message actions"
                        disabled={sendingVoice || uploads.length > 0}
                      >
                        <Plus size={20} strokeWidth={2} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`attach-button ${showEmojiPicker ? "active" : ""}`}
                        onClick={() => setShowEmojiPicker((v) => !v)}
                        aria-label="Open emoji picker"
                        disabled={sendingVoice}
                      >
                        <Smile size={20} strokeWidth={2} aria-hidden="true" />
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        hidden
                        multiple
                        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.odt,.rtf,.zip,.rar,.7z,.txt,.csv,.json"
                        onChange={handleFileChange}
                      />
                      <textarea
                        ref={textareaRef}
                        placeholder={
                          sendingVoice
                            ? "Sending voice note…"
                            : uploads.length
                              ? "Uploading encrypted file…"
                              : pendingAnnouncement
                                ? "Write an announcement…"
                                : isGroupChat
                                  ? "Type an encrypted group message… @mention"
                                  : "Type an encrypted message…"
                        }
                        value={draft}
                        onChange={handleDraftChange}
                        onInput={handleTextareaInput}
                        onKeyDown={handleTextareaKeyDown}
                        onPaste={handlePaste}
                        aria-label="Type message body"
                        disabled={sendingVoice}
                        rows={1}
                      />
                      {draft.trim() ? (
                        <button
                          type="submit"
                          className="send-button"
                          aria-label="Send encrypted message"
                          disabled={sendingVoice}
                        >
                          <Send size={18} strokeWidth={2} aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="send-button voice-mic-btn"
                          onClick={startVoiceRecording}
                          aria-label="Record voice note"
                          disabled={sendingVoice || uploads.length > 0}
                        >
                          <Mic size={18} strokeWidth={2} aria-hidden="true" />
                        </button>
                      )}
                    </form>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      {aiPanelOpen && (
        <AIAssistantPanel
          conversation={selected}
          messages={messages}
          onClose={() => setAiPanelOpen(false)}
          onInsertDraft={(text) => {
            setDraft(text);
            setAiPanelOpen(false);
            textareaRef.current?.focus();
          }}
          onSaveEncryptedNote={saveEncryptedAINote}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        danger={confirmDialog?.danger}
        busy={confirmBusy}
        onCancel={closeConfirmDialog}
        onConfirm={handleConfirmDialog}
      />

      <CallOverlay
        call={webrtc.call}
        localStream={webrtc.localStream}
        remoteStream={webrtc.remoteStream}
        screenStream={webrtc.screenStream}
        screenSharing={webrtc.screenSharing}
        remoteScreen={webrtc.remoteScreen}
        muted={webrtc.muted}
        cameraOff={webrtc.cameraOff}
        peerLabel={
          webrtc.call
            ? users.find((u) => String(u.id) === String(webrtc.call.peerId))
                ?.displayName ||
              users.find((u) => String(u.id) === String(webrtc.call.peerId))
                ?.username ||
              webrtc.call.peerName
            : ""
        }
        onAccept={() =>
          webrtc
            .acceptCall()
            .catch(() =>
              showToast("Could not access microphone/camera", "error"),
            )
        }
        onReject={webrtc.rejectCall}
        onHangup={webrtc.hangup}
        onToggleMute={webrtc.toggleMute}
        onToggleCamera={webrtc.toggleCamera}
        onToggleScreenShare={() =>
          webrtc.toggleScreenShare().catch((err) => {
            // Dismissing the browser's picker isn't an error worth reporting.
            if (err?.name === "NotAllowedError" || err?.name === "AbortError")
              return;
            showToast("Could not share your screen", "error");
          })
        }
        minimized={callMinimized}
        onToggleMinimize={() => setCallMinimized((v) => !v)}
      />

      <MeetingOverlay
        meeting={meetingCall.meeting}
        participants={meetingCall.participants}
        localStream={meetingCall.localStream}
        muted={meetingCall.muted}
        cameraOff={meetingCall.cameraOff}
        resolveParticipantName={(peerId) =>
          users.find((u) => String(u.id) === String(peerId))?.displayName ||
          users.find((u) => String(u.id) === String(peerId))?.username
        }
        onJoin={() =>
          meetingCall
            .joinMeeting()
            .catch(() =>
              showToast("Could not access microphone/camera", "error"),
            )
        }
        onDecline={meetingCall.declineMeeting}
        onLeave={meetingCall.leaveMeeting}
        onEndForAll={meetingCall.endMeetingForAll}
        onToggleMute={meetingCall.toggleMute}
        onToggleCamera={meetingCall.toggleCamera}
      />

      {showCreateGroup && (
        <CreateGroupModal
          users={users}
          onClose={() => setShowCreateGroup(false)}
          onCreate={handleCreateGroup}
        />
      )}

      {showGroupSettings && activeGroup && (
        <GroupSettingsModal
          group={activeGroup}
          currentUserId={user.id}
          users={users}
          onClose={() => setShowGroupSettings(false)}
          onUpdated={mergeUpdatedGroup}
          onLeftOrDeleted={handleLeftOrDeletedGroup}
        />
      )}

      {profileUserId && (
        <UserProfileModal
          userId={profileUserId}
          seed={
            (selected?.type === "dm" &&
              String(selected.id) === String(profileUserId) &&
              selected.peer) ||
            users.find((u) => String(u.id) === String(profileUserId)) ||
            null
          }
          online={
            onlineUserIds.has(String(profileUserId)) &&
            (users.find((u) => String(u.id) === String(profileUserId))?.privacy
              ?.online || "everyone") !== "nobody"
          }
          muted={isChatMuted(user.id, conversationKeyForUser(profileUserId))}
          archived={archivedKeys
            .map(String)
            .includes(String(conversationKeyForUser(profileUserId)))}
          isFriend={(user.friends || [])
            .map(String)
            .includes(String(profileUserId))}
          onRemoveFriend={async (peer) => {
            try {
              await client.delete(`/users/friends/${peer.id}`);
              try {
                const { data } = await client.get("/users/me");
                if (data?.data) updateSessionUser(data.data);
              } catch {
                // non-fatal
              }
              showToast("Friend removed", "success");
              setProfileUserId(null);
              loadDirectory();
              loadMyFriends();
              loadFriendDiscover(search);
            } catch (err) {
              showToast(
                err.response?.data?.error || "Failed to remove friend",
                "error",
              );
            }
          }}
          onMute={() => {
  const key = conversationKeyForUser(profileUserId);
  const wasMuted = mutedKeys.map(String).includes(String(key));
  setMutedKeys(toggleMuteChat(user.id, key));
  const request = wasMuted
    ? unmuteChat({ peerId: profileUserId })
    : muteChat({ peerId: profileUserId, duration: "always" });
  request
    .then((res) => {
      if (res?.data) updateSessionUser(res.data);
    })
    .catch(() => {});
}}
       onArchive={() => {
            const key = conversationKeyForUser(profileUserId);
            setArchivedKeys(toggleArchiveChat(user.id, key));
          }}
          onHide={(peer) => {
            handleHideChat(peer);
            setProfileUserId(null);
            showToast("Chat hidden", "success");
          }}
          onBlock={(peer) => {
            setProfileUserId(null);
            handleBlockUser(peer);
          }}
          onClose={() => setProfileUserId(null)}
          onLoaded={(data) => {
            if (!data?.id) return;
            setUsers((prev) => {
              const id = String(data.id);
              const idx = prev.findIndex((u) => String(u.id) === id);
              if (idx < 0) return prev;
              const next = [...prev];
              next[idx] = { ...next[idx], ...data };
              return next;
            });
            setSelected((cur) => {
              if (
                !cur ||
                cur.type !== "dm" ||
                String(cur.id) !== String(data.id)
              )
                return cur;
              return {
                ...cur,
                peer: { ...(cur.peer || {}), ...data },
                title: data.displayName || data.username || cur.title,
              };
            });
          }}
        />
      )}

      {pollDraft && (
        <div
          className="create-group-overlay"
          onClick={() => setPollDraft(null)}
        >
          <form
            className="create-group-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitPollDraft}
          >
            <div className="create-group-modal-header">
              <div className="create-group-modal-heading">
                <h2>Create poll</h2>
                <p>Question and options are encrypted end-to-end</p>
              </div>
              <button
                type="button"
                className="create-group-close"
                onClick={() => setPollDraft(null)}
              >
                <X size={18} />
              </button>
            </div>
            <label className="create-group-field">
              <span className="create-group-label">Question</span>
              <input
                className="create-group-input"
                value={pollDraft.question}
                onChange={(e) =>
                  setPollDraft((d) => ({ ...d, question: e.target.value }))
                }
                placeholder="Ask something…"
                autoFocus
              />
            </label>
            {(pollDraft.options || []).map((opt, idx) => (
              <label key={idx} className="create-group-field">
                <span className="create-group-label">Option {idx + 1}</span>
                <input
                  className="create-group-input"
                  value={opt}
                  onChange={(e) =>
                    setPollDraft((d) => {
                      const options = [...d.options];
                      options[idx] = e.target.value;
                      return { ...d, options };
                    })
                  }
                  placeholder={`Choice ${idx + 1}`}
                />
              </label>
            ))}
            <div className="create-group-actions">
              {(pollDraft.options || []).length < 4 && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    setPollDraft((d) => ({ ...d, options: [...d.options, ""] }))
                  }
                >
                  Add option
                </button>
              )}
              <button type="submit" className="confirm-btn">
                Send poll
              </button>
            </div>
          </form>
        </div>
      )}

      {eventDraft && (
        <div
          className="create-group-overlay"
          onClick={() => setEventDraft(null)}
        >
          <form
            className="create-group-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitEventDraft}
          >
            <div className="create-group-modal-header">
              <div className="create-group-modal-heading">
                <h2>Create event</h2>
                <p>Details are sealed for group members only</p>
              </div>
              <button
                type="button"
                className="create-group-close"
                onClick={() => setEventDraft(null)}
              >
                <X size={18} />
              </button>
            </div>
            <label className="create-group-field">
              <span className="create-group-label">Title</span>
              <input
                className="create-group-input"
                value={eventDraft.title}
                onChange={(e) =>
                  setEventDraft((d) => ({ ...d, title: e.target.value }))
                }
                placeholder="Event name"
                autoFocus
              />
            </label>
            <label className="create-group-field">
              <span className="create-group-label">When</span>
              <input
                className="create-group-input"
                type="datetime-local"
                value={eventDraft.when}
                onChange={(e) =>
                  setEventDraft((d) => ({ ...d, when: e.target.value }))
                }
              />
            </label>
            <label className="create-group-field">
              <span className="create-group-label">Where</span>
              <input
                className="create-group-input"
                value={eventDraft.where}
                onChange={(e) =>
                  setEventDraft((d) => ({ ...d, where: e.target.value }))
                }
                placeholder="Location (optional)"
              />
            </label>
            <label className="create-group-field">
              <span className="create-group-label">Notes</span>
              <input
                className="create-group-input"
                value={eventDraft.notes}
                onChange={(e) =>
                  setEventDraft((d) => ({ ...d, notes: e.target.value }))
                }
                placeholder="Extra details (optional)"
              />
            </label>
            <div className="create-group-actions">
              <button type="submit" className="confirm-btn">
                Send event
              </button>
            </div>
          </form>
        </div>
      )}

      {showSettings && (
        <SettingsModal
          user={user}
          initialTab={settingsTab}
          className="qc-settings-sheet"
          onClose={() => {
            setShowSettings(false);
            if (isSettingsRoute) navigate(selected ? chatPathForSelection(selected) : "/chat");
          }}
          onImportKeys={handleImportKeyFile}
          onGenerateKeys={requestGenerateKeys}
          onUserUpdated={updateSessionUser}
          onLogout={() => {
            setShowSettings(false);
            handleLogout();
          }}
          onExportChat={() => {
            if (!selected || !messages.length) {
              showToast("Open a chat to export", "info");
              return;
            }
            const lines = visibleMessages
              .map((m) => {
                const who =
                  String(m.from) === String(user.id)
                    ? "You"
                    : usernameById.get(String(m.from)) || "User";
                return `[${new Date(m.createdAt).toLocaleString()}] ${who}: ${
                  m.text || (m.attachment ? "[attachment]" : "[encrypted]")
                }`;
              })
              .join("\n");
            const blob = new Blob([lines], { type: "text/plain" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `quantumchat-${selected.title || "chat"}.txt`;
            a.click();
            showToast("Chat exported from this device", "success");
          }}
        />
      )}

      {forwardMessage && (
        <ForwardModal
          conversations={conversations}
          busy={forwardBusy}
          onClose={() => !forwardBusy && setForwardMessage(null)}
          onForward={handleForwardToConversation}
        />
      )}

      {logoutConfirmOpen && (
        <ConfirmDialog
          open={logoutConfirmOpen}
          title="Log out of QuantumChat?"
          message="You will be signed out on this browser. Your encryption keys stay saved here, so you can log back in without importing keys.txt again."
          confirmLabel="Log out"
          cancelLabel="Stay"
          danger={true}
          onConfirm={confirmLogout}
          onCancel={() => setLogoutConfirmOpen(false)}
        />
      )}

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => {
          sendAttachmentFiles(file).catch((err) => {
            showToast(err.message || "Camera upload failed", "error");
          });
        }}
      />

      <ImageLightbox
        isOpen={Boolean(gallery)}
        items={gallery?.items || []}
        index={gallery?.index || 0}
        onIndexChange={(next) =>
          setGallery((g) => (g ? { ...g, index: next } : g))
        }
        onClose={() => setGallery(null)}
      />

      <ComposerPlusSheet
        open={composerPlusOpen}
        onClose={() => setComposerPlusOpen(false)}
        onAttach={() => fileInputRef.current?.click()}
        onCamera={() => setCameraOpen(true)}
        showGroupTools={isGroupChat}
        canAnnounce={Boolean(
          isGroupChat && activeGroup && isGroupAdmin(activeGroup, user.id),
        )}
        onPoll={() => setPollDraft({ question: "", options: ["", ""] })}
        onEvent={() =>
          setEventDraft({ title: "", when: "", where: "", notes: "" })
        }
        onAnnounce={() => {
          setPendingAnnouncement(true);
          textareaRef.current?.focus();
        }}
        disappearSeconds={disappearSeconds}
        onCycleDisappear={() => {
          const steps = [0, 30, 300, 3600, 86400, 604800];
          const i = steps.indexOf(disappearSeconds);
          setDisappearSeconds(steps[(i + 1) % steps.length]);
        }}
        allowForward={allowForward}
        onToggleForward={() => setAllowForward((v) => !v)}
        forwardUntilSeconds={forwardUntilSeconds}
        onCycleForwardUntil={() => {
          const steps = [0, 3600, 86400, 604800];
          const i = steps.indexOf(forwardUntilSeconds);
          setForwardUntilSeconds(steps[(i + 1) % steps.length]);
        }}
      />

      <MessageActionSheet
        open={Boolean(actionSheetMessage)}
        onClose={() => setActionSheetMessage(null)}
        message={actionSheetMessage}
        isMine={
          actionSheetMessage
            ? String(actionSheetMessage.from) === String(user.id)
            : false
        }
        starred={
          actionSheetMessage
            ? starredIds
                .map(String)
                .includes(
                  String(actionSheetMessage.id || actionSheetMessage._id),
                )
            : false
        }
        pinned={
          actionSheetMessage
            ? pinnedIds
                .map(String)
                .includes(
                  String(actionSheetMessage.id || actionSheetMessage._id),
                )
            : false
        }
        canEdit={Boolean(
          actionSheetMessage?.text &&
            !String(actionSheetMessage.text).trim().startsWith('{"__qc') &&
            String(actionSheetMessage.from) === String(user.id),
        )}
        canForward={actionSheetMessage?.allowForward !== false}
        onReply={(msg) => {
          setEditingMessage(null);
          setReplyTo(msg);
        }}
        onReact={(msg, emoji) => {
          if (!emoji || !msg) return;
          setLastQuickReaction(emoji);
          handleReactMessage(msg.id || msg._id, emoji);
        }}
        onCopy={handleCopyMessage}
        onForward={setForwardMessage}
        onEdit={(msg) => {
          setReplyTo(null);
          setEditingMessage(msg);
          setDraft(msg.text || "");
        }}
        onDelete={(msg) =>
          handleDeleteMessage(msg?.id || msg?._id || msg)
        }
        onStar={(msg) => handleStarMessage(msg?.id || msg?._id || msg)}
        onPin={(msg) => handlePinMessage(msg?.id || msg?._id || msg)}
      />

      <InfoPanel
        open={infoPanelOpen && Boolean(selected) && !isMobileShell}
        onClose={() => {
          setInfoPanelOpenState(false);
          setInfoPanelOpen(false);
        }}
        selected={selected}
        users={users}
        onOpenProfile={setProfileUserId}
        onOpenGroupSettings={() => setShowGroupSettings(true)}
      />
    </ChatShell>
  );
}
