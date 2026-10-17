import React, { useState } from 'react';
import { apiRequest } from '../api';
import { X, ShieldAlert, Loader2, Check } from 'lucide-react';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportedUserId: number;
  reportedUserName: string;
  conversationId: string;
  messageId?: number;
}

const REPORT_REASONS = [
  'Spam or unwanted advertising',
  'Harassment or hate speech',
  'Inappropriate or offensive content',
  'Impersonation or phishing',
  'Other violation',
];

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  reportedUserId,
  reportedUserName,
  conversationId,
  messageId,
}) => {
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiRequest('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          reportedUserId,
          conversationId,
          messageId: messageId || undefined,
          reason,
          details: details.trim() || undefined,
        }),
      });

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err?.message || 'Failed to submit report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-2xl p-6 shadow-2xl relative text-[var(--text-primary)]">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Report User</h3>
            <p className="text-xs text-[var(--text-muted)]">Reporting @{reportedUserName}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
            {error}
          </div>
        )}

        {success ? (
          <div className="py-8 text-center text-emerald-400 space-y-2">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 mx-auto flex items-center justify-center">
              <Check className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium">Thank you for reporting</p>
            <p className="text-xs text-[var(--text-muted)]">Our team will review this report.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Reason
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-xs text-[var(--text-primary)] outline-none transition-colors"
              >
                {REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  Additional Details (optional)
                </label>
                <span className="text-[10px] text-[var(--text-muted)]">{details.length}/1000</span>
              </div>
              <textarea
                rows={3}
                maxLength={1000}
                placeholder="Provide any relevant context about this report..."
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none resize-none transition-colors"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 rounded-xl text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-600/20 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Submit Report</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
