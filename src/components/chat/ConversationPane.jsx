import BrandLogo from '../BrandLogo.jsx';
import ConversationList from '../ConversationList.jsx';
import SidebarMenu from '../SidebarMenu.jsx';
import StoriesRail from '../StoriesRail.jsx';

/**
 * Left conversation pane — list, filters, stories.
 */
export default function ConversationPane({
  user,
  canChat,
  sidebarOpen,
  onCloseSidebar,
  onSettings,
  onLogout,
  storiesRailRef,
  users,
  onStoriesError,
   notifSettings,
  search,
  onSearchChange,
  conversations,
  filter,
  onFilterChange,
  selectedKey,
  onSelect,
  onCreateGroup,
  onDiscoverJoin,
  onHide,
  onBlock,
  onMute,
  onArchive,
  loadingUsers,
  friendCandidates,
  friendCandidatesLoading,
  incomingRequests,
  myFriends = [],
  myFriendsLoading = false,
  contactQuery = '',
  onContactQueryChange,
  contactLookupResult = null,
  contactLookupLoading = false,
  contactLookupError = '',
  onLookupContact,
  onSendFriendRequest,
  onCancelFriendRequest,
  onAcceptFriendRequest,
  onDeclineFriendRequest,
  onOpenFriend,
  
}) {
  return (
    <>
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
        onClick={onCloseSidebar}
        aria-hidden={!sidebarOpen}
      />
      <aside className={`sidebar qc-conversation-pane ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="sidebar-brand-mark">
              <BrandLogo size={40} />
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-username">{user.username}</div>
              <div className="sidebar-lastseen sidebar-status-online">online</div>
            </div>
          </div>
          <div className="sidebar-header-actions">
            <SidebarMenu onSettings={onSettings} onLogout={onLogout} />
          </div>
        </div>
        {canChat && (
          <>
            <StoriesRail
              ref={storiesRailRef}
              currentUser={user}
              users={users}
              onError={onStoriesError}
               notifSettings={notifSettings}
            />
            <div className="sidebar-search">
              <input
                placeholder="Search conversations…"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                aria-label="Search conversations"
              />
            </div>
          </>
        )}
        {canChat ? (
          <ConversationList
            conversations={conversations}
            filter={filter}
            onFilterChange={onFilterChange}
            selectedKey={selectedKey}
            onSelect={onSelect}
            onCreateGroup={onCreateGroup}
            onDiscoverJoin={onDiscoverJoin}
            onHide={onHide}
            onBlock={onBlock}
            onMute={onMute}
            onArchive={onArchive}
            loading={loadingUsers}
            searchQuery={search}
            friendCandidates={friendCandidates}
            friendCandidatesLoading={friendCandidatesLoading}
            incomingRequests={incomingRequests}
            myFriends={myFriends}
            myFriendsLoading={myFriendsLoading}
            contactQuery={contactQuery}
            onContactQueryChange={onContactQueryChange}
            contactLookupResult={contactLookupResult}
            contactLookupLoading={contactLookupLoading}
            contactLookupError={contactLookupError}
            onLookupContact={onLookupContact}
            onSendFriendRequest={onSendFriendRequest}
            onCancelFriendRequest={onCancelFriendRequest}
            onAcceptFriendRequest={onAcceptFriendRequest}
            onDeclineFriendRequest={onDeclineFriendRequest}
            onOpenFriend={onOpenFriend}
          />
        ) : (
          <p className="empty-hint">Set up your device key to see people.</p>
        )}
      </aside>
    </>
  );
}
