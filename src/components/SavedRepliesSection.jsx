import { useEffect, useState } from 'react';
import { createSavedReply, deleteSavedReply, updateSavedReply } from '../api/savedReplies.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import './SavedRepliesSection.css';

const EMPTY_FORM = { shortcut: '/', message: '' };

export default function SavedRepliesSection({ replies, loading, loadError, onChanged }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(loadError || '');
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => setError(loadError || ''), [loadError]);

  function startEdit(reply) {
    setEditingId(reply.id);
    setForm({ shortcut: reply.shortcut, message: reply.message });
    setError('');
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!form.shortcut.trim() || form.shortcut.trim() === '/') {
      setError('Enter a shortcut such as /thanks');
      return;
    }
    if (!form.message.trim()) {
      setError('Enter a saved message');
      return;
    }
    setBusy(true);
    try {
      const saved = editingId
        ? await updateSavedReply(editingId, form)
        : await createSavedReply(form);
      onChanged((current) => editingId
        ? current.map((reply) => (reply.id === editingId ? saved : reply))
        : [...current, saved].sort((a, b) => a.shortcut.localeCompare(b.shortcut)));
      resetForm();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this reply');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteSavedReply(deleteTarget.id);
      onChanged((current) => current.filter((reply) => reply.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete this reply');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="settings-section saved-replies-section">
        <div className="settings-fieldset">
          <div className="settings-shield-header">
            <h3 className="settings-section-title">Saved replies</h3>
            <span className="settings-status-chip active">{replies.length} saved</span>
          </div>
          <p className="settings-section-copy">
            Create private canned messages that you can insert by typing their shortcut in any chat.
          </p>
          {error && <div className="settings-error">{error}</div>}
          {loading ? (
            <p className="settings-section-copy">Loading saved replies…</p>
          ) : replies.length === 0 ? (
            <p className="settings-section-copy">No saved replies yet. Add one below.</p>
          ) : (
            <div className="saved-replies-list">
              {replies.map((reply) => (
                <div className="saved-reply-row" key={reply.id}>
                  <div className="saved-reply-copy">
                    <strong>{reply.shortcut}</strong>
                    <span>{reply.message}</span>
                  </div>
                  <div className="saved-reply-actions">
                    <button type="button" className="settings-btn ghost" onClick={() => startEdit(reply)}>Edit</button>
                    <button type="button" className="settings-btn danger" onClick={() => setDeleteTarget(reply)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <form className="saved-reply-form" onSubmit={submit}>
            <h4>{editingId ? 'Edit saved reply' : 'Add saved reply'}</h4>
            <label className="settings-field">
              <span>Shortcut</span>
              <input
                value={form.shortcut}
                onChange={(event) => setForm((current) => ({ ...current, shortcut: event.target.value }))}
                placeholder="/thanks"
                maxLength={40}
                autoComplete="off"
              />
            </label>
            <label className="settings-field">
              <span>Message</span>
              <textarea
                value={form.message}
                onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
                placeholder="Thank you so much!"
                maxLength={10000}
                rows={3}
              />
            </label>
            <div className="saved-reply-form-actions">
              {editingId && <button type="button" className="settings-btn ghost" onClick={resetForm}>Cancel</button>}
              <button type="submit" className="settings-btn primary" disabled={busy}>
                {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add reply'}
              </button>
            </div>
          </form>
        </div>
      </section>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete saved reply?"
        message={deleteTarget ? `Delete ${deleteTarget.shortcut}? This cannot be undone.` : ''}
        confirmLabel="Delete"
        danger
        busy={busy}
        onCancel={() => !busy && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
